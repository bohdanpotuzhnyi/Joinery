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

function build(spec: DesignSpec, profile: ManufacturerProfile): PartGraph {
  const p = params(spec); const { width: W, length: L } = interior(p);
  const centerBeam = W > 1200; const slatCount = Math.ceil((L - p.slatWidth) / (p.slatWidth + 70)) + 1;
  const slatGap = (L - slatCount * p.slatWidth) / (slatCount - 1);
  const material = `MDF${p.t}`; const beamThickness = L > 1800 ? p.t * 2 : p.t;
  const parts: Part[] = [
    { id: 'P01', name: 'Side rail', role: 'side_rail', qty: 2, size: { length: L + 2 * p.t, width: 120, thickness: p.t }, material, grain: 'length' },
    { id: 'P02', name: 'Head rail', role: 'head_rail', qty: 1, size: { length: W, width: 120, thickness: p.t }, material, grain: 'length' },
    { id: 'P03', name: 'Foot rail', role: 'foot_rail', qty: 1, size: { length: W, width: 120, thickness: p.t }, material, grain: 'length' },
    { id: 'P04', name: 'Slat', role: 'slat', qty: slatCount, size: { length: W, width: p.slatWidth, thickness: 8 }, material: 'BEECH8', grain: 'length' },
    { id: 'P05', name: 'Slat ledger batten', role: 'ledger', qty: 2, size: { length: L, width: 20, thickness: 20 }, material: 'BEECH20', grain: 'length' },
    { id: 'P06', name: 'Corner leg', role: 'leg', qty: 4, size: { length: p.legHeight, width: 40, thickness: 40 }, material: 'BEECH40', grain: 'length' },
  ];
  if (centerBeam) {
    parts.push({ id: 'P07', name: 'Center beam', role: 'center_beam', qty: 1, size: { length: L, width: 120, thickness: beamThickness }, material: `MDF${beamThickness}`, grain: 'length' });
    parts.push({ id: 'P08', name: 'Center leg', role: 'center_leg', qty: Math.ceil(L / 800) + 1, size: { length: p.legHeight, width: 40, thickness: 40 }, material: 'BEECH40', grain: 'length' });
  }
  if (p.headboard) parts.push({ id: 'P09', name: 'Headboard panel', role: 'headboard', qty: 1, size: { length: W + 2 * p.t, width: p.headboardHeight, thickness: p.t }, material, grain: 'length' });
  if (p.underBedStorage === 'drawers') parts.push({ id: 'P10', name: 'Under-bed drawer', role: 'storage_drawer', qty: p.storageDrawerCount, size: { length: L / 2 - 50, width: Math.max(250, W / p.storageDrawerCount - 40), thickness: 15 }, material: 'MDF15', grain: 'length' });
  const joints: Joint[] = [
    { id: 'J01', kind: 'rail_bracket', partA: 'P01', partB: 'P02', count: 4, structural: true },
    { id: 'J02', kind: 'rail_bracket', partA: 'P01', partB: 'P03', count: 4, structural: true },
    { id: 'J03', kind: 'screw', partA: 'P01', partB: 'P05', count: 8, structural: true },
  ];
  if (centerBeam) joints.push({ id: 'J04', kind: 'rail_bracket', partA: 'P02', partB: 'P07', count: 8, structural: true });
  const hardware: HardwareItem[] = [
    { kind: 'bed_rail_fitting', count: 8 }, { kind: 'slat_end_cap', count: slatCount * 2 },
    { kind: 'leg_mounting_bracket', count: 4 + (centerBeam ? Math.ceil(L / 800) + 1 : 0) },
  ];
  if (centerBeam) hardware.push({ kind: 'center_beam_angle_bracket', count: 8 });
  if (p.headboard) hardware.push({ kind: 'headboard_fixing', count: 4 });
  if (p.underBedStorage === 'drawers') hardware.push({ kind: 'drawer_slide_pair', count: p.storageDrawerCount });
  return { graphVersion: 1, source: { projectId: spec.projectId, revision: spec.revision }, units: 'mm', parts, joints, hardware,
    boundingBox: { w: W + 2 * p.t, h: Math.max(120 + p.legHeight, p.headboard ? p.headboardHeight : 0), d: L + 2 * p.t },
    warnings: [ ...(L > 1800 ? ['Center beam is laminated to 36 mm for this long span.'] : []), ...(slatGap > 70 ? ['Slat gap exceeds 70 mm; revise slat stock.'] : []) ], };
}

export const bedTemplate: ProductTemplate = { productType: 'bed', paramSchema: { type: 'object' }, validate, build };
