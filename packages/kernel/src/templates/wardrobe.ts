// SPDX-License-Identifier: AGPL-3.0-or-later
// Wardrobe parametric template — formulas per design/02-products.md §1, plus
// SECTIONS: the wardrobe is a row of vertical compartments, each open or
// closed (own door), with its own interior (shelves, hanging rail) and
// optional shelves mounted on the door interior.
//
// Placement convention (drives GLB/OBJ):
//   world X = width (right+), Y = height (up+), Z = depth (front+);
//   origin at the CENTER of the footprint on the floor.
//   Part local axes: X = length, Y = width, Z = thickness. Rotations (deg):
//   [0,90,90]  vertical side-facing panels (sides, dividers): L→Y, W→Z, T→X
//   [0,0,90]   vertical front-facing panels (back, doors):    L→Y, W→X, T→Z
//   [90,0,0]   horizontal panels (top, bottom, shelves):      L→X, W→Z, T→Y
import type {
  DesignSpec, ManufacturerProfile, PartGraph, Part, Joint, HardwareItem,
} from '@furniture/contracts';
import type { ConstraintError, ProductTemplate } from '../template';

export interface WardrobeSection {
  closed: boolean;        // closed = has its own door
  shelves?: number;       // interior shelves ("plates")
  hangingRail?: boolean;
  doorShelves?: number;   // shallow shelves mounted on the door interior (closed only)
}

export interface WardrobeParams {
  width: number;      // W, mm
  height: number;     // H, mm
  depth: number;      // D, mm
  doorCount?: number;     // classic mode (no sections): doors across one zone
  shelfCount?: number;    // classic mode: shelves in the single zone
  hangingRail?: boolean;  // classic mode
  sections?: WardrobeSection[];
  t?: number;         // carcass thickness, default 18
  tBack?: number;     // back panel thickness, default 12
}

const REVEAL = 2;          // r, mm — overlay door reveal per outer edge
const DOOR_GAP = 3;        // mm between doors
const MAX_DOOR_WIDTH = 600;
const MIN_DOOR_WIDTH = 300;
const MAX_SHELF_SPAN = 800;    // 18 mm board sag limit
const MIN_SECTION_WIDTH = 250;
const MIN_SHELF_SPACING = 250;
const RAIL_MIN_DEPTH = 580;
const RAIL_MIN_HEIGHT = 1300;
const RAIL_DROP = 250;         // rail sits this far below the underside of the top
const DOOR_SHELF_DEPTH = 100;
const MAX_DOOR_SHELVES = 6;
const MAX_SECTIONS = 8;

export const paramSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'WardrobeParams',
  type: 'object',
  required: ['width', 'height', 'depth'],
  additionalProperties: false,
  properties: {
    width: { type: 'number', minimum: 400, maximum: 4000 },
    height: { type: 'number', minimum: 1200, maximum: 2400 },
    depth: { type: 'number', minimum: 300, maximum: 700 },
    doorCount: { type: 'integer', minimum: 1, maximum: 5 },
    shelfCount: { type: 'integer', minimum: 0, maximum: 12 },
    hangingRail: { type: 'boolean' },
    sections: {
      type: 'array', minItems: 1, maxItems: MAX_SECTIONS,
      items: {
        type: 'object', required: ['closed'], additionalProperties: false,
        properties: {
          closed: { type: 'boolean' },
          shelves: { type: 'integer', minimum: 0, maximum: 12 },
          hangingRail: { type: 'boolean' },
          doorShelves: { type: 'integer', minimum: 0, maximum: MAX_DOOR_SHELVES },
        },
      },
    },
    t: { type: 'number', minimum: 15, maximum: 25 },
    tBack: { type: 'number', minimum: 10, maximum: 15 },
  },
} as const;

interface Resolved {
  width: number; height: number; depth: number;
  t: number; tBack: number;
  /** unified model: classic mode becomes one section holding doorCount doors */
  sections: Required<WardrobeSection>[];
  classic: boolean;
  classicDoorCount: number;
}

