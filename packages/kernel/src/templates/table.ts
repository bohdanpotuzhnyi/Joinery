// SPDX-License-Identifier: AGPL-3.0-or-later
// Table template — the candidate flow: the manufacturer provides PREDEFINED
// LEGS (stableCatalog.legs SKUs); tops are CUSTOM. From a free-form brief we
// GENERATE top×leg variants, all of them are laid out side by side in one
// PartGraph (that's the 3D-print candidate pack), the customer picks the
// printed one (spec.parameters.selectedVariant), and only that variant is
// built for production.
// Placement conventions identical to wardrobe.ts (X width, Y up, Z depth).
import type {
  DesignSpec, ManufacturerProfile, PartGraph, Part, Joint, HardwareItem, RoomContext, SkuEntry,
} from '@furniture/contracts';
import type { ConstraintError, ProductTemplate } from '../template';

export type TopShape = 'rect' | 'rounded' | 'oval' | 'round';

export interface TableVariant {
  shape: TopShape;
  /** top length (or diameter for round), mm */
  length: number;
  /** top width, mm (ignored for round) */
  width: number;
  /** top thickness, mm */
  thickness: number;
  /** predefined leg from the manufacturer catalog */
  legSku: string;
  label?: string;
}

export interface TableParams {
  variants: TableVariant[];
  /** index into variants once the customer picked the printed candidate */
  selectedVariant?: number;
}

const TOP_MIN = 500, TOP_MAX_L = 2400, TOP_MAX_W = 1200, ROUND_MAX = 1600;
const HEIGHT_MIN = 700, HEIGHT_MAX = 760;   // ergonomic finished dining height
const LEG_INSET = 80;                        // leg center inset from top edge
const CANDIDATE_GAP = 300;                   // spacing in the candidate pack

export const paramSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'TableParams',
  type: 'object',
  required: ['variants'],
  additionalProperties: false,
  properties: {
    variants: {
      type: 'array', minItems: 1, maxItems: 8,
      items: {
        type: 'object',
        required: ['shape', 'length', 'width', 'thickness', 'legSku'],
        additionalProperties: false,
        properties: {
          shape: { type: 'string', enum: ['rect', 'rounded', 'oval', 'round'] },
          length: { type: 'number' },
          width: { type: 'number' },
          thickness: { type: 'number', minimum: 18, maximum: 50 },
          legSku: { type: 'string' },
          label: { type: 'string' },
        },
      },
    },
    selectedVariant: { type: 'integer', minimum: 0 },
  },
} as const;

function legHeight(leg: SkuEntry): number {
  return Number((leg.datasheet as { heightMm?: number } | undefined)?.heightMm ?? 710);
}

function params(spec: DesignSpec): TableParams {
  return spec.parameters as unknown as TableParams;
}

function activeVariants(spec: DesignSpec): { variants: TableVariant[]; selected: boolean } {
  const p = params(spec);
  if (p.selectedVariant !== undefined && p.variants[p.selectedVariant]) {
    return { variants: [p.variants[p.selectedVariant]], selected: true };
  }
  return { variants: p.variants, selected: false };
}

