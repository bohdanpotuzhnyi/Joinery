// SPDX-License-Identifier: AGPL-3.0-or-later
// The zero-LLM path, working first (design/07 M3): a validated DesignSpec in,
// PartGraph + scene + cut list out. The chat edge (M4) produces the same
// DesignSpec patches this endpoint consumes.
import { Body, Controller, Get, HttpException, HttpStatus, Post } from '@nestjs/common';
import {
  assertValid, validateDesignSpec,
  type DesignSpec,
} from '@furniture/contracts';
import { solve } from '@furniture/kernel';
import { buildScene } from '@furniture/scene';
import { cutListCsvExporter } from '@furniture/exporters';
import demoWardrobeSpec from '../fixtures/wardrobe-spec.json';
import { store } from './store';

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
      cutListCsv: cutList.files[0].content,
      warnings: cutList.warnings,
    };
  }
}
