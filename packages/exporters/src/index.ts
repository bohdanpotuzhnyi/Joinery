// SPDX-License-Identifier: AGPL-3.0-or-later
import type { PartGraph } from '@furniture/contracts';

export interface ExportFile {
  filename: string;
  mimeType: string;
  /** utf-8 text or base64 for binary formats */
  content: string;
  encoding: 'utf8' | 'base64';
}

export interface ExportResult {
  files: ExportFile[];
  warnings: string[];
}

/**
 * A fabrication exporter plugin over the canonical PartGraph
 * (design/03-fabrication.md §1). Deterministic: same graph + options in,
 * byte-identical files out — enforced by golden-file tests.
 */
export interface FabricationExporter<TOptions = Record<string, unknown>> {
  id: string;
  validate(graph: PartGraph, options: TOptions): string[];
  export(graph: PartGraph, options: TOptions): ExportResult;
}

export { cutListCsvExporter } from './cutlist-csv';
// cnc-dxf, laser-svg, print-3mf exporters register here as they land (design/03)
