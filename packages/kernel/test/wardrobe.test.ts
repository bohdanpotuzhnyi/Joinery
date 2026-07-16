// SPDX-License-Identifier: AGPL-3.0-or-later
// Golden test: the SPEC.md wardrobe (800×2100×600, 2 doors, 4 shelves) with
// the exact numbers verified in design/02-products.md §1.6. Parts are now
// per-instance (each physical panel gets its own engraved ID + placement).
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
  const byName = (name: string) => g.parts.filter((p) => p.name.startsWith(name));

  it('produces a schema-valid PartGraph', () => {
    expect(validatePartGraph(g)).toBe(true);
  });

  it('computes the verified panel dimensions (per-instance parts)', () => {
    expect(byName('Side panel')).toHaveLength(2);
    expect(byName('Side panel')[0].size).toEqual({ length: 2100, width: 600, thickness: 18 });
    expect(byName('Top panel')[0].size).toEqual({ length: 764, width: 600, thickness: 18 });
    expect(byName('Bottom panel')[0].size).toEqual({ length: 764, width: 600, thickness: 18 });
    expect(byName('Back panel')[0].size).toEqual({ length: 2100, width: 800, thickness: 12 });
    expect(byName('Door')).toHaveLength(2);
    expect(byName('Door')[0].size).toEqual({ length: 2096, width: 396.5, thickness: 18 });
    expect(byName('Shelf')).toHaveLength(4);
    expect(byName('Shelf')[0].size).toEqual({ length: 764, width: 590, thickness: 18 });
  });

  it('computes the verified hardware counts', () => {
    const count = (kind: string) => g.hardware.find((h) => h.kind === kind)?.count;
    expect(count('hinge')).toBe(10);              // 5 per 2096 mm door × 2
    expect(count('cam_dowel_pair')).toBe(8);      // 2 per joint × 4 carcass joints
    expect(count('back_panel_screw')).toBe(43);   // ceil(5800/150)+4
    expect(count('shelf_pin')).toBe(16);
    expect(count('door_handle')).toBe(2);
  });

  it('places every part in 3D (assembled transforms)', () => {
    expect(g.parts.every((p) => p.transform?.t !== undefined)).toBe(true);
    const [left, right] = byName('Side panel');
    expect(left.transform!.t![0]).toBeCloseTo(-391);  // -(800-18)/2
    expect(right.transform!.t![0]).toBeCloseTo(391);
    expect(byName('Top panel')[0].transform!.t![1]).toBeCloseTo(2100 - 9);
    expect(byName('Door')[0].transform!.t![2]).toBeCloseTo((600 + 18) / 2); // in front
  });

  it('resolves hardware to the manufacturer stable catalog SKUs', () => {
    expect(g.hardware.find((h) => h.kind === 'cam_dowel_pair')?.sku).toBe('cam_15_dowel_8');
    expect(g.hardware.find((h) => h.kind === 'hinge')?.sku).toBe('hinge_clip_110');
  });

  it('flags the mandatory wall-anchor warning for tall units', () => {
    expect(g.warnings?.[0]).toMatch(/wall-anchor/i);
  });
});

describe('sectioned wardrobe — "5 sections, 4 closed 1 open, door shelves, hanger, 3 plates"', () => {
  const sectioned: DesignSpec = {
    ...spec,
    parameters: {
      width: 2500, height: 2100, depth: 600,
      sections: [
        { closed: true, shelves: 3 },                    // "3 plates inside"
        { closed: true, hangingRail: true },             // "a hanger"
        { closed: true, doorShelves: 3 },                // "shelves inside the door"
        { closed: true, shelves: 2 },
        { closed: false, shelves: 4 },                   // the open one
      ],
    },
  };
  const result = solve(sectioned, profile);

  it('solves the example from the workshop', () => {
    expect(result.ok).toBe(true);
  });

  if (!result.ok) return;
  const g = result.graph;
  const byRole = (role: string) => g.parts.filter((p) => p.role === role);

  it('builds 4 dividers, 4 doors, rails and door shelves', () => {
    expect(byRole('divider')).toHaveLength(4);
    expect(byRole('door')).toHaveLength(4);           // 4 closed, 1 open
    expect(byRole('rail')).toHaveLength(1);
    expect(byRole('door_shelf')).toHaveLength(3);
    expect(byRole('shelf')).toHaveLength(3 + 2 + 4);  // interior shelves
    expect(validatePartGraph(g)).toBe(true);
  });

  it('sizes sections equally: interior = (2500 − 2·18 − 4·18)/5', () => {
    const wsi = (2500 - 36 - 72) / 5; // 478.4
    expect(byRole('shelf')[0].size.length).toBeCloseTo(wsi);
    expect(byRole('door')[0].size.width).toBeCloseTo((2500 - 4 - 4 * 3) / 5); // 496.8
  });

  it('rejects door shelves on an open section with an actionable message', () => {
    const bad: DesignSpec = {
      ...sectioned,
      parameters: { ...sectioned.parameters, sections: [{ closed: false, doorShelves: 2 }, { closed: true }] },
    };
    const r = solve(bad, profile);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === 'door_shelves_open')).toBe(true);
  });

  it('rejects too many sections for the width', () => {
    const bad: DesignSpec = {
      ...sectioned,
      parameters: { ...sectioned.parameters, width: 800, sections: Array.from({ length: 4 }, () => ({ closed: true })) },
    };
    const r = solve(bad, profile);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === 'section_too_narrow')).toBe(true);
  });
});

describe('room-aware validation', () => {
  it('rejects a wardrobe taller than the room', () => {
    const withRoom: DesignSpec = { ...spec, room: { heightMm: 2000 } };
    const r = solve(withRoom, profile);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].code).toBe('room_height');
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
    const kommode: DesignSpec = { ...spec, productType: 'kommode' };
    const r = solve(kommode, profile);
    // demo profile offers kommode as a class but has no template yet — either
    // outcome must be a clean error, never a crash
    expect(r.ok).toBe(false);
  });
});
