// SPDX-License-Identifier: AGPL-3.0-or-later
// Makeup/vanity table template — deterministic formulas from design/02 §3.
import type { DesignSpec, HardwareItem, Joint, ManufacturerProfile, Part, PartGraph } from '@furniture/contracts';
import type { ConstraintError, ProductTemplate } from '../template';

interface VanityParams { width: number; depth?: number; height?: number; pedestalWidth?: number; drawerCount?: number; mirror?: boolean; mirrorWidth?: number; mirrorHeight?: number; apronHeight?: number; t?: number; tBack?: number; t2?: number; }
const num = (v: unknown, fallback: number) => typeof v === 'number' && Number.isFinite(v) ? v : fallback;
function params(spec: DesignSpec): Required<VanityParams> { const p = spec.parameters as unknown as VanityParams; return { width: num(p.width, Number.NaN), depth: num(p.depth, 450), height: num(p.height, 750), pedestalWidth: num(p.pedestalWidth, 300), drawerCount: num(p.drawerCount, 3), mirror: p.mirror ?? true, mirrorWidth: num(p.mirrorWidth, 500), mirrorHeight: num(p.mirrorHeight, 700), apronHeight: num(p.apronHeight, 70), t: num(p.t, 18), tBack: num(p.tBack, 12), t2: num(p.t2, 15) }; }
function validate(spec: DesignSpec, _profile: ManufacturerProfile): ConstraintError[] {
  const p = params(spec); const errors: ConstraintError[] = [];
  for (const [key, value, min, max] of [['width', p.width, 500, 1600], ['depth', p.depth, 350, 600], ['height', p.height, 700, 800], ['pedestalWidth', p.pedestalWidth, 250, 500]] as const) if (!Number.isFinite(value) || value < min || value > max) errors.push({ code: 'out_of_range', param: key, message: `${key} must be between ${min} and ${max} mm.` });
  if (!Number.isInteger(p.drawerCount) || p.drawerCount < 0 || p.drawerCount > 5) errors.push({ code: 'drawer_count', param: 'drawerCount', message: 'drawerCount must be between 0 and 5.' });
  if (p.pedestalWidth > p.width - 600) errors.push({ code: 'knee_width', param: 'pedestalWidth', message: 'Drawer unit too wide for this table — knee clearance would drop below the 600 mm minimum. Reduce drawer width or increase table width.' });
  if (p.apronHeight > p.height - p.t - 650) errors.push({ code: 'knee_height', param: 'apronHeight', message: 'Apron too tall — knee clearance would drop below the 650 mm minimum height.' });
  if (p.drawerCount > 0 && (p.height - 2 * p.t - (p.drawerCount + 1) * 3) / p.drawerCount < 150) errors.push({ code: 'drawer_height', param: 'drawerCount', message: 'Too many drawers for this height — each drawer front would be under 150 mm.' });
  if (p.mirror && (p.mirrorWidth > p.width || p.mirrorWidth < 300 || p.mirrorHeight < 400 || p.mirrorHeight > 900)) errors.push({ code: 'mirror_size', param: 'mirrorWidth', message: 'Mirror must fit the worktop and be 300–1600 mm wide by 400–900 mm high.' });
  return errors;
}
// Placement convention (drives GLB/OBJ), matching the wardrobe template:
//   world X = width (right+), Y = height (up+), Z = depth (front+);
//   origin at the CENTER of the footprint on the floor. The pedestal
//   (drawer cabinet) sits at the right end; the open knee space is on the left.
//   Part local axes: X = length, Y = width, Z = thickness. Rotations (deg):
//   [0,90,90]  vertical side-facing panels (pedestal sides, legs, risers): L→Y, W→Z, T→X
//   [0,0,90]   vertical front-facing panels (pedestal back, mirror backing): L→Y, W→X, T→Z
//   [90,0,0]   horizontal panels (worktop, pedestal bottom):                L→X, W→Z, T→Y
//   [0,90,0]   depth-wise panels (drawer box sides):                        L→Z, W→Y, T→X
//   [90,0,90]  drawer bottoms:                                              L→Z, W→X, T→Y
//   [0,0,0]    width-wise panels (aprons, drawer fronts/backs):             L→X, W→Y, T→Z
const R_SIDE: [number, number, number] = [0, 90, 90];
const R_FRONT: [number, number, number] = [0, 0, 90];
const R_FLAT: [number, number, number] = [90, 0, 0];
const R_DEPTHWISE: [number, number, number] = [0, 90, 0];
const R_DRAWER_BOTTOM: [number, number, number] = [90, 0, 90];
const R_NONE: [number, number, number] = [0, 0, 0];

