// SPDX-License-Identifier: AGPL-3.0-or-later
// Bed template — deterministic formulas from design/02-products.md §2.
import type { DesignSpec, HardwareItem, Joint, ManufacturerProfile, Part, PartGraph } from '@furniture/contracts';
import type { ConstraintError, ProductTemplate } from '../template';

interface BedParams {
  mattressWidth: number; mattressLength?: number; mattressCount?: number; mattressGap?: number;
  frameClearance?: number; headboard?: boolean; headboardHeight?: number;
  underBedStorage?: 'none' | 'drawers' | 'liftUp'; storageDrawerCount?: number;
  legHeight?: number; slatWidth?: number; t?: number; tBack?: number;
}

const number = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;

function params(spec: DesignSpec): Required<BedParams> {
  const p = spec.parameters as unknown as BedParams;
  return {
    mattressWidth: number(p.mattressWidth, Number.NaN), mattressLength: number(p.mattressLength, 2000),
    mattressCount: number(p.mattressCount, 1), mattressGap: number(p.mattressGap, 0),
    frameClearance: number(p.frameClearance, 10), headboard: p.headboard ?? false,
    headboardHeight: number(p.headboardHeight, 900), underBedStorage: p.underBedStorage ?? 'none',
    storageDrawerCount: number(p.storageDrawerCount, 0), legHeight: number(p.legHeight, 150),
    slatWidth: number(p.slatWidth, 70), t: number(p.t, 18), tBack: number(p.tBack, 12),
  };
}

function interior(p: Required<BedParams>) {
  return {
    width: p.mattressCount * p.mattressWidth + (p.mattressCount - 1) * p.mattressGap + 2 * p.frameClearance,
    length: p.mattressLength + 2 * p.frameClearance,
  };
}

function validate(spec: DesignSpec, _profile: ManufacturerProfile): ConstraintError[] {
  const p = params(spec); const errors: ConstraintError[] = [];
  const ranges: [keyof BedParams, number, number][] = [
    ['mattressWidth', 700, 2000], ['mattressLength', 1900, 2200], ['mattressGap', 0, 40],
    ['frameClearance', 5, 25], ['legHeight', 100, 450], ['slatWidth', 60, 100],
  ];
  for (const [key, min, max] of ranges) {
    const value = p[key] as number;
    if (!Number.isFinite(value) || value < min || value > max) errors.push({ code: 'out_of_range', param: key, message: `${key} must be between ${min} and ${max} mm.` });
  }
  if (![1, 2].includes(p.mattressCount)) errors.push({ code: 'mattress_count', param: 'mattressCount', message: 'A bed supports one or two mattresses.' });
  if (!Number.isInteger(p.storageDrawerCount) || p.storageDrawerCount < 0 || p.storageDrawerCount > 4) errors.push({ code: 'drawer_count', param: 'storageDrawerCount', message: 'Storage drawer count must be between 0 and 4.' });
  if (p.underBedStorage === 'drawers' && p.legHeight < 250) errors.push({ code: 'storage_leg_height', param: 'legHeight', message: 'Under-bed drawers need at least 250 mm leg height — increase leg height or remove storage.' });
  if (p.underBedStorage !== 'drawers' && p.storageDrawerCount > 0) errors.push({ code: 'drawer_storage_disabled', param: 'storageDrawerCount', message: 'Choose under-bed drawers before adding storage drawers.' });
  if (!['none', 'drawers', 'liftUp'].includes(p.underBedStorage)) errors.push({ code: 'storage_kind', param: 'underBedStorage', message: 'underBedStorage must be none, drawers, or liftUp.' });
  const size = interior(p);
  if (p.mattressCount === 2 && size.width > 2500) errors.push({ code: 'bed_too_wide', param: 'mattressWidth', message: 'Two mattresses this wide exceed our maximum bed frame width (250 cm) — consider a single wider mattress instead.' });
  return errors;
}

