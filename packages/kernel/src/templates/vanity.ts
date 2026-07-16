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
function build(spec: DesignSpec, profile: ManufacturerProfile): PartGraph {
  const p = params(spec); const ph = p.height - p.t; const drawerHeight = p.drawerCount ? (ph - p.t - (p.drawerCount + 1) * 3) / p.drawerCount : 0; const drawerDepth = p.depth - 50; const material = `MDF${p.t}`;
  const parts: Part[] = [
    { id: 'P01', name: 'Worktop', role: 'worktop', qty: 1, size: { length: p.width, width: p.depth, thickness: p.t }, material, grain: 'length' },
    { id: 'P02', name: 'Pedestal side', role: 'pedestal_side', qty: 2, size: { length: ph, width: p.depth, thickness: p.t }, material, grain: 'length' },
    { id: 'P03', name: 'Pedestal bottom', role: 'pedestal_bottom', qty: 1, size: { length: p.pedestalWidth - 2 * p.t, width: p.depth, thickness: p.t }, material, grain: 'length' },
    { id: 'P04', name: 'Pedestal back', role: 'pedestal_back', qty: 1, size: { length: ph, width: p.pedestalWidth, thickness: p.tBack }, material: `MDF${p.tBack}`, grain: 'length' },
    { id: 'P05', name: 'Front apron', role: 'front_apron', qty: 1, size: { length: p.width - p.pedestalWidth - 40, width: p.apronHeight, thickness: p.t }, material, grain: 'length' },
    { id: 'P06', name: 'Back apron', role: 'back_apron', qty: 1, size: { length: p.width - p.pedestalWidth - 40, width: p.apronHeight + 50, thickness: p.t }, material, grain: 'length' },
    { id: 'P07', name: 'Open-side leg', role: 'leg', qty: 2, size: { length: ph, width: 40, thickness: 40 }, material: 'BEECH40', grain: 'length' },
  ];
  if (p.mirror) { parts.push({ id: 'P08', name: 'Mirror support riser', role: 'mirror_riser', qty: 2, size: { length: p.mirrorHeight + 50, width: 40, thickness: p.t }, material, grain: 'length' }, { id: 'P09', name: 'Mirror backing panel', role: 'mirror_backing', qty: 1, size: { length: p.mirrorHeight, width: p.mirrorWidth, thickness: p.tBack }, material: `MDF${p.tBack}`, grain: 'length' }); }
  if (p.drawerCount) parts.push({ id: 'P10', name: 'Drawer front', role: 'drawer_front', qty: p.drawerCount, size: { length: p.pedestalWidth - 4, width: drawerHeight, thickness: p.t }, material, grain: 'length' }, { id: 'P11', name: 'Drawer box side', role: 'drawer_side', qty: p.drawerCount * 2, size: { length: drawerDepth, width: drawerHeight - 10, thickness: p.t2 }, material: `MDF${p.t2}`, grain: 'length' }, { id: 'P12', name: 'Drawer box back', role: 'drawer_back', qty: p.drawerCount, size: { length: p.pedestalWidth - 4 - 2 * p.t2, width: drawerHeight - 30, thickness: p.t2 }, material: `MDF${p.t2}`, grain: 'length' }, { id: 'P13', name: 'Drawer bottom', role: 'drawer_bottom', qty: p.drawerCount, size: { length: drawerDepth + 12, width: p.pedestalWidth - 4 - 2 * p.t2 + 12, thickness: p.tBack }, material: `MDF${p.tBack}`, grain: 'length' });
  const joints: Joint[] = [{ id: 'J01', kind: 'confirmat', partA: 'P02', partB: 'P03', count: 8, structural: true }, { id: 'J02', kind: 'screw', partA: 'P02', partB: 'P01', count: 8, structural: true }, { id: 'J03', kind: 'rail_bracket', partA: 'P07', partB: 'P01', count: 2, structural: true }];
  const hardware: HardwareItem[] = [{ sku: profile.stableCatalog.fasteners?.[0]?.sku, kind: 'pedestal_confirmat', count: 8 }, { kind: 'worktop_fixing', count: 8 }, { kind: 'leg_mounting_bracket', count: 2 }];
  if (p.drawerCount) hardware.push({ kind: 'drawer_slide_pair', count: p.drawerCount }, { kind: 'drawer_knob', count: p.drawerCount }, { kind: 'drawer_box_joinery', count: p.drawerCount * 8 });
  if (p.mirror) hardware.push({ kind: 'mirror_riser_fixing', count: 4 }, { kind: 'mirror_backing_fixing', count: 4 }, { kind: 'mirror_clip', count: 4 });
  return { graphVersion: 1, source: { projectId: spec.projectId, revision: spec.revision }, units: 'mm', parts, joints, hardware, boundingBox: { w: p.width, h: p.height + (p.mirror ? p.mirrorHeight + 50 : 0), d: p.depth }, warnings: [] };
}
export const vanityTemplate: ProductTemplate = { productType: 'vanity', paramSchema: { type: 'object' }, validate, build };