function validate(spec: DesignSpec, profile: ManufacturerProfile): ConstraintError[] {
  const errors: ConstraintError[] = [];
  const p = params(spec);
  if (!Array.isArray(p.variants) || p.variants.length === 0) {
    return [{ code: 'no_variants', param: 'variants', message: 'At least one table variant is required — generate proposals first.' }];
  }
  if (p.selectedVariant !== undefined && !p.variants[p.selectedVariant]) {
    errors.push({ code: 'bad_selection', param: 'selectedVariant', message: `Variant ${p.selectedVariant} does not exist (have ${p.variants.length}).` });
  }
  const legs = profile.stableCatalog.legs ?? [];
  if (legs.length === 0) {
    errors.push({ code: 'no_legs', message: `${profile.identity.name} has no predefined legs in their catalog — tables cannot be configured with them.` });
    return errors;
  }
  p.variants.forEach((v, i) => {
    const tag = `variants[${i}]`;
    const leg = legs.find((l) => l.sku === v.legSku);
    if (!leg) {
      errors.push({ code: 'unknown_leg', param: tag, message: `Variant ${i + 1}: leg "${v.legSku}" is not in ${profile.identity.name}'s catalog (${legs.map((l) => l.sku).join(', ')}).` });
      return;
    }
    const isRound = v.shape === 'round';
    const maxL = isRound ? ROUND_MAX : TOP_MAX_L;
    const maxW = isRound ? ROUND_MAX : TOP_MAX_W;
    if (v.length < TOP_MIN || v.length > maxL) {
      errors.push({ code: 'top_size', param: tag, message: `Variant ${i + 1}: ${isRound ? 'diameter' : 'length'} must be ${TOP_MIN}–${maxL} mm (got ${v.length}).` });
    }
    if (!isRound && (v.width < TOP_MIN || v.width > maxW)) {
      errors.push({ code: 'top_size', param: tag, message: `Variant ${i + 1}: width must be ${TOP_MIN}–${maxW} mm (got ${v.width}).` });
    }
    const height = legHeight(leg) + v.thickness;
    if (height < HEIGHT_MIN || height > HEIGHT_MAX) {
      errors.push({
        code: 'table_height', param: tag,
        message: `Variant ${i + 1}: leg "${leg.sku}" (${legHeight(leg)} mm) plus a ${v.thickness} mm top gives ${height} mm — dining tables need ${HEIGHT_MIN}–${HEIGHT_MAX} mm. Pick a different leg or thickness.`,
      });
    }
    // Room fit: only the piece itself for candidates; add chair clearance advice.
    const room = spec.room;
    const w = isRound ? v.length : v.length;
    const d = isRound ? v.length : v.width;
    if (room?.widthMm && w + 2 * 600 > room.widthMm) {
      errors.push({ code: 'room_clearance', param: tag, message: `Variant ${i + 1}: a ${w} mm top leaves less than 600 mm of chair space per side on a ${room.widthMm} mm wall. Shrink it or pick another spot.` });
    }
    if (room?.depthMm && d + 2 * 600 > room.depthMm) {
      errors.push({ code: 'room_clearance', param: tag, message: `Variant ${i + 1}: a ${d} mm deep top leaves less than 600 mm of chair space front/back in a ${room.depthMm} mm room.` });
    }
  });
  // Producibility: tops are flat parts → need cnc_wood_2d envelope.
  const cnc = profile.capabilities.find((c) => c.process === 'cnc_wood_2d');
  if (!cnc) {
    errors.push({ code: 'no_cnc', message: `${profile.identity.name} cannot cut custom tops (no flat-part capability).` });
  }
  return errors;
}

function build(spec: DesignSpec, profile: ManufacturerProfile): PartGraph {
  const { variants, selected } = activeVariants(spec);
  const legs = profile.stableCatalog.legs ?? [];
  const parts: Part[] = [];
  const joints: Joint[] = [];
  const hardware: HardwareItem[] = [];
  let partNo = 0;
  const addPart = (part: Omit<Part, 'id' | 'qty'>): string => {
    partNo += 1;
    const id = `P${String(partNo).padStart(2, '0')}`;
    parts.push({ id, qty: 1, ...part });
    return id;
  };

  // Lay candidates in a row along X; a single (selected) variant sits at origin.
  const widths = variants.map((v) => (v.shape === 'round' ? v.length : v.length));
  const totalW = widths.reduce((a, b) => a + b, 0) + CANDIDATE_GAP * (variants.length - 1);
  let cursor = -totalW / 2;
  let maxH = 0, maxD = 0;

  variants.forEach((v, i) => {
    const leg = legs.find((l) => l.sku === v.legSku)!;
    const lh = legHeight(leg);
    const isRound = v.shape === 'round';
    const w = widths[i];
    const d = isRound ? v.length : v.width;
    const cx = cursor + w / 2;
    cursor += w + CANDIDATE_GAP;
    maxH = Math.max(maxH, lh + v.thickness);
    maxD = Math.max(maxD, d);
    const shapeName = { rect: 'rectangular', rounded: 'rounded-corner', oval: 'oval', round: 'round' }[v.shape];
    const suffix = selected ? '' : ` [candidate ${String.fromCharCode(65 + i)}]`;

    const topId = addPart({
      name: `Table top, ${shapeName}${suffix}`, role: 'top',
      size: { length: v.length, width: isRound ? v.length : v.width, thickness: v.thickness },
      material: `MDF${v.thickness <= 25 ? 25 : v.thickness}`, grain: 'length',
      features: [{ kind: 'engrave_label', params: { shape: v.shape, note: 'contour per shape; bounding box shown' } }],
      transform: { t: [cx, lh + v.thickness / 2, 0], r: [90, 0, 0] },
    });
    // 4 legs inset from the top's bounding corners.
    const legW = Number((leg.datasheet as { widthMm?: number } | undefined)?.widthMm ?? 60);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      const legId = addPart({
        name: `Leg ${leg.sku}${suffix}`, role: 'leg',
        size: { length: lh, width: legW, thickness: legW },
        material: `leg_${leg.sku}`,
        transform: { t: [cx + sx * (w / 2 - LEG_INSET), lh / 2, sz * (d / 2 - LEG_INSET)], r: [0, 0, 90] },
      });
      joints.push({ id: `J${parts.length}`, kind: 'screw', partA: topId, partB: legId, hardwareSku: leg.sku, count: 4, structural: true });
    }
    hardware.push({ sku: leg.sku, kind: 'table_leg', count: 4 });
    hardware.push({ kind: 'leg_mount_screw', count: 16 });
  });

  return {
    graphVersion: 1,
    source: { projectId: spec.projectId, revision: spec.revision },
    units: 'mm',
    parts,
    joints,
    hardware,
    boundingBox: { w: totalW, h: maxH, d: maxD },
    warnings: selected ? [] : [`Candidate pack: ${variants.length} variants side by side — for scale printing and selection, not production.`],
  };
}