// Placement convention (drives GLB/OBJ), matching the wardrobe template:
//   world X = width (right+), Y = height (up+), Z = length (foot+, head-);
//   origin at the CENTER of the footprint on the floor.
//   Part local axes: X = length, Y = width, Z = thickness. Rotations (deg):
//   [0,90,0]   rails/battens/center beam running head-to-foot: L→Z, W→Y, T→X
//   [0,90,90]  vertical legs:                                  L→Y, W→Z, T→X
//   [90,0,0]   slats, lying flat:                               L→X, W→Z, T→Y
//   [90,0,90]  under-bed drawer boxes:                          L→Z, W→X, T→Y
//   [0,0,0]    head/foot rail, headboard (length runs along X):  L→X, W→Y, T→Z
const R_ALONG_LENGTH: [number, number, number] = [0, 90, 0];
const R_UPRIGHT: [number, number, number] = [0, 90, 90];
const R_FLAT: [number, number, number] = [90, 0, 0];
const R_DRAWER: [number, number, number] = [90, 0, 90];
const R_NONE: [number, number, number] = [0, 0, 0];

function build(spec: DesignSpec, profile: ManufacturerProfile): PartGraph {
  const p = params(spec); const { width: W, length: L } = interior(p);
  const centerBeam = W > 1200; const slatCount = Math.ceil((L - p.slatWidth) / (p.slatWidth + 70)) + 1;
  const slatGap = (L - slatCount * p.slatWidth) / (slatCount - 1);
  const material = `MDF${p.t}`; const beamThickness = L > 1800 ? p.t * 2 : p.t;

  const legX = W / 2 - 20; const legZ = L / 2 - 20;
  const railY = p.legHeight + 60; // rails (120mm tall) rest on top of the legs
  const slatY = p.legHeight + 120 + 4; // slats (8mm) rest on the rails/ledgers

  const parts: Part[] = [];
  const joints: Joint[] = [];
  let partNo = 0; let jointNo = 0;
  const addPart = (part: Omit<Part, 'id' | 'qty'>): string => {
    partNo += 1; const id = `P${String(partNo).padStart(2, '0')}`;
    parts.push({ id, qty: 1, ...part }); return id;
  };
  const addJoint = (joint: Omit<Joint, 'id'>): void => {
    jointNo += 1; joints.push({ id: `J${String(jointNo).padStart(2, '0')}`, ...joint });
  };

  const railL = addPart({ name: 'Side rail (left)', role: 'side_rail', size: { length: L + 2 * p.t, width: 120, thickness: p.t }, material, grain: 'length', transform: { t: [-legX, railY, 0], r: R_ALONG_LENGTH } });
  const railR = addPart({ name: 'Side rail (right)', role: 'side_rail', size: { length: L + 2 * p.t, width: 120, thickness: p.t }, material, grain: 'length', transform: { t: [legX, railY, 0], r: R_ALONG_LENGTH } });
  const headRail = addPart({ name: 'Head rail', role: 'head_rail', size: { length: W, width: 120, thickness: p.t }, material, grain: 'length', transform: { t: [0, railY, -L / 2], r: R_NONE } });
  const footRail = addPart({ name: 'Foot rail', role: 'foot_rail', size: { length: W, width: 120, thickness: p.t }, material, grain: 'length', transform: { t: [0, railY, L / 2], r: R_NONE } });

  const slatIds: string[] = [];
  for (let i = 0; i < slatCount; i += 1) {
    const z = -L / 2 + p.slatWidth / 2 + i * (p.slatWidth + slatGap);
    slatIds.push(addPart({ name: `Slat ${i + 1}`, role: 'slat', size: { length: W, width: p.slatWidth, thickness: 8 }, material: 'BEECH8', grain: 'length', transform: { t: [0, slatY, z], r: R_FLAT } }));
  }

  const ledgerL = addPart({ name: 'Slat ledger batten (left)', role: 'ledger', size: { length: L, width: 20, thickness: 20 }, material: 'BEECH20', grain: 'length', transform: { t: [-legX + p.t / 2 + 10, slatY - 14, 0], r: R_ALONG_LENGTH } });
  const ledgerR = addPart({ name: 'Slat ledger batten (right)', role: 'ledger', size: { length: L, width: 20, thickness: 20 }, material: 'BEECH20', grain: 'length', transform: { t: [legX - p.t / 2 - 10, slatY - 14, 0], r: R_ALONG_LENGTH } });

  const legIds: string[] = [];
  for (const x of [-legX, legX]) for (const z of [-legZ, legZ]) {
    legIds.push(addPart({ name: `Corner leg ${legIds.length + 1}`, role: 'leg', size: { length: p.legHeight, width: 40, thickness: 40 }, material: 'BEECH40', grain: 'length', transform: { t: [x, p.legHeight / 2, z], r: R_UPRIGHT } }));
  }

  let centerBeamId: string | undefined; const centerLegIds: string[] = [];
  if (centerBeam) {
    centerBeamId = addPart({ name: 'Center beam', role: 'center_beam', size: { length: L, width: 120, thickness: beamThickness }, material: `MDF${beamThickness}`, grain: 'length', transform: { t: [0, railY, 0], r: R_ALONG_LENGTH } });
    const centerLegCount = Math.ceil(L / 800) + 1;
    for (let i = 0; i < centerLegCount; i += 1) {
      const z = centerLegCount > 1 ? -L / 2 + (i / (centerLegCount - 1)) * L : 0;
      centerLegIds.push(addPart({ name: `Center leg ${i + 1}`, role: 'center_leg', size: { length: p.legHeight, width: 40, thickness: 40 }, material: 'BEECH40', grain: 'length', transform: { t: [0, p.legHeight / 2, z], r: R_UPRIGHT } }));
    }
  }

  let headboardId: string | undefined;
  if (p.headboard) {
    headboardId = addPart({ name: 'Headboard panel', role: 'headboard', size: { length: W + 2 * p.t, width: p.headboardHeight, thickness: p.t }, material, grain: 'length', transform: { t: [0, p.headboardHeight / 2, -L / 2 - p.t], r: R_NONE } });
  }

  const drawerIds: string[] = [];
  if (p.underBedStorage === 'drawers') {
    const drawerWidth = Math.max(250, W / p.storageDrawerCount - 40);
    for (let i = 0; i < p.storageDrawerCount; i += 1) {
      const x = (i - (p.storageDrawerCount - 1) / 2) * (W / p.storageDrawerCount);
      drawerIds.push(addPart({ name: `Under-bed drawer ${i + 1}`, role: 'storage_drawer', size: { length: L / 2 - 50, width: drawerWidth, thickness: 15 }, material: 'MDF15', grain: 'length', transform: { t: [x, p.legHeight / 2 - 20, -L / 4], r: R_DRAWER } }));
    }
  }

  addJoint({ kind: 'rail_bracket', partA: railL, partB: headRail, count: 1, structural: true });
  addJoint({ kind: 'rail_bracket', partA: railR, partB: headRail, count: 1, structural: true });
  addJoint({ kind: 'rail_bracket', partA: railL, partB: footRail, count: 1, structural: true });
  addJoint({ kind: 'rail_bracket', partA: railR, partB: footRail, count: 1, structural: true });
  addJoint({ kind: 'screw', partA: railL, partB: ledgerL, count: 4, structural: true });
  addJoint({ kind: 'screw', partA: railR, partB: ledgerR, count: 4, structural: true });
  if (centerBeamId) addJoint({ kind: 'rail_bracket', partA: headRail, partB: centerBeamId, count: 4, structural: true });
  if (headboardId) addJoint({ kind: 'screw', partA: headboardId, partB: headRail, count: 4, structural: true });

  const hardware: HardwareItem[] = [
    { kind: 'bed_rail_fitting', count: 8 }, { kind: 'slat_end_cap', count: slatCount * 2 },
    { kind: 'leg_mounting_bracket', count: legIds.length + centerLegIds.length },
  ];
  if (centerBeamId) hardware.push({ kind: 'center_beam_angle_bracket', count: 8 });
  if (headboardId) hardware.push({ kind: 'headboard_fixing', count: 4 });
  if (drawerIds.length) hardware.push({ kind: 'drawer_slide_pair', count: drawerIds.length });

  return { graphVersion: 1, source: { projectId: spec.projectId, revision: spec.revision }, units: 'mm', parts, joints, hardware,
    boundingBox: { w: W + 2 * p.t, h: Math.max(railY + 60, p.headboard ? p.headboardHeight : 0), d: L + 2 * p.t + (p.headboard ? p.t * 2 : 0) },
    warnings: [ ...(L > 1800 ? ['Center beam is laminated to 36 mm for this long span.'] : []), ...(slatGap > 70 ? ['Slat gap exceeds 70 mm; revise slat stock.'] : []) ], };
}

export const bedTemplate: ProductTemplate = { productType: 'bed', paramSchema: { type: 'object' }, validate, build };
