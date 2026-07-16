// SPDX-License-Identifier: AGPL-3.0-or-later
import type { PartGraph } from '@furniture/contracts';
import type { ExportResult, FabricationExporter } from './index';

export interface CncOptions { sheetWidth?: number; sheetHeight?: number; gap?: number; calibrated?: boolean; }
const pair = (code: number | string, value: number | string) => `${code}\n${value}\n`;

/** Simple deterministic shelf nesting and R12 DXF outlines. CAM owns toolpaths. */
export const cncDxfExporter: FabricationExporter<CncOptions> = {
  id: 'cnc-dxf',
  validate(graph, options) {
    const problems = graph.parts.flatMap((p) => p.size.length <= 0 || p.size.width <= 0 || p.size.thickness <= 0 ? [`${p.id}: invalid panel size`] : []);
    if (!options.calibrated) problems.push('Measured material thickness calibration is required before a production CNC export.');
    return problems;
  },
  export(graph, options) {
    const errors = this.validate(graph, options); if (errors.length) throw new Error(errors.join('\n'));
    const sw = options.sheetWidth ?? 2500, sh = options.sheetHeight ?? 1250, gap = options.gap ?? 10;
    let x = gap, y = gap, row = 0; const entities: string[] = []; const rows: string[] = ['part_id,sheet_id,x_mm,y_mm,length_mm,width_mm,thickness_mm,rotation_deg'];
    for (const part of graph.parts) for (let n = 0; n < part.qty; n += 1) {
      const [w, h] = [part.size.length, part.size.width];
      if (w + 2 * gap > sw || h + 2 * gap > sh) throw new Error(`${part.id} does not fit the configured sheet.`);
      if (x + w + gap > sw) { x = gap; y += row + gap; row = 0; }
      if (y + h + gap > sh) throw new Error('This minimal single-sheet exporter needs a larger sheet or a nesting adapter.');
      const label = `${part.id}${part.qty > 1 ? `.${n + 1}` : ''}`;
      entities.push(...rectangle(x, y, w, h), pair(0, 'TEXT'), pair(8, 'ENGRAVE'), pair(10, x + 8), pair(20, y + 12), pair(40, 8), pair(1, label));
      rows.push([label, 'S01', x, y, w, h, part.size.thickness, 0].join(',')); x += w + gap; row = Math.max(row, h);
    }
    const dxf = `${pair(0, 'SECTION')}${pair(2, 'HEADER')}${pair(0, 'ENDSEC')}${pair(0, 'SECTION')}${pair(2, 'ENTITIES')}${entities.join('')}${pair(0, 'ENDSEC')}${pair(0, 'EOF')}`;
    return { files: [{ filename: `sheet_${graph.source.projectId}_S01.dxf`, mimeType: 'application/dxf', content: dxf, encoding: 'utf8' }, { filename: `nest_${graph.source.projectId}.csv`, mimeType: 'text/csv', content: `${rows.join('\n')}\n`, encoding: 'utf8' }], warnings: [...(graph.warnings ?? [])] } satisfies ExportResult;
  },
};
function rectangle(x: number, y: number, w: number, h: number): string[] { return [pair(0, 'LWPOLYLINE'), pair(8, 'CUT'), pair(90, 4), pair(70, 1), pair(10, x), pair(20, y), pair(10, x + w), pair(20, y), pair(10, x + w), pair(20, y + h), pair(10, x), pair(20, y + h)]; }