export const tableTemplate: ProductTemplate = {
  productType: 'table',
  paramSchema,
  validate,
  build,
};

// ---------------------------------------------------------------------------
// Deterministic brief → variants. Zero-LLM path for "free sort of speaking":
// parse what we can from the text, then enumerate leg×shape×size combinations
// that satisfy every constraint, and return the best few.

export interface TableBrief {
  seats?: number;
  shapes?: TopShape[];
  maxLengthMm?: number;
  notes?: string;
}

/** Extract a structured brief from free-form text — regex-only, no model. */
export function parseTableBrief(text: string): TableBrief {
  const brief: TableBrief = {};
  const seats = /(?:for|seats?|fits?)\s+(\d{1,2})\s*(?:people|persons?|guests?|seats?)?/i.exec(text);
  if (seats) brief.seats = Number(seats[1]);
  const shapes: TopShape[] = [];
  if (/\bround\b|\bcircular\b/i.test(text)) shapes.push('round');
  if (/\boval\b/i.test(text)) shapes.push('oval');
  if (/\brounded\b/i.test(text)) shapes.push('rounded');
  if (/\brect|\bsquare\b/i.test(text)) shapes.push('rect');
  if (shapes.length) brief.shapes = shapes;
  const maxLen = /(?:max|at most|up to|no more than)\s*(\d+(?:\.\d+)?)\s*(mm|cm|m)\b/i.exec(text);
  if (maxLen) brief.maxLengthMm = Number(maxLen[1]) * (maxLen[2] === 'cm' ? 10 : maxLen[2] === 'm' ? 1000 : 1);
  return brief;
}

/** 600 mm of table edge per diner is the classic rule of thumb. */
function sizeForSeats(seats: number, shape: TopShape): { length: number; width: number } {
  if (shape === 'round') {
    const dia = Math.max(900, Math.min(ROUND_MAX, Math.round((seats * 600) / Math.PI / 50) * 50));
    return { length: dia, width: dia };
  }
  const perSide = Math.ceil(seats / 2);
  const length = Math.max(TOP_MIN + 300, Math.min(TOP_MAX_L, perSide * 600 + 200));
  const width = shape === 'oval' ? 1000 : 900;
  return { length, width };
}

/** Enumerate valid leg×shape×size candidates for a brief. */
export function generateTableVariants(
  brief: TableBrief,
  profile: ManufacturerProfile,
  room?: RoomContext,
  limit = 5,
): TableVariant[] {
  const legs = profile.stableCatalog.legs ?? [];
  const shapes = brief.shapes?.length ? brief.shapes : (['rect', 'rounded', 'round', 'oval'] as TopShape[]);
  const seats = brief.seats ?? 4;
  const out: TableVariant[] = [];
  for (const shape of shapes) {
    for (const leg of legs) {
      for (const thickness of [25, 30, 40]) {
        const h = legHeight(leg) + thickness;
        if (h < HEIGHT_MIN || h > HEIGHT_MAX) continue;
        let { length, width } = sizeForSeats(seats, shape);
        if (brief.maxLengthMm) length = Math.min(length, brief.maxLengthMm);
        if (room?.widthMm) length = Math.min(length, room.widthMm - 1200);
        if (room?.depthMm) width = Math.min(width, room.depthMm - 1200);
        if (length < TOP_MIN || width < TOP_MIN) continue;
        if (shape === 'round') width = length;
        const style = (leg.datasheet as { style?: string } | undefined)?.style ?? leg.kind;
        out.push({
          shape, length, width, thickness, legSku: leg.sku,
          label: `${shape} ${length}×${width}, ${thickness} mm top on ${style}`,
        });
        break; // one thickness per shape×leg keeps the pack varied, not repetitive
      }
    }
  }
  // Prefer variety: interleave shapes before truncating.
  const byShape = new Map<TopShape, TableVariant[]>();
  for (const v of out) byShape.set(v.shape, [...(byShape.get(v.shape) ?? []), v]);
  const interleaved: TableVariant[] = [];
  let added = true;
  while (interleaved.length < limit && added) {
    added = false;
    for (const list of byShape.values()) {
      const next = list.shift();
      if (next && interleaved.length < limit) { interleaved.push(next); added = true; }
    }
  }
  return interleaved;
}
