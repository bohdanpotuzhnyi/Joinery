// SPDX-License-Identifier: AGPL-3.0-or-later
// SceneBuilder: PartGraph -> renderable scene and standards-compliant GLB.
// A compact deterministic GLB writer keeps this package framework- and
// renderer-independent; web, AR and manual viewers consume the same artifact.
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

/** A binary glTF 2.0 scene made of one reusable unit cube and per-part nodes.
 * Dimensions are converted from the canonical millimetres to glTF metres. */
export function buildGlb(graph: PartGraph): Uint8Array {
  const boxes = buildScene(graph).boxes;
  const vertices = new Float32Array([
    -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5,
    -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
  ]);
  const indices = new Uint16Array([
    0, 1, 2, 2, 3, 0, 4, 6, 5, 6, 4, 7, 0, 4, 5, 5, 1, 0,
    1, 5, 6, 6, 2, 1, 2, 6, 7, 7, 3, 2, 4, 0, 3, 3, 7, 4,
  ]);
  const binary = new Uint8Array(vertices.byteLength + indices.byteLength);
  binary.set(new Uint8Array(vertices.buffer), 0);
  binary.set(new Uint8Array(indices.buffer), vertices.byteLength);
  const json = {
    asset: { version: '2.0', generator: 'furniture-platform deterministic SceneBuilder' },
    scene: 0,
    scenes: [{ nodes: boxes.map((_, i) => i) }],
    nodes: boxes.map((box) => ({
      name: `${box.partId} ${box.name}`,
      mesh: 0,
      translation: box.t.map((v) => v / 1000),
      rotation: eulerDegreesToQuaternion(box.r),
      scale: box.size.map((v) => v / 1000),
    })),
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    materials: [{ name: 'Furniture board', pbrMetallicRoughness: { baseColorFactor: [0.48, 0.30, 0.16, 1], metallicFactor: 0, roughnessFactor: 0.72 } }],
    buffers: [{ byteLength: binary.byteLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: vertices.byteLength, target: 34962 },
      { buffer: 0, byteOffset: vertices.byteLength, byteLength: indices.byteLength, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 8, type: 'VEC3', min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] },
      { bufferView: 1, componentType: 5123, count: indices.length, type: 'SCALAR' },
    ],
  };
  const jsonBytes = utf8(JSON.stringify(json));
  const jsonLength = align4(jsonBytes.byteLength); const binLength = align4(binary.byteLength);
  const glb = new Uint8Array(12 + 8 + jsonLength + 8 + binLength); const view = new DataView(glb.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, glb.byteLength, true);
  view.setUint32(12, jsonLength, true); view.setUint32(16, 0x4e4f534a, true); glb.set(jsonBytes, 20); glb.fill(0x20, 20 + jsonBytes.byteLength, 20 + jsonLength);
  const binHeader = 20 + jsonLength; view.setUint32(binHeader, binLength, true); view.setUint32(binHeader + 4, 0x004e4942, true); glb.set(binary, binHeader + 8);
  return glb;
}

/** Wavefront OBJ of the assembled model — the artifact handed back to the
 * customer ("we generate the obj of it and give it back"). Millimetre units,
 * one `g` group per part instance, world axes identical to the GLB. */
