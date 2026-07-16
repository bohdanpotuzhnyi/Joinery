// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from 'vitest';
import type { DesignSpec, ManufacturerProfile } from '@furniture/contracts';
import { solve } from '@furniture/kernel';
import { cutListCsvExporter, laserSvgExporter, print3mfExporter, summaryPdfExporter } from '../src/index';
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

  it('emits the verified door rows (per-instance parts)', () => {
    const csv = cutListCsvExporter.export(result.graph, {}).files[0].content;
    const doorRows = csv.split('\n').filter((row) => row.includes('Door') && row.includes('2096,396.5,18'));
    expect(doorRows).toHaveLength(2); // each physical door has its own engraved ID
  });

  it('emits a valid ZIP-backed 3MF prototype and a PDF summary', () => {
    const model = print3mfExporter.export(result.graph, { scale: 25 }).files[0];
    expect(model.filename).toMatch(/\.3mf$/);
    expect(model.content.startsWith('UEsDB')).toBe(true); // ZIP local-file magic PK\x03\x04
    const pdf = summaryPdfExporter.export(result.graph, {}).files[0].content;
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
  });

  it('emits a labelled scale-model SVG', () => {
    const svg = laserSvgExporter.export(result.graph, { scale: 25 }).files[0].content;
    expect(svg).toContain('<svg');
    expect(svg).toContain('P01');
  });
});
