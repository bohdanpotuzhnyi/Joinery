// SPDX-License-Identifier: AGPL-3.0-or-later
// Wardrobe parametric template — formulas per design/02-products.md §1.
// Conventions: sides run full height; top/bottom sit between the sides
// (interior width Wi = W − 2t); overlay back panel (W × H, t_back);
// overlay doors with reveal r = 2 mm and 3 mm inter-door gaps.
import type {
  DesignSpec, ManufacturerProfile, PartGraph, Part, Joint, HardwareItem,
} from '@furniture/contracts';
import type { ConstraintError, ProductTemplate } from '../template';

export interface WardrobeParams {
  width: number;      // W, mm
  height: number;     // H, mm
  depth: number;      // D, mm
  doorCount?: number;
  shelfCount?: number;
  hangingRail?: boolean;
  t?: number;         // carcass thickness, default 18
  tBack?: number;     // back panel thickness, default 12
}

const REVEAL = 2;          // r, mm — overlay door reveal per outer edge
const DOOR_GAP = 3;        // mm between doors
const MAX_DOOR_WIDTH = 600;
const MIN_DOOR_WIDTH = 300;
const MAX_SHELF_SPAN = 800;    // 18 mm board sag limit
const MIN_SHELF_SPACING = 250;
const RAIL_MIN_DEPTH = 580;
const RAIL_MIN_HEIGHT = 1300;

export const paramSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'WardrobeParams',
  type: 'object',
  required: ['width', 'height', 'depth'],
  additionalProperties: false,
  properties: {
    width: { type: 'number', minimum: 400, maximum: 2500 },
    height: { type: 'number', minimum: 1200, maximum: 2400 },
    depth: { type: 'number', minimum: 300, maximum: 700 },
    doorCount: { type: 'integer', minimum: 1, maximum: 5 },
    shelfCount: { type: 'integer', minimum: 0, maximum: 12 },
    hangingRail: { type: 'boolean' },
    t: { type: 'number', minimum: 15, maximum: 25 },
    tBack: { type: 'number', minimum: 10, maximum: 15 },
  },
} as const;

function params(spec: DesignSpec): Required<WardrobeParams> {
  const p = spec.parameters as unknown as WardrobeParams;
  return {
    width: p.width,
    height: p.height,
    depth: p.depth,
    doorCount: p.doorCount ?? Math.ceil(p.width / MAX_DOOR_WIDTH),
    shelfCount: p.shelfCount ?? 4,
    hangingRail: p.hangingRail ?? true,
    t: p.t ?? 18,
    tBack: p.tBack ?? 12,
  };
}

function validate(spec: DesignSpec, profile: ManufacturerProfile): ConstraintError[] {
  const errors: ConstraintError[] = [];
  const p = params(spec);
  const { width: W, height: H, depth: D, doorCount: n, shelfCount, hangingRail, t } = p;

  for (const [key, val, min, max] of [
    ['width', W, 400, 2500],
    ['height', H, 1200, 2400],
    ['depth', D, 300, 700],
  ] as const) {
    if (!(typeof val === 'number') || Number.isNaN(val)) {
      errors.push({ code: 'missing_param', param: key, message: `${key} is required (in mm).` });
    } else if (val < min || val > max) {
      errors.push({ code: 'out_of_range', param: key, message: `${key} must be between ${min} and ${max} mm (got ${val}).` });
    }
  }
  if (errors.length > 0) return errors;

  // Rule 1+2: door count bounds from door-width limits.
  const nMin = Math.ceil(W / MAX_DOOR_WIDTH);
  const nMax = Math.floor(W / MIN_DOOR_WIDTH);
  if (n < nMin) {
    errors.push({
      code: 'door_too_wide', param: 'doorCount',
      message: `A ${W} mm wide wardrobe needs at least ${nMin} doors — doors wider than ${MAX_DOOR_WIDTH} mm warp and strain their hinges.`,
    });
  }
  if (n > nMax) {
    errors.push({
      code: 'door_too_narrow', param: 'doorCount',
      message: `${n} doors on ${W} mm means doors narrower than ${MIN_DOOR_WIDTH} mm — maximum here is ${nMax}.`,
    });
  }

  // Rule 3: shelf span vs sag — MVP: require width small enough to avoid dividers.
  const Wi = W - 2 * t;
  if (Wi > MAX_SHELF_SPAN) {
    errors.push({
      code: 'needs_divider', param: 'width',
      message: `Interior width ${Wi} mm exceeds the ${MAX_SHELF_SPAN} mm shelf span limit — a vertical divider is required (not yet supported in this template version; keep width ≤ ${MAX_SHELF_SPAN + 2 * t} mm).`,
    });
  }

  // Rule 4: shelf count vs usable spacing.
  const maxShelves = Math.floor((H - 2 * t) / MIN_SHELF_SPACING) - 1;
  if (shelfCount > maxShelves) {
    errors.push({
      code: 'too_many_shelves', param: 'shelfCount',
      message: `At ${H} mm height, at most ${maxShelves} shelves keep a useful ${MIN_SHELF_SPACING} mm spacing (got ${shelfCount}).`,
    });
  }

  // Rules 5+6: hanging rail needs depth and clear drop.
  if (hangingRail && D < RAIL_MIN_DEPTH) {
    errors.push({
      code: 'rail_depth', param: 'depth',
      message: `A hanging rail needs ≥ ${RAIL_MIN_DEPTH} mm depth for hangers (got ${D}). Reduce to shelves-only or increase depth.`,
    });
  }
  if (hangingRail && H < RAIL_MIN_HEIGHT) {
    errors.push({
      code: 'rail_height', param: 'height',
      message: `A hanging rail needs ≥ ${RAIL_MIN_HEIGHT} mm height for a useful clear drop (got ${H}).`,
    });
  }

  // Manufacturer envelope: every part must fit the cnc_wood_2d capability.
  const cnc = profile.capabilities.find((c) => c.process === 'cnc_wood_2d');
  if (!cnc) {
    errors.push({ code: 'no_cnc', message: `${profile.identity.name} has no flat-part CNC capability — cannot produce carcass panels.` });
  } else if (cnc.envelopeMm?.x && cnc.envelopeMm?.y) {
    const maxLen = Math.max(cnc.envelopeMm.x, cnc.envelopeMm.y);
    const minLen = Math.min(cnc.envelopeMm.x, cnc.envelopeMm.y);
    if (H > maxLen || D > minLen) {
      errors.push({
        code: 'exceeds_envelope', param: 'height',
        message: `Side panel ${H}×${D} mm exceeds this manufacturer's part envelope of ${cnc.envelopeMm.x}×${cnc.envelopeMm.y} mm.`,
      });
    }
  }

  return errors;
}