function params(spec: DesignSpec): Resolved {
  const p = spec.parameters as unknown as WardrobeParams;
  const t = p.t ?? 18;
  if (p.sections && p.sections.length > 0) {
    return {
      width: p.width, height: p.height, depth: p.depth, t, tBack: p.tBack ?? 12,
      classic: false, classicDoorCount: 0,
      sections: p.sections.map((s) => ({
        closed: s.closed,
        shelves: s.shelves ?? 0,
        hangingRail: s.hangingRail ?? false,
        doorShelves: s.closed ? (s.doorShelves ?? 0) : 0,
      })),
    };
  }
  return {
    width: p.width, height: p.height, depth: p.depth, t, tBack: p.tBack ?? 12,
    classic: true,
    classicDoorCount: p.doorCount ?? Math.ceil(p.width / MAX_DOOR_WIDTH),
    sections: [{
      closed: (p.doorCount ?? 1) > 0,
      shelves: p.shelfCount ?? 4,
      hangingRail: p.hangingRail ?? true,
      doorShelves: 0,
    }],
  };
}

/** interior width of each section (equal sections, t-thick dividers between) */
function sectionInteriorWidth(width: number, t: number, n: number): number {
  return (width - 2 * t - (n - 1) * t) / n;
}

function validate(spec: DesignSpec, profile: ManufacturerProfile): ConstraintError[] {
  const errors: ConstraintError[] = [];
  const p = params(spec);
  const { width: W, height: H, depth: D, t } = p;

  for (const [key, val, min, max] of [
    ['width', W, 400, 4000],
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

  const n = p.sections.length;
  const wsi = sectionInteriorWidth(W, t, n);

  if (p.classic) {
    // Classic single-zone rules (design/02 §1.2).
    const doors = p.classicDoorCount;
    const nMin = Math.ceil(W / MAX_DOOR_WIDTH);
    const nMax = Math.floor(W / MIN_DOOR_WIDTH);
    if (doors < nMin) {
      errors.push({
        code: 'door_too_wide', param: 'doorCount',
        message: `A ${W} mm wide wardrobe needs at least ${nMin} doors — doors wider than ${MAX_DOOR_WIDTH} mm warp and strain their hinges.`,
      });
    }
    if (doors > nMax) {
      errors.push({
        code: 'door_too_narrow', param: 'doorCount',
        message: `${doors} doors on ${W} mm means doors narrower than ${MIN_DOOR_WIDTH} mm — maximum here is ${nMax}.`,
      });
    }
    if (wsi > MAX_SHELF_SPAN) {
      errors.push({
        code: 'needs_divider', param: 'width',
        message: `Interior width ${wsi} mm exceeds the ${MAX_SHELF_SPAN} mm shelf span limit — split the wardrobe into sections (each section adds a divider), or keep width ≤ ${MAX_SHELF_SPAN + 2 * t} mm.`,
      });
    }
  } else {
    // Sections mode.
    if (wsi < MIN_SECTION_WIDTH) {
      const maxSections = Math.floor((W - 2 * t + t) / (MIN_SECTION_WIDTH + t));
      errors.push({
        code: 'section_too_narrow', param: 'sections',
        message: `${n} sections on ${W} mm leaves only ${Math.round(wsi)} mm per section — sections need ≥ ${MIN_SECTION_WIDTH} mm. Use at most ${maxSections} sections or widen the wardrobe.`,
      });
    }
    if (wsi > MAX_SHELF_SPAN) {
      errors.push({
        code: 'section_too_wide', param: 'sections',
        message: `Each section would span ${Math.round(wsi)} mm — over the ${MAX_SHELF_SPAN} mm shelf sag limit. Add more sections.`,
      });
    }
    const doorWidth = (W - 2 * REVEAL - (n - 1) * DOOR_GAP) / n;
    if (p.sections.some((s) => s.closed) && (doorWidth > MAX_DOOR_WIDTH || doorWidth < MIN_DOOR_WIDTH)) {
      errors.push({
        code: 'section_door_width', param: 'sections',
        message: `Section doors would be ${Math.round(doorWidth)} mm wide — doors must be ${MIN_DOOR_WIDTH}–${MAX_DOOR_WIDTH} mm. Adjust width or section count.`,
      });
    }
  }

  // Per-section interior rules.
  const maxShelves = Math.floor((H - 2 * t) / MIN_SHELF_SPACING) - 1;
  p.sections.forEach((s, i) => {
    const label = p.classic ? 'shelfCount' : `sections[${i}]`;
    if (s.shelves > maxShelves) {
      errors.push({
        code: 'too_many_shelves', param: label,
        message: `At ${H} mm height, at most ${maxShelves} shelves keep a useful ${MIN_SHELF_SPACING} mm spacing (section ${i + 1} asks for ${s.shelves}).`,
      });
    }
    if (s.hangingRail && D < RAIL_MIN_DEPTH) {
      errors.push({
        code: 'rail_depth', param: 'depth',
        message: `A hanging rail needs ≥ ${RAIL_MIN_DEPTH} mm depth for hangers (got ${D}). Remove the rail in section ${i + 1} or increase depth.`,
      });
    }
    if (s.hangingRail && H < RAIL_MIN_HEIGHT) {
      errors.push({
        code: 'rail_height', param: 'height',
        message: `A hanging rail needs ≥ ${RAIL_MIN_HEIGHT} mm height for a useful clear drop (got ${H}).`,
      });
    }
    if (s.doorShelves > 0 && !s.closed) {
      errors.push({
        code: 'door_shelves_open', param: `sections[${i}]`,
        message: `Section ${i + 1} is open — door shelves need a door. Close the section or remove them.`,
      });
    }
    if (s.doorShelves > 0 && s.hangingRail) {
      errors.push({
        code: 'door_shelves_rail_clash', param: `sections[${i}]`,
        message: `Section ${i + 1}: door shelves (${DOOR_SHELF_DEPTH} mm deep) collide with hangers on the rail. Choose one per section.`,
      });
    }
  });

  // Room fit: the more the customer tells us, the earlier we catch problems.
  const room = spec.room;
  if (room?.heightMm && H > room.heightMm) {
    errors.push({ code: 'room_height', param: 'height', message: `The wardrobe is ${H} mm tall but the room ceiling is ${room.heightMm} mm.` });
  }
  if (room?.widthMm && W > room.widthMm) {
    errors.push({ code: 'room_width', param: 'width', message: `The wardrobe is ${W} mm wide but the wall is only ${room.widthMm} mm.` });
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

const R_SIDE: [number, number, number] = [0, 90, 90];   // L→Y, W→Z, T→X
const R_FRONT: [number, number, number] = [0, 0, 90];   // L→Y, W→X, T→Z
const R_FLAT: [number, number, number] = [90, 0, 0];    // L→X, W→Z, T→Y
const R_NONE: [number, number, number] = [0, 0, 0];

function build(spec: DesignSpec, profile: ManufacturerProfile): PartGraph {
  const p = params(spec);
  const { width: W, height: H, depth: D, t, tBack } = p;
  const n = p.sections.length;
  const wsi = sectionInteriorWidth(W, t, n);
  const material = `MDF${t}`;

  const parts: Part[] = [];
  const joints: Joint[] = [];
  let partNo = 0;
  let jointNo = 0;
  const addPart = (part: Omit<Part, 'id' | 'qty'>): string => {
    partNo += 1;
    const id = `P${String(partNo).padStart(2, '0')}`;
    parts.push({ id, qty: 1, ...part });
    return id;
  };
  const addJoint = (joint: Omit<Joint, 'id'>): void => {
    jointNo += 1;
    joints.push({ id: `J${String(jointNo).padStart(2, '0')}`, ...joint });
  };

  const camSku = profile.stableCatalog.connectors?.find((c) => c.kind === 'cam_dowel_pair')?.sku;
  const hingeSku = profile.stableCatalog.hinges?.[0]?.sku;
  const camPerJoint = camDowelPerJoint(D);

  // ---- carcass ----
  const sideL = addPart({
    name: 'Side panel (left)', role: 'side',
    size: { length: H, width: D, thickness: t }, material, grain: 'length',
    transform: { t: [-(W - t) / 2, H / 2, 0], r: R_SIDE },
  });
  const sideR = addPart({
    name: 'Side panel (right)', role: 'side',
    size: { length: H, width: D, thickness: t }, material, grain: 'length',
    transform: { t: [(W - t) / 2, H / 2, 0], r: R_SIDE },
  });
  const bottom = addPart({
    name: 'Bottom panel', role: 'bottom',
    size: { length: W - 2 * t, width: D, thickness: t }, material, grain: 'length',
    transform: { t: [0, t / 2, 0], r: R_FLAT },
  });
  const top = addPart({
    name: 'Top panel', role: 'top',
    size: { length: W - 2 * t, width: D, thickness: t }, material, grain: 'length',
    transform: { t: [0, H - t / 2, 0], r: R_FLAT },
  });
  const back = addPart({
    name: 'Back panel', role: 'back',
    size: { length: H, width: W, thickness: tBack }, material: `MDF${tBack}`, grain: 'length',
    transform: { t: [0, H / 2, -(D - tBack) / 2], r: R_FRONT },
  });
  addJoint({ kind: 'cam_dowel', partA: sideL, partB: bottom, hardwareSku: camSku, count: camPerJoint, structural: true });
  addJoint({ kind: 'cam_dowel', partA: sideR, partB: bottom, hardwareSku: camSku, count: camPerJoint, structural: true });
  addJoint({ kind: 'cam_dowel', partA: sideL, partB: top, hardwareSku: camSku, count: camPerJoint, structural: true });
  addJoint({ kind: 'cam_dowel', partA: sideR, partB: top, hardwareSku: camSku, count: camPerJoint, structural: true });
  const backScrews = Math.ceil((2 * (W + H)) / 150) + 4;
  addJoint({ kind: 'screw', partA: sideL, partB: back, count: backScrews, structural: true });

  // ---- dividers between sections ----
  const pitch = wsi + t;
  const dividerIds: string[] = [];
  for (let j = 1; j < n; j += 1) {
    const x = -W / 2 + t + j * pitch - t / 2;
    const id = addPart({
      name: `Divider ${j}`, role: 'divider',
      size: { length: H - 2 * t, width: D - 10, thickness: t }, material, grain: 'length',
      transform: { t: [x, H / 2, -5], r: R_SIDE },
    });
    dividerIds.push(id);
    addJoint({ kind: 'cam_dowel', partA: bottom, partB: id, hardwareSku: camSku, count: camPerJoint, structural: true });
    addJoint({ kind: 'cam_dowel', partA: top, partB: id, hardwareSku: camSku, count: camPerJoint, structural: true });
  }
  /** left/right supporting wall of a section, for joints */
  const wallLeft = (s: number) => (s === 0 ? sideL : dividerIds[s - 1]);

  // ---- per-section interiors and doors ----
  const doorHeight = H - 2 * REVEAL;
  const doorWidth = p.classic
    ? (W - 2 * REVEAL - (p.classicDoorCount - 1) * DOOR_GAP) / Math.max(1, p.classicDoorCount)
    : (W - 2 * REVEAL - (n - 1) * DOOR_GAP) / n;
  const hardware: HardwareItem[] = [];
  let totalShelves = 0;
  let totalDoors = 0;
  let totalDoorShelves = 0;
  let totalRails = 0;
  let railBrackets = 0;

  p.sections.forEach((section, s) => {
    const sectionCenterX = -W / 2 + t + s * pitch + wsi / 2;
    // interior shelves ("plates")
    for (let k = 0; k < section.shelves; k += 1) {
      const gap = (H - 2 * t) / (section.shelves + 1);
      const id = addPart({
        name: n > 1 ? `Shelf (section ${s + 1})` : 'Shelf (adjustable)', role: 'shelf',
        size: { length: wsi, width: D - 10, thickness: t }, material, grain: 'length',
        transform: { t: [sectionCenterX, t + gap * (k + 1), 5], r: R_FLAT },
      });
      addJoint({ kind: 'shelf_pins', partA: wallLeft(s), partB: id, count: 4, structural: false });
      totalShelves += 1;
    }
    // hanging rail
    if (section.hangingRail) {
      const id = addPart({
        name: n > 1 ? `Hanging rail (section ${s + 1})` : 'Hanging rail', role: 'rail',
        size: { length: wsi - 4, width: 25, thickness: 25 }, material: 'steel_tube_25',
        transform: { t: [sectionCenterX, H - t - RAIL_DROP, 0], r: R_NONE },
      });
      addJoint({ kind: 'rail_bracket', partA: wallLeft(s), partB: id, count: 2, structural: false });
      totalRails += 1;
      railBrackets += 2 + Math.floor(Math.max(0, wsi - 1) / 1000);
    }
    // doors: classic zone holds classicDoorCount doors; a closed section holds one
    const sectionDoors = p.classic ? (section.closed ? p.classicDoorCount : 0) : (section.closed ? 1 : 0);
    for (let d = 0; d < sectionDoors; d += 1) {
      const slot = p.classic ? d : s;
      const doorX = -W / 2 + REVEAL + doorWidth * (slot + 0.5) + slot * DOOR_GAP;
      const id = addPart({
        name: p.classic ? `Door ${d + 1}` : `Door (section ${s + 1})`, role: 'door',
        size: { length: doorHeight, width: doorWidth, thickness: t }, material, grain: 'length',
        transform: { t: [doorX, H / 2, (D + t) / 2], r: R_FRONT },
      });
      addJoint({ kind: 'hinge', partA: wallLeft(p.classic ? 0 : s), partB: id, hardwareSku: hingeSku, count: hingesPerDoor(doorHeight), structural: false });
      totalDoors += 1;
      // shelves on the door interior
      for (let k = 0; k < section.doorShelves; k += 1) {
        const gap = doorHeight / (section.doorShelves + 1);
        const shelfId = addPart({
          name: `Door shelf (section ${s + 1})`, role: 'door_shelf',
          size: { length: doorWidth - 40, width: DOOR_SHELF_DEPTH, thickness: t }, material, grain: 'length',
          transform: { t: [doorX, REVEAL + gap * (k + 1), D / 2 - DOOR_SHELF_DEPTH / 2], r: R_FLAT },
        });
        addJoint({ kind: 'screw', partA: id, partB: shelfId, count: 4, structural: false });
        totalDoorShelves += 1;
      }
    }
  });

  // ---- hardware totals ----
  const carcassJoints = 4 + dividerIds.length * 2;
  hardware.push({ sku: camSku, kind: 'cam_dowel_pair', count: camPerJoint * carcassJoints });
  if (totalDoors > 0) {
    hardware.push({ sku: hingeSku, kind: 'hinge', count: hingesPerDoor(doorHeight) * totalDoors });
    hardware.push({ kind: 'door_handle', count: totalDoors });
  }
  hardware.push({ kind: 'back_panel_screw', count: backScrews });
  if (totalShelves > 0) hardware.push({ kind: 'shelf_pin', count: 4 * totalShelves });
  if (totalDoorShelves > 0) hardware.push({ kind: 'door_shelf_screw', count: 4 * totalDoorShelves });
  if (totalRails > 0) {
    hardware.push({ kind: 'rail_25mm', count: totalRails }, { kind: 'rail_bracket', count: railBrackets });
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