function build(spec: DesignSpec, profile: ManufacturerProfile): PartGraph {
  const p = params(spec); const ph = p.height - p.t; const drawerHeight = p.drawerCount ? (ph - p.t - (p.drawerCount + 1) * 3) / p.drawerCount : 0; const drawerDepth = p.depth - 50; const material = `MDF${p.t}`;

  const pedestalX = p.width / 2 - p.pedestalWidth / 2; // pedestal at the right end
  const apronWidth = p.width - p.pedestalWidth - 40;
  const apronX = -p.width / 2 + apronWidth / 2; // apron/open side at the left end
  const frontZ = p.depth / 2 - p.t / 2; const backZ = -(p.depth / 2 - p.tBack / 2);

  const parts: Part[] = []; const joints: Joint[] = [];
  let partNo = 0; let jointNo = 0;
  const addPart = (part: Omit<Part, 'id' | 'qty'>): string => {
    partNo += 1; const id = `P${String(partNo).padStart(2, '0')}`;
    parts.push({ id, qty: 1, ...part }); return id;
  };
  const addJoint = (joint: Omit<Joint, 'id'>): void => {
    jointNo += 1; joints.push({ id: `J${String(jointNo).padStart(2, '0')}`, ...joint });
  };

  const worktop = addPart({ name: 'Worktop', role: 'worktop', size: { length: p.width, width: p.depth, thickness: p.t }, material, grain: 'length', transform: { t: [0, p.height - p.t / 2, 0], r: R_FLAT } });
  const sideA = addPart({ name: 'Pedestal side (front)', role: 'pedestal_side', size: { length: ph, width: p.depth, thickness: p.t }, material, grain: 'length', transform: { t: [pedestalX - p.pedestalWidth / 2 + p.t / 2, ph / 2, 0], r: R_SIDE } });
  const sideB = addPart({ name: 'Pedestal side (back)', role: 'pedestal_side', size: { length: ph, width: p.depth, thickness: p.t }, material, grain: 'length', transform: { t: [pedestalX + p.pedestalWidth / 2 - p.t / 2, ph / 2, 0], r: R_SIDE } });
  const bottom = addPart({ name: 'Pedestal bottom', role: 'pedestal_bottom', size: { length: p.pedestalWidth - 2 * p.t, width: p.depth, thickness: p.t }, material, grain: 'length', transform: { t: [pedestalX, p.t / 2, 0], r: R_FLAT } });
  const back = addPart({ name: 'Pedestal back', role: 'pedestal_back', size: { length: ph, width: p.pedestalWidth, thickness: p.tBack }, material: `MDF${p.tBack}`, grain: 'length', transform: { t: [pedestalX, ph / 2, backZ], r: R_FRONT } });
  const frontApron = addPart({ name: 'Front apron', role: 'front_apron', size: { length: apronWidth, width: p.apronHeight, thickness: p.t }, material, grain: 'length', transform: { t: [apronX, ph - p.apronHeight / 2, frontZ], r: R_NONE } });
  const backApron = addPart({ name: 'Back apron', role: 'back_apron', size: { length: apronWidth, width: p.apronHeight + 50, thickness: p.t }, material, grain: 'length', transform: { t: [apronX, ph - (p.apronHeight + 50) / 2, backZ], r: R_NONE } });
  const legX = -p.width / 2 + 20;
  const legFront = addPart({ name: 'Open-side leg (front)', role: 'leg', size: { length: ph, width: 40, thickness: 40 }, material: 'BEECH40', grain: 'length', transform: { t: [legX, ph / 2, p.depth / 2 - 20], r: R_SIDE } });
  const legBack = addPart({ name: 'Open-side leg (back)', role: 'leg', size: { length: ph, width: 40, thickness: 40 }, material: 'BEECH40', grain: 'length', transform: { t: [legX, ph / 2, -(p.depth / 2 - 20)], r: R_SIDE } });

  let mirrorBackingId: string | undefined;
  if (p.mirror) {
    const riserZ = -(p.depth / 2 - p.t / 2 - 20);
    addPart({ name: 'Mirror support riser (left)', role: 'mirror_riser', size: { length: p.mirrorHeight + 50, width: 40, thickness: p.t }, material, grain: 'length', transform: { t: [-(p.mirrorWidth / 2 - 20), p.height + (p.mirrorHeight + 50) / 2, riserZ], r: R_SIDE } });
    addPart({ name: 'Mirror support riser (right)', role: 'mirror_riser', size: { length: p.mirrorHeight + 50, width: 40, thickness: p.t }, material, grain: 'length', transform: { t: [p.mirrorWidth / 2 - 20, p.height + (p.mirrorHeight + 50) / 2, riserZ], r: R_SIDE } });
    mirrorBackingId = addPart({ name: 'Mirror backing panel', role: 'mirror_backing', size: { length: p.mirrorHeight, width: p.mirrorWidth, thickness: p.tBack }, material: `MDF${p.tBack}`, grain: 'length', transform: { t: [0, p.height + 50 + p.mirrorHeight / 2, riserZ], r: R_FRONT } });
  }

  const drawerIds: string[] = [];
  if (p.drawerCount) {
    const boxZCenter = frontZ - p.t / 2 - drawerDepth / 2;
    for (let i = 0; i < p.drawerCount; i += 1) {
      const y = 3 + i * (drawerHeight + 3) + drawerHeight / 2;
      const front = addPart({ name: `Drawer front ${i + 1}`, role: 'drawer_front', size: { length: p.pedestalWidth - 4, width: drawerHeight, thickness: p.t }, material, grain: 'length', transform: { t: [pedestalX, y, frontZ], r: R_NONE } });
      addPart({ name: `Drawer box side ${i + 1} (left)`, role: 'drawer_side', size: { length: drawerDepth, width: drawerHeight - 10, thickness: p.t2 }, material: `MDF${p.t2}`, grain: 'length', transform: { t: [pedestalX - (p.pedestalWidth - 4) / 2 + p.t2 / 2, y, boxZCenter], r: R_DEPTHWISE } });
      addPart({ name: `Drawer box side ${i + 1} (right)`, role: 'drawer_side', size: { length: drawerDepth, width: drawerHeight - 10, thickness: p.t2 }, material: `MDF${p.t2}`, grain: 'length', transform: { t: [pedestalX + (p.pedestalWidth - 4) / 2 - p.t2 / 2, y, boxZCenter], r: R_DEPTHWISE } });
      addPart({ name: `Drawer box back ${i + 1}`, role: 'drawer_back', size: { length: p.pedestalWidth - 4 - 2 * p.t2, width: drawerHeight - 30, thickness: p.t2 }, material: `MDF${p.t2}`, grain: 'length', transform: { t: [pedestalX, y, boxZCenter - drawerDepth / 2 + p.t2 / 2], r: R_NONE } });
      addPart({ name: `Drawer bottom ${i + 1}`, role: 'drawer_bottom', size: { length: drawerDepth + 12, width: p.pedestalWidth - 4 - 2 * p.t2 + 12, thickness: p.tBack }, material: `MDF${p.tBack}`, grain: 'length', transform: { t: [pedestalX, y - (drawerHeight - 10) / 2 + p.tBack / 2, boxZCenter], r: R_DRAWER_BOTTOM } });
      drawerIds.push(front);
    }
  }

  addJoint({ kind: 'confirmat', partA: sideA, partB: bottom, count: 4, structural: true });
  addJoint({ kind: 'confirmat', partA: sideB, partB: bottom, count: 4, structural: true });
  addJoint({ kind: 'screw', partA: sideA, partB: worktop, count: 4, structural: true });
  addJoint({ kind: 'screw', partA: sideB, partB: worktop, count: 4, structural: true });
  addJoint({ kind: 'rail_bracket', partA: legFront, partB: worktop, count: 1, structural: true });
  addJoint({ kind: 'rail_bracket', partA: legBack, partB: worktop, count: 1, structural: true });
  addJoint({ kind: 'screw', partA: frontApron, partB: legFront, count: 2, structural: true });
  addJoint({ kind: 'screw', partA: backApron, partB: legBack, count: 2, structural: true });
  if (mirrorBackingId) addJoint({ kind: 'screw', partA: mirrorBackingId, partB: worktop, count: 4, structural: true });

  const hardware: HardwareItem[] = [{ sku: profile.stableCatalog.fasteners?.[0]?.sku, kind: 'pedestal_confirmat', count: 8 }, { kind: 'worktop_fixing', count: 8 }, { kind: 'leg_mounting_bracket', count: 2 }];
  if (p.drawerCount) hardware.push({ kind: 'drawer_slide_pair', count: p.drawerCount }, { kind: 'drawer_knob', count: p.drawerCount }, { kind: 'drawer_box_joinery', count: p.drawerCount * 8 });
  if (p.mirror) hardware.push({ kind: 'mirror_riser_fixing', count: 4 }, { kind: 'mirror_backing_fixing', count: 4 }, { kind: 'mirror_clip', count: 4 });
  return { graphVersion: 1, source: { projectId: spec.projectId, revision: spec.revision }, units: 'mm', parts, joints, hardware, boundingBox: { w: p.width, h: p.height + (p.mirror ? p.mirrorHeight + 50 : 0), d: p.depth }, warnings: [] };
}
export const vanityTemplate: ProductTemplate = { productType: 'vanity', paramSchema: { type: 'object' }, validate, build };
