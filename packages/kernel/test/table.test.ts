// SPDX-License-Identifier: AGPL-3.0-or-later
// The candidate flow: free-form brief → generated leg×top variants →
// candidate pack (all variants in one printable graph) → selection → single
// production build.
import { describe, it, expect } from 'vitest';
import { validatePartGraph, type DesignSpec, type ManufacturerProfile } from '@furniture/contracts';
import { solve, parseTableBrief, generateTableVariants } from '../src/index';
import demoManufacturer from '../../contracts/fixtures/demo-manufacturer.json';

const profile = demoManufacturer as ManufacturerProfile;

function specWith(parameters: Record<string, unknown>, room?: DesignSpec['room']): DesignSpec {
  return {
    specVersion: 1, projectId: 'prj_table_test', revision: 1,
    manufacturerId: 'mfr_demo', productType: 'table',
    parameters: parameters as DesignSpec['parameters'],
    ...(room ? { room } : {}),
  };
}

describe('free-form brief parsing (zero-LLM)', () => {
  it('extracts seats, shape and size limit from natural text', () => {
    const brief = parseTableBrief('I want a round table for 6 people, at most 1.4 m across');
    expect(brief.seats).toBe(6);
    expect(brief.shapes).toEqual(['round']);
    expect(brief.maxLengthMm).toBe(1400);
  });
  it('returns an open brief for vague text', () => {
    expect(parseTableBrief('something nice for the living room')).toEqual({});
  });
});

describe('variant generation from the manufacturer leg catalog', () => {
  const variants = generateTableVariants(parseTableBrief('table for 6'), profile);

  it('generates a varied candidate set using only predefined legs', () => {
    expect(variants.length).toBeGreaterThanOrEqual(3);
    const legSkus = new Set(variants.map((v) => v.legSku));
    for (const sku of legSkus) {
      expect(profile.stableCatalog.legs!.some((l) => l.sku === sku)).toBe(true);
    }
    expect(new Set(variants.map((v) => v.shape)).size).toBeGreaterThanOrEqual(2);
  });

  it('respects the room: tops shrink to keep 600 mm chair clearance', () => {
    const small = generateTableVariants({ seats: 6 }, profile, { widthMm: 2600, depthMm: 3000 });
    for (const v of small) expect(v.length).toBeLessThanOrEqual(2600 - 1200);
  });

  it('every generated variant actually solves', () => {
    const r = solve(specWith({ variants }), profile);
    expect(r.ok).toBe(true);
  });
});

describe('candidate pack → selection → production build', () => {
  const variants = generateTableVariants({ seats: 4, shapes: ['rect', 'round'] }, profile, undefined, 4);
  const packResult = solve(specWith({ variants }), profile);

  it('lays all candidates side by side for the 3D print', () => {
    expect(packResult.ok).toBe(true);
    if (!packResult.ok) return;
    const g = packResult.graph;
    expect(validatePartGraph(g)).toBe(true);
    expect(g.parts.filter((p) => p.role === 'top')).toHaveLength(variants.length);
    expect(g.parts.filter((p) => p.role === 'leg')).toHaveLength(variants.length * 4);
    expect(g.warnings?.[0]).toMatch(/candidate pack/i);
    // candidates must not overlap: top centers strictly increasing in X
    const xs = g.parts.filter((p) => p.role === 'top').map((p) => p.transform!.t![0]);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
  });

  it('builds only the chosen variant after selection, with no candidate warning', () => {
    const r = solve(specWith({ variants, selectedVariant: 1 }), profile);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.graph.parts.filter((p) => p.role === 'top')).toHaveLength(1);
    expect(r.graph.parts.filter((p) => p.role === 'leg')).toHaveLength(4);
    expect(r.graph.warnings).toHaveLength(0);
    expect(r.graph.parts[0].name).not.toMatch(/candidate/i);
  });
});

describe('table constraint rules', () => {
  it('rejects legs not in the catalog, naming the options', () => {
    const r = solve(specWith({ variants: [{ shape: 'rect', length: 1600, width: 900, thickness: 25, legSku: 'leg_stolen' }] }), profile);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].message).toContain('leg_hairpin_690');
  });

  it('rejects un-ergonomic finished heights', () => {
    const r = solve(specWith({ variants: [{ shape: 'rect', length: 1600, width: 900, thickness: 50, legSku: 'leg_taper_720' }] }), profile);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === 'table_height')).toBe(true);
  });

  it('rejects a table that leaves no chair room', () => {
    const r = solve(
      specWith({ variants: [{ shape: 'rect', length: 2000, width: 900, thickness: 25, legSku: 'leg_square_710' }] }, { widthMm: 2800 }),
      profile,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === 'room_clearance')).toBe(true);
  });
});
