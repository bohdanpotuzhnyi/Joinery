// SPDX-License-Identifier: AGPL-3.0-or-later
// SceneBuilder: PartGraph -> renderable scene (design/01 §SceneBuilder).
// Milestone M3 replaces the box-list with real glTF generation (three.js
// headless); every ViewAdapter (web 3D, phone AR, goggles, manual viewer)
// consumes this one output.
import type { PartGraph } from '@furniture/contracts';

export interface SceneBox {
  partId: string;
  name: string;
  /** box dimensions in mm: [length, width, thickness] */
  size: [number, number, number];
  /** assembled position (mm) and rotation (deg), from PartGraph transforms */
  t: [number, number, number];
  r: [number, number, number];
  material: string;
}

export interface SceneDescriptor {
  units: 'mm';
  boundingBox: { w: number; h: number; d: number };
  boxes: SceneBox[];
}

export function buildScene(graph: PartGraph): SceneDescriptor {
  return {
    units: 'mm',
    boundingBox: {
      w: graph.boundingBox?.w ?? 0,
      h: graph.boundingBox?.h ?? 0,
      d: graph.boundingBox?.d ?? 0,
    },
    boxes: graph.parts.flatMap((p) =>
      Array.from({ length: p.qty }, (_, i) => ({
        partId: p.qty > 1 ? `${p.id}.${i + 1}` : p.id,
        name: p.name,
        size: [p.size.length, p.size.width, p.size.thickness] as [number, number, number],
        t: p.transform?.t ?? [0, 0, 0],
        r: p.transform?.r ?? [0, 0, 0],
        material: p.material,
      })),
    ),
  };
}
