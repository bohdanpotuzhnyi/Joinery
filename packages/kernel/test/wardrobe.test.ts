// SPDX-License-Identifier: AGPL-3.0-or-later
// Golden test: the SPEC.md wardrobe (800×2100×600, 2 doors, 4 shelves) with
// the exact numbers verified in design/02-products.md §1.6.
import { describe, it, expect } from 'vitest';
import { validatePartGraph, type DesignSpec, type ManufacturerProfile } from '@furniture/contracts';
import { solve } from '../src/index';
import wardrobeSpec from '../../contracts/fixtures/wardrobe-spec.json';
import demoManufacturer from '../../contracts/fixtures/demo-manufacturer.json';

const spec = wardrobeSpec as DesignSpec;
const profile = demoManufacturer as ManufacturerProfile;

describe('wardrobe template — golden example from design/02 §1.6', () => {
  const result = solve(spec, profile);

  it('solves without constraint errors', () => {
    expect(result.ok).toBe(true);
  });

  if (!result.ok) return;
  const g = result.graph;
  const byName = (name: string) => g.parts.find((p) => p.name.startsWith(name))!;

  it('produces a schema-valid PartGraph', () => {
    expect(validatePartGraph(g)).toBe(true);
  });

  it('computes the verified panel dimensions', () => {
    expect(byName('Side').size).toEqual({ length: 2100, width: 600, thickness: 18 });
    expect(byName('Top').size).toEqual({ length: 764, width: 600, thickness: 18 });
    expect(byName('Bottom').size).toEqual({ length: 764, width: 600, thickness: 18 });
    expect(byName('Back').size).toEqual({ length: 2100, width: 800, thickness: 12 });
    expect(byName('Door').size).toEqual({ length: 2096, width: 396.5, thickness: 18 });
    expect(byName('Door').qty).toBe(2);
    expect(byName('Shelf').size).toEqual({ length: 764, width: 590, thickness: 18 });
    expect(byName('Shelf').qty).toBe(4);
  });

  it('computes the verified hardware counts', () => {
    const count = (kind: string) => g.hardware.find((h) => h.kind === kind)?.count;
    expect(count('hinge')).toBe(10);              // 5 per 2096 mm door × 2
    expect(count('cam_dowel_pair')).toBe(8);      // 2 per joint × 4 carcass joints
    expect(count('back_panel_screw')).toBe(43);   // ceil(5800/150)+4
    expect(count('shelf_pin')).toBe(16);
    expect(count('door_handle')).toBe(2);
  });

  it('resolves hardware to the manufacturer stable catalog SKUs', () => {
    expect(g.hardware.find((h) => h.kind === 'cam_dowel_pair')?.sku).toBe('cam_15_dowel_8');
    expect(g.hardware.find((h) => h.kind === 'hinge')?.sku).toBe('hinge_clip_110');
  });

  it('flags the mandatory wall-anchor warning for tall units', () => {
    expect(g.warnings?.[0]).toMatch(/wall-anchor/i);
  });
});

describe('wardrobe constraint rules', () => {
  it('rejects one door on a wide wardrobe with an actionable message', () => {
    const bad: DesignSpec = { ...spec, parameters: { ...spec.parameters, width: 1200, doorCount: 1 } };
    const r = solve(bad, profile);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].message).toContain('at least 2 doors');
  });

  it('rejects a hanging rail in a shallow wardrobe', () => {
    const bad: DesignSpec = { ...spec, parameters: { ...spec.parameters, depth: 450, hangingRail: true } };
    const r = solve(bad, profile);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === 'rail_depth')).toBe(true);
  });

  it('rejects product types the manufacturer does not offer', () => {
    const vanity: DesignSpec = { ...spec, productType: 'vanity' };
    const r = solve(vanity, profile);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].code).toBe('not_offered');
  });
});
