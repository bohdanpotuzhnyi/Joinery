// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { validatePartGraph, type DesignSpec, type ManufacturerProfile } from '@furniture/contracts';
import profileJson from '../../contracts/fixtures/demo-manufacturer.json';
import { solve } from '../src';

const profile = profileJson as ManufacturerProfile;
const vanityProfile: ManufacturerProfile = { ...profile, productClasses: [...profile.productClasses, 'vanity'] };
const spec = (productType: DesignSpec['productType'], parameters: DesignSpec['parameters']): DesignSpec => ({
  specVersion: 1, projectId: `prj_${productType}`, revision: 1, productType, parameters,
});

describe('bed template — two 2000×900 mattresses', () => {
  const result = solve(spec('bed', { mattressWidth: 900, mattressLength: 2000, mattressCount: 2, mattressGap: 0, frameClearance: 10, slatWidth: 70 }), profile);
  it('produces the documented support geometry', () => {
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const find = (name: string) => result.graph.parts.find((p) => p.name === name)!;
    expect(find('Side rail').size).toEqual({ length: 2056, width: 120, thickness: 18 });
    expect(find('Slat').qty).toBe(15);
    expect(find('Center beam').size.thickness).toBe(36);
    expect(validatePartGraph(result.graph)).toBe(true);
  });
  it('rejects drawers without the required leg clearance', () => {
    const r = solve(spec('bed', { mattressWidth: 900, underBedStorage: 'drawers', storageDrawerCount: 2, legHeight: 150 }), profile);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === 'storage_leg_height')).toBe(true);
  });
});

describe('vanity template — 900×450 with three drawers', () => {
  const result = solve(spec('vanity', { width: 900, depth: 450, height: 750, pedestalWidth: 300, drawerCount: 3, mirror: true, mirrorWidth: 500, mirrorHeight: 700, apronHeight: 70 }), vanityProfile);
  it('produces the documented panel dimensions', () => {
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const find = (name: string) => result.graph.parts.find((p) => p.name === name)!;
    expect(find('Worktop').size).toEqual({ length: 900, width: 450, thickness: 18 });
    expect(find('Drawer front').size).toEqual({ length: 296, width: 234, thickness: 18 });
    expect(find('Drawer box side').qty).toBe(6);
    expect(validatePartGraph(result.graph)).toBe(true);
  });
  it('enforces knee clearance', () => {
    const r = solve(spec('vanity', { width: 900, pedestalWidth: 400 }), vanityProfile);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === 'knee_width')).toBe(true);
  });
});
