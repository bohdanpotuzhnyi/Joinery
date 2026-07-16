// SPDX-License-Identifier: AGPL-3.0-or-later
import { Body, Controller, Get, HttpException, HttpStatus, Param, Post, Res } from '@nestjs/common';
import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { cncDxfExporter, cutListCsvExporter, laserSvgExporter, print3mfExporter, summaryPdfExporter, type ExportResult } from '@furniture/exporters';
import { solve } from '@furniture/kernel';
import { store } from './store';

const artifactsDir = join(process.env.DATA_DIR ?? join(process.cwd(), 'data'), 'artifacts');
const exporters = { 'cutlist-csv': cutListCsvExporter, 'cnc-dxf': cncDxfExporter, 'laser-svg': laserSvgExporter, 'print-3mf': print3mfExporter, 'summary-pdf': summaryPdfExporter } as const;
type ExportKind = keyof typeof exporters;
@Controller('api')
export class ExportsController {
  @Post('projects/:id/export')
  export(@Param('id') id: string, @Body() body: { kind: ExportKind; options?: Record<string, unknown> }) {
    const project = store.getProject(id); if (!project) throw new HttpException({ error: `No project "${id}"` }, HttpStatus.NOT_FOUND);
    const profile = store.getManufacturer(project.manufacturerId); if (!profile) throw new HttpException({ error: 'Manufacturer missing.' }, HttpStatus.CONFLICT);
    const spec = project.revisions.at(-1)!.designspec; const result = solve(spec, profile); if (!result.ok) return { ok: false, errors: result.errors };
    const exporter = exporters[body.kind]; if (!exporter) throw new HttpException({ error: 'Unknown exporter.' }, HttpStatus.BAD_REQUEST);
    if (body.kind === 'cnc-dxf' && !profile.capabilities.some((c) => c.process === 'cnc_wood_2d')) throw new HttpException({ error: 'Manufacturer has not configured CNC capability.' }, HttpStatus.CONFLICT);
    if (body.kind === 'print-3mf' && !profile.capabilities.some((c) => c.process === 'print_prototype_fdm')) throw new HttpException({ error: 'Manufacturer has not configured prototype-print capability.' }, HttpStatus.CONFLICT);
    let pack: ExportResult; try { pack = exporter.export(result.graph, body.options ?? {}); } catch (error) { throw new HttpException({ error: (error as Error).message }, HttpStatus.BAD_REQUEST); }
    mkdirSync(artifactsDir, { recursive: true }); const base = createHash('sha256').update(JSON.stringify({ graph: result.graph, kind: body.kind, options: body.options ?? {} })).digest('hex');
    const files = pack.files.map((file, index) => { const key = `${base}-${index}`; const path = join(artifactsDir, key); if (!existsSync(path)) writeFileSync(path, file.encoding === 'base64' ? Buffer.from(file.content, 'base64') : file.content); return { filename: file.filename, mimeType: file.mimeType, url: `/api/artifacts/${key}` }; });
    return { ok: true, contentHash: base, files, warnings: pack.warnings };
  }
  @Get('artifacts/:key')
  artifact(@Param('key') key: string, @Res() res: { send: (data: Buffer) => void; type: (value: string) => void }) { if (!/^[a-f0-9]{64}-\d+$/.test(key)) throw new HttpException({ error: 'Invalid artifact key.' }, HttpStatus.BAD_REQUEST); const path = join(artifactsDir, key); if (!existsSync(path)) throw new HttpException({ error: 'Artifact not found.' }, HttpStatus.NOT_FOUND); res.type('application/octet-stream'); res.send(readFileSync(path)); }
}
