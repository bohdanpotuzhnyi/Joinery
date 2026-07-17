// SPDX-License-Identifier: AGPL-3.0-or-later
// The zero-LLM path, working first (design/07 M3): a validated DesignSpec in,
// PartGraph + scene + cut list out. The chat edge (M4) produces the same
// DesignSpec patches this endpoint consumes.
import { Body, Controller, Get, HttpException, HttpStatus, Post } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  assertValid, schemas, validateDesignSpec, validateDesignSpecDelta,
  type DesignSpec, type DesignSpecDelta,
} from '@furniture/contracts';
import { solve } from '@furniture/kernel';
import { buildGlb, buildObj, buildScene } from '@furniture/scene';
import { cutListCsvExporter } from '@furniture/exporters';
import demoWardrobeSpec from '../fixtures/wardrobe-spec.json';
import { store } from './store';
import { decodeImageUpload } from './image-validation';
import { audit, merge, port, usedToday } from './llm-pipeline';

@Controller('api/designs')
export class DesignController {
  /** Browser-friendly smoke test: solves the golden wardrobe fixture. */
  @Get('demo')
  demo() {
    return this.solveDesign(demoWardrobeSpec);
  }

  @Post('solve')
  solveDesign(@Body() body: unknown) {
    let spec: DesignSpec;
    try {
      spec = assertValid(validateDesignSpec, body, 'DesignSpec');
    } catch (e) {
      throw new HttpException({ error: (e as Error).message }, HttpStatus.BAD_REQUEST);
    }
    const manufacturerId = spec.manufacturerId ?? 'mfr_demo';
    const profile = store.getManufacturer(manufacturerId);
    if (!profile) {
      throw new HttpException({ error: `No manufacturer "${manufacturerId}"` }, HttpStatus.BAD_REQUEST);
    }

    const result = solve(spec, profile);
    if (!result.ok) {
      // Constraint violations are user-facing advice, not server errors.
      return { ok: false, errors: result.errors };
    }
    const cutList = cutListCsvExporter.export(result.graph, {});
    return {
      ok: true,
      partGraph: result.graph,
      scene: buildScene(result.graph),
      // Kept inline for the stateless solver endpoint. Project artifacts move
      // to content-addressed storage through the export endpoint.
      sceneGlbBase64: Buffer.from(buildGlb(result.graph)).toString('base64'),
      cutListCsv: cutList.files[0].content,
      warnings: cutList.warnings,
    };
  }

  /**
   * Start a design from a photo or a dimensioned line drawing (e.g. an
   * IKEA-style assembly diagram): a vision-capable model reads it into a
   * DesignSpecDelta, which is merged and solved exactly like a chat edit —
   * the kernel never sees the image, only the resulting parameters.
   */
  @Post('from-image')
  async fromImage(@Body() body: { dataBase64?: string; mime?: string; manufacturerId?: string; sessionId?: string }) {
    decodeImageUpload(body.dataBase64, body.mime);
    const manufacturerId = body.manufacturerId ?? 'mfr_demo';
    const manufacturer = store.getManufacturer(manufacturerId);
    if (!manufacturer) throw new HttpException({ error: `No manufacturer "${manufacturerId}"` }, HttpStatus.BAD_REQUEST);

    const sessionId = body.sessionId ?? 'anonymous';
    const limit = Number(process.env.SESSION_TOKEN_BUDGET ?? 200000);
    const dailyLimit = Number(process.env.DAILY_TOKEN_BUDGET ?? 2000000);
    if (usedToday(sessionId) >= limit || usedToday() >= dailyLimit) {
      throw new HttpException({ error: 'Chat budget reached for today; use the parameter form instead.' }, HttpStatus.TOO_MANY_REQUESTS);
    }

    const gateway = port();
    const started = Date.now();
    let delta: DesignSpecDelta;
    try {
      const response = await gateway.port.completeStructured({
        system: `${gateway.instruction}\nYou will be shown a photo or a dimensioned line drawing of a furniture piece (e.g. an IKEA-style assembly diagram). Extract a DesignSpecDelta describing it as closely as possible. Manufacturer ${manufacturer.identity.name} offers: ${manufacturer.productClasses.join(', ')}. Only use a productType this manufacturer supports. Read any printed measurements and convert to millimeters (cm × 10, inches × 25.4). Omit a parameter rather than guessing if it isn't legible. Never calculate geometry yourself — only emit parameter values for the kernel to validate.`,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', mediaType: body.mime!, dataBase64: body.dataBase64! },
            { type: 'text', text: 'Extract the DesignSpecDelta for the furniture shown.' },
          ],
        }],
        schema: schemas.designSpecDelta,
        tier: 'large',
        maxTokens: 900,
      });
      delta = assertValid(validateDesignSpecDelta, response.json, 'DesignSpecDelta');
      audit({ at: new Date().toISOString(), sessionId, stage: 'extract', model: gateway.largeModel, inputTokens: response.usage.inputTokens, outputTokens: response.usage.outputTokens, latencyMs: Date.now() - started, outcome: 'ok' });
    } catch (error) {
      audit({ at: new Date().toISOString(), sessionId, stage: 'extract', model: gateway.largeModel, inputTokens: 0, outputTokens: 0, latencyMs: Date.now() - started, outcome: 'error' });
      throw new HttpException({ error: `Image extraction failed: ${(error as Error).message}` }, HttpStatus.BAD_GATEWAY);
    }

    const base: DesignSpec = {
      specVersion: 1,
      projectId: `prj_img_${randomUUID().slice(0, 8)}`,
      revision: 1,
      manufacturerId,
      productType: delta.productType ?? 'wardrobe',
      parameters: {},
    };
    const next = merge(base, delta);
    const result = solve(next, manufacturer);
    if (!result.ok) return { ok: false, spec: next, delta, errors: result.errors };
    const cutList = cutListCsvExporter.export(result.graph, {});
    return {
      ok: true,
      spec: next,
      delta,
      partGraph: result.graph,
      scene: buildScene(result.graph),
      sceneGlbBase64: Buffer.from(buildGlb(result.graph)).toString('base64'),
      cutListCsv: cutList.files[0].content,
      warnings: cutList.warnings,
    };
  }
}