export function buildObj(graph: PartGraph): string {
  const boxes = buildScene(graph).boxes;
  const lines: string[] = [
    '# furniture-platform assembled model (units: mm)',
    `# source project ${graph.source.projectId} rev ${graph.source.revision}`,
  ];
  let vertexOffset = 0;
  for (const box of boxes) {
    const m = eulerDegreesToMatrix(box.r);
    const [sx, sy, sz] = box.size;
    lines.push(`g ${box.partId}_${box.name.replace(/[^\w]+/g, '_')}`);
    for (const cz of [-0.5, 0.5]) for (const cy of [-0.5, 0.5]) for (const cx of [-0.5, 0.5]) {
      const lx = cx * sx, ly = cy * sy, lz = cz * sz;
      const x = m[0] * lx + m[1] * ly + m[2] * lz + box.t[0];
      const y = m[3] * lx + m[4] * ly + m[5] * lz + box.t[1];
      const z = m[6] * lx + m[7] * ly + m[8] * lz + box.t[2];
      lines.push(`v ${round3(x)} ${round3(y)} ${round3(z)}`);
    }
    // faces over the 8 corners (1-indexed, order: x fastest, then y, then z)
    const o = vertexOffset;
    const quads = [
      [1, 2, 4, 3], [5, 7, 8, 6],   // z- , z+
      [1, 5, 6, 2], [3, 4, 8, 7],   // y- , y+
      [1, 3, 7, 5], [2, 6, 8, 4],   // x- , x+
    ];
    for (const q of quads) lines.push(`f ${q.map((i) => i + o).join(' ')}`);
    vertexOffset += 8;
  }
  return `${lines.join('\n')}\n`;
}

/** Room shell for scale prints and the OBJ: floor + back wall + one side
 * wall around the furniture ("the user gets the room along with it").
 * The furniture's back sits against the room's back wall, centered on it. */
export function withRoomShell(
  graph: PartGraph,
  room: { widthMm?: number; depthMm?: number; heightMm?: number },
): PartGraph {
  const rw = room.widthMm ?? (graph.boundingBox?.w ?? 1000) * 2;
  const rd = room.depthMm ?? (graph.boundingBox?.d ?? 600) * 3;
  const rh = room.heightMm ?? Math.max(2400, (graph.boundingBox?.h ?? 2000) + 200);
  const d = graph.boundingBox?.d ?? 600;
  const wall = 20; // shell thickness, exaggerated for printability at scale
  const zCenter = rd / 2 - d / 2; // room extends forward from the furniture back
  const shell: PartGraph['parts'] = [
    {
      id: 'R01', name: 'Room floor', role: 'room', qty: 1,
      size: { length: rw, width: rd, thickness: wall }, material: 'room_shell',
      transform: { t: [0, -wall / 2, zCenter], r: [90, 0, 0] },
    },
    {
      id: 'R02', name: 'Room back wall', role: 'room', qty: 1,
      size: { length: rh, width: rw, thickness: wall }, material: 'room_shell',
      transform: { t: [0, rh / 2, -d / 2 - wall / 2], r: [0, 0, 90] },
    },
    {
      id: 'R03', name: 'Room side wall', role: 'room', qty: 1,
      size: { length: rh, width: rd, thickness: wall }, material: 'room_shell',
      transform: { t: [-rw / 2 - wall / 2, rh / 2, zCenter], r: [0, 90, 90] },
    },
  ];
  return { ...graph, parts: [...graph.parts, ...shell] };
}

function round3(v: number): number { return Math.round(v * 1000) / 1000; }

function eulerDegreesToMatrix(r: [number, number, number]): number[] {
  const [qx, qy, qz, qw] = eulerDegreesToQuaternion(r);
  return [
    1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qz * qw), 2 * (qx * qz + qy * qw),
    2 * (qx * qy + qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qx * qw),
    2 * (qx * qz - qy * qw), 2 * (qy * qz + qx * qw), 1 - 2 * (qx * qx + qy * qy),
  ];
}

function align4(value: number): number { return (value + 3) & ~3; }

function utf8(value: string): Uint8Array {
  const encoded = encodeURIComponent(value); const bytes: number[] = [];
  for (let i = 0; i < encoded.length; i += 1) {
    if (encoded[i] === '%') { bytes.push(Number.parseInt(encoded.slice(i + 1, i + 3), 16)); i += 2; }
    else bytes.push(encoded.charCodeAt(i));
  }
  return new Uint8Array(bytes);
}

function eulerDegreesToQuaternion([x, y, z]: [number, number, number]): [number, number, number, number] {
  const [rx, ry, rz] = [x, y, z].map((v) => v * Math.PI / 360);
  const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
  return [sx * cy * cz + cx * sy * sz, cx * sy * cz - sx * cy * sz, cx * cy * sz - sx * sy * cz, cx * cy * cz + sx * sy * sz];
}
