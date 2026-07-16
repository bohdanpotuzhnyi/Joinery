// SPDX-License-Identifier: AGPL-3.0-or-later
// Cut list CSV — part of the CNC order pack (design/03 §2.7, format dxf+csv_v1).
import type { PartGraph } from '@furniture/contracts';
import type { FabricationExporter, ExportResult } from './index';

function csvEscape(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const cutListCsvExporter: FabricationExporter = {
  id: 'cutlist-csv',

  validate(graph: PartGraph): string[] {
    const problems: string[] = [];
    if (graph.units !== 'mm') problems.push(`units must be mm, got ${graph.units}`);
    for (const p of graph.parts) {
      if (p.size.length < p.size.width) {
        problems.push(`${p.id} ${p.name}: length (${p.size.length}) < width (${p.size.width}) — convention is length ≥ width`);
      }
    }
    return problems;
  },

  export(graph: PartGraph): ExportResult {
    const header = ['part_id', 'name', 'qty', 'length_mm', 'width_mm', 'thickness_mm', 'material', 'grain'];
    const partRows = graph.parts.map((p) =>
      [p.id, p.name, p.qty, p.size.length, p.size.width, p.size.thickness, p.material, p.grain ?? 'none']
        .map(csvEscape).join(','),
    );
    const hwHeader = ['sku', 'kind', 'count'];
    const hwRows = graph.hardware.map((h) => [h.sku ?? '', h.kind, h.count].map(csvEscape).join(','));

    return {
      files: [
        {
          filename: `cutlist_${graph.source.projectId}_r${graph.source.revision}.csv`,
          mimeType: 'text/csv',
          content: [header.join(','), ...partRows].join('\n') + '\n',
          encoding: 'utf8',
        },
        {
          filename: `hardware_${graph.source.projectId}_r${graph.source.revision}.csv`,
          mimeType: 'text/csv',
          content: [hwHeader.join(','), ...hwRows].join('\n') + '\n',
          encoding: 'utf8',
        },
      ],
      warnings: [...(graph.warnings ?? [])],
    };
  },
};
