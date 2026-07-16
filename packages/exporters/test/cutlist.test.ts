// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from 'vitest';
import type { DesignSpec, ManufacturerProfile } from '@furniture/contracts';
import { solve } from '@furniture/kernel';
import { cutListCsvExporter } from '../src/index';
import wardrobeSpec from '../../contracts/fixtures/wardrobe-spec.json';
import demoManufacturer from '../../contracts/fixtures/demo-manufacturer.json';

describe('cutlist-csv exporter', () => {
  const result = solve(wardrobeSpec as DesignSpec, demoManufacturer as ManufacturerProfile);
  if (!result.ok) throw new Error('golden spec must solve');

  it('validates the golden graph cleanly', () => {
    expect(cutListCsvExporter.validate(result.graph, {})).toEqual([]);
  });

  it('is deterministic (same graph → byte-identical output)', () => {
    const a = cutListCsvExporter.export(result.graph, {});
    const b = cutListCsvExporter.export(result.graph, {});
    expect(a).toEqual(b);
  });

  it('emits the verified door row', () => {
    const csv = cutListCsvExporter.export(result.graph, {}).files[0].content;
    expect(csv).toContain('P05,Door,2,2096,396.5,18,MDF18,length');
  });
});
