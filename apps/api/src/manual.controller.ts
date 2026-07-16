// SPDX-License-Identifier: AGPL-3.0-or-later
import { Controller, Get, HttpException, HttpStatus, Param } from '@nestjs/common';
import { createHash } from 'crypto';
import { buildGlb } from '@furniture/scene';
import { generateManual, verifyManual } from '@furniture/manual';
import { solve } from '@furniture/kernel';
import { store } from './store';

@Controller('api/projects')
export class ManualController {
  @Get(':id/manual')
  manual(@Param('id') id: string) {
    const project = store.getProject(id); if (!project) throw new HttpException({ error: `No project "${id}"` }, HttpStatus.NOT_FOUND);
    const profile = store.getManufacturer(project.manufacturerId); if (!profile) throw new HttpException({ error: 'Manufacturer missing.' }, HttpStatus.CONFLICT);
    const result = solve(project.revisions.at(-1)!.designspec, profile); if (!result.ok) return { ok: false, errors: result.errors };
    const hash = createHash('sha256').update(JSON.stringify(result.graph)).digest('hex'); const manual = generateManual(result.graph, hash); const errors = verifyManual(manual, result.graph);
    if (errors.length) throw new HttpException({ error: 'Generated manual did not pass replay verification.', errors }, HttpStatus.INTERNAL_SERVER_ERROR);
    return { ok: true, manual, sceneGlbBase64: Buffer.from(buildGlb(result.graph)).toString('base64') };
  }
}
