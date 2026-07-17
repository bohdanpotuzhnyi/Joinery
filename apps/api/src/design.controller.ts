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

// Keep in sync with the templates actually registered in @furniture/kernel —
// a manufacturer's productClasses can list types (e.g. "kommode") that have
// no template at all, which would otherwise dead-end every solve() call.
const PARAM_CHEAT_SHEET: Record<string, string> = {
  wardrobe: 'width, height, depth (all required, exterior mm), doorCount (int), shelfCount (int), hangingRail (boolean)',
  bed: 'mattressWidth (required, mm), mattressLength, mattressCount (1 or 2), legHeight (mm from floor to the underside of the frame), headboard (boolean), headboardHeight, storageDrawerCount — never set frameClearance: it is a hidden ~10mm manufacturing tolerance between the mattress and the frame, not a dimension any photo shows',
  vanity: 'width (required), depth, height (mm), pedestalWidth (width of the built-in drawer/cabinet block under the worktop — not a single decorative leg), drawerCount, mirror (boolean), mirrorWidth, mirrorHeight',
};

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
      objText: buildObj(result.graph),
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

    const buildableTypes = manufacturer.productClasses.filter((pc) => pc in PARAM_CHEAT_SHEET);
    if (buildableTypes.length === 0) {
      throw new HttpException({ error: `${manufacturer.identity.name} doesn't offer a product type this feature supports yet (wardrobe, bed, or vanity).` }, HttpStatus.BAD_REQUEST);
    }

    const sessionId = body.sessionId ?? 'anonymous';
    const limit = Number(process.env.SESSION_TOKEN_BUDGET ?? 200000);
    const dailyLimit = Number(process.env.DAILY_TOKEN_BUDGET ?? 2000000);
    if (usedToday(sessionId) >= limit || usedToday() >= dailyLimit) {
      throw new HttpException({ error: 'Chat budget reached for today; use the parameter form instead.' }, HttpStatus.TOO_MANY_REQUESTS);
    }

    const gateway = port();
    const started = Date.now();
    const paramGuide = buildableTypes.map((t) => `- ${t}: ${PARAM_CHEAT_SHEET[t]}`).join('\n');
    let delta: DesignSpecDelta;
    try {
      const response = await gateway.port.completeStructured({
        system: `${gateway.instruction}
You will be shown a photo or a dimensioned line drawing of a furniture piece (e.g. an IKEA-style assembly diagram). Extract a DesignSpecDelta describing it.

Manufacturer ${manufacturer.identity.name} builds: ${buildableTypes.join(', ')}. productType must be exactly one of those — if the piece doesn't clearly match any of them, leave productType unset and use clarifyingQuestion to ask instead of guessing.

parametersPatch keys must be flat, top-level, and spelled EXACTLY as listed below — plain numbers in millimeters (convert cm × 10, inches × 25.4). Never a string with a unit suffix, never a nested object, never a different key name:
${paramGuide}

Read any printed measurements directly off the drawing; omit a parameter rather than guessing if it isn't legible. Never calculate geometry yourself — only emit the parameter values above for the kernel to validate.`,
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

    if (!delta.productType && delta.clarifyingQuestion) {
      return { ok: false, delta, errors: [{ code: 'needs_clarification', message: delta.clarifyingQuestion }] };
    }
    const base: DesignSpec = {
      specVersion: 1,
      projectId: `prj_img_${randomUUID().slice(0, 8)}`,
      revision: 1,
      manufacturerId,
      productType: delta.productType ?? buildableTypes[0] as DesignSpec['productType'],
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