function hingesPerDoor(doorHeight: number): number {
  if (doorHeight <= 900) return 2;
  if (doorHeight <= 1600) return 3;
  if (doorHeight <= 2000) return 4;
  if (doorHeight <= 2400) return 5;
  return 5 + Math.ceil((doorHeight - 2400) / 400);
}

/** Cam/dowel pairs per carcass joint (design/02 §1.4, default RTA joinery). */
function camDowelPerJoint(span: number): number {
  return 2 + Math.max(0, Math.ceil((span - 600) / 300));
}

function build(spec: DesignSpec, profile: ManufacturerProfile): PartGraph {
  const p = params(spec);
  const { width: W, height: H, depth: D, doorCount: n, shelfCount, hangingRail, t, tBack } = p;
  const Wi = W - 2 * t;
  const k = n - 1;
  const doorHeight = H - 2 * REVEAL;
  const doorWidth = (W - 2 * REVEAL - k * DOOR_GAP) / n;
  const material = `MDF${t}`;
  const backMaterial = `MDF${tBack}`;

  const parts: Part[] = [
    { id: 'P01', name: 'Side panel', role: 'side', qty: 2, size: { length: H, width: D, thickness: t }, material, grain: 'length' },
    { id: 'P02', name: 'Top panel', role: 'top', qty: 1, size: { length: Wi, width: D, thickness: t }, material, grain: 'length' },
    { id: 'P03', name: 'Bottom panel', role: 'bottom', qty: 1, size: { length: Wi, width: D, thickness: t }, material, grain: 'length' },
    { id: 'P04', name: 'Back panel', role: 'back', qty: 1, size: { length: H, width: W, thickness: tBack }, material: backMaterial, grain: 'length' },
    { id: 'P05', name: 'Door', role: 'door', qty: n, size: { length: doorHeight, width: doorWidth, thickness: t }, material, grain: 'length' },
  ];
  if (shelfCount > 0) {
    parts.push({
      id: 'P06', name: 'Shelf (adjustable)', role: 'shelf', qty: shelfCount,
      size: { length: Wi, width: D - 10, thickness: t }, material, grain: 'length',
    });
  }

  const camSku = profile.stableCatalog.connectors?.find((c) => c.kind === 'cam_dowel_pair')?.sku;
  const hingeSku = profile.stableCatalog.hinges?.[0]?.sku;
  const camPerJoint = camDowelPerJoint(D);

  const joints: Joint[] = [
    { id: 'J01', kind: 'cam_dowel', partA: 'P01', partB: 'P03', hardwareSku: camSku, count: camPerJoint, structural: true },
    { id: 'J02', kind: 'cam_dowel', partA: 'P01', partB: 'P02', hardwareSku: camSku, count: camPerJoint, structural: true },
    { id: 'J03', kind: 'screw', partA: 'P01', partB: 'P04', count: Math.ceil((2 * (W + H)) / 150) + 4, structural: true },
    { id: 'J04', kind: 'hinge', partA: 'P01', partB: 'P05', hardwareSku: hingeSku, count: hingesPerDoor(doorHeight) * n, structural: false },
  ];
  if (shelfCount > 0) {
    joints.push({ id: 'J05', kind: 'shelf_pins', partA: 'P01', partB: 'P06', count: 4 * shelfCount, structural: false });
  }

  const hardware: HardwareItem[] = [
    // 4 carcass joints: side↔bottom ×2, side↔top ×2 (one per side)
    { sku: camSku, kind: 'cam_dowel_pair', count: camPerJoint * 4 },
    { sku: hingeSku, kind: 'hinge', count: hingesPerDoor(doorHeight) * n },
    { kind: 'back_panel_screw', count: Math.ceil((2 * (W + H)) / 150) + 4 },
    { kind: 'door_handle', count: n },
  ];
  if (shelfCount > 0) hardware.push({ kind: 'shelf_pin', count: 4 * shelfCount });
  if (hangingRail) {
    hardware.push({ kind: 'rail_25mm', count: 1 }, { kind: 'rail_bracket', count: 2 + Math.floor(Math.max(0, Wi - 1) / 1000) });
  }

  return {
    graphVersion: 1,
    source: { projectId: spec.projectId, revision: spec.revision },
    units: 'mm',
    parts,
    joints,
    hardware,
    boundingBox: { w: W, h: H, d: D },
    warnings: H > 1800 ? ['Tall unit: wall-anchor step is mandatory in the assembly manual.'] : [],
  };
}

export const wardrobeTemplate: ProductTemplate = {
  productType: 'wardrobe',
  paramSchema,
  validate,
  build,
};
