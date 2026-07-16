// SPDX-License-Identifier: AGPL-3.0-or-later
import type { PartGraph } from '@furniture/contracts';
import type { FabricationExporter } from './index';
export interface LaserOptions { scale?: 20 | 25 | 50; stockThickness?: number; kerf?: number; }
export const laserSvgExporter: FabricationExporter<LaserOptions> = {
  id: 'laser-svg',
  validate(graph, options) { const scale = options.scale ?? 25; return graph.parts.flatMap((p) => Math.min(p.size.length, p.size.width) / scale < 0.5 ? [`${p.id}: scaled feature is below 0.5 mm`] : []); },
  export(graph, options) {
    const scale = options.scale ?? 25, stock = options.stockThickness ?? 3, kerf = options.kerf ?? 0.15; let x = 8, y = 8, row = 0; const shapes: string[] = [];
    for (const p of graph.parts) for (let n = 0; n < p.qty; n += 1) { const w = p.size.length / scale, h = p.size.width / scale; if (x + w + 8 > 280) { x = 8; y += row + 12; row = 0; } shapes.push(`<rect class="cut" x="${x}" y="${y}" width="${w}" height="${h}"/><text class="engrave" x="${x + 1}" y="${y + 3}">${p.id}${p.qty > 1 ? `.${n + 1}` : ''}</text>`); x += w + 8; row = Math.max(row, h); }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="297mm" height="${Math.max(20, y + row + 8)}mm" viewBox="0 0 297 ${Math.max(20, y + row + 8)}"><style>.cut{fill:none;stroke:#000;stroke-width:.1}.engrave{font:3px sans-serif;fill:#00f}</style><text x="8" y="5">Scale 1:${scale}; stock ${stock} mm; kerf ${kerf} mm</text>${shapes.join('')}</svg>`;
    return { files: [{ filename: `laser_${graph.source.projectId}_1-${scale}.svg`, mimeType: 'image/svg+xml', content: svg, encoding: 'utf8' }], warnings: ['Envelope dimensions are true scale; panel thickness is substituted with laser stock.'] };
  },
};
