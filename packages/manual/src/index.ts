// SPDX-License-Identifier: AGPL-3.0-or-later
// AssemblyPlanner + ManualGenerator (design/04).
import type { PartGraph, ManualDocument } from '@furniture/contracts';

export function generateManual(graph: PartGraph, sourceHash: string): ManualDocument {
  const byId = new Map(graph.parts.map((part) => [part.id, part]));
  const placed = new Set<string>(); const remaining = new Set(graph.parts.map((part) => part.id));
  const steps: ManualDocument['steps'] = [];
  while (remaining.size) {
    const ready = [...remaining].filter((id) => graph.joints.filter((j) => j.partB === id).every((j) => placed.has(j.partA) || !remaining.has(j.partA)));
    const id = (ready.length ? ready : [...remaining]).sort((a, b) => priority(byId.get(a)!) - priority(byId.get(b)!) || a.localeCompare(b))[0];
    const part = byId.get(id)!; const joints = graph.joints.filter((j) => j.partB === id && placed.has(j.partA));
    const hardwareUsed = joints.map((j) => ({ sku: j.hardwareSku, kind: j.kind, count: j.count ?? 1 }));
    const longest = Math.max(part.size.length, part.size.width, part.size.thickness);
    const warnings: string[] = []; if (longest > 1800) warnings.push('Two people are required for this long panel.');
    steps.push({ stepNo: steps.length + 1, partsIntroduced: [id], hardwareUsed, joints: joints.map((j) => j.id), captionTemplate: joints.length ? `Attach ${part.name} (${id}) to the prepared structure.` : `Prepare ${part.name} (${id}) as the base part.`, explodedOffsets: { [id]: [0, 0, 150] }, warnings, twoPerson: longest > 1800, estimatedMinutes: Number((0.5 + hardwareUsed.reduce((sum, h) => sum + h.count * 0.4, 0) + (longest > 1800 ? 1 : 0)).toFixed(1)) });
    placed.add(id); remaining.delete(id);
  }
  if ((graph.warnings ?? []).some((warning) => /wall-anchor/i.test(warning))) steps.push({ stepNo: steps.length + 1, partsIntroduced: [], hardwareUsed: [{ kind: 'wall_anchor', count: 2 }], captionTemplate: 'Anchor the tall unit to a suitable wall before use. Do not skip this safety step.', warnings: ['MANDATORY: wall-anchor the unit before loading it.'], estimatedMinutes: 5 });
  return {
    manualVersion: 1,
    sourcePartGraphHash: sourceHash,
    totalEstimatedMinutes: steps.reduce((sum, step) => sum + (step.estimatedMinutes ?? 0), 0),
    tools: ['hex_key', 'screwdriver', 'rubber_mallet'], steps,
  };
}

export function verifyManual(manual: ManualDocument, graph: PartGraph): string[] {
  const errors: string[] = []; const known = new Set(graph.parts.map((part) => part.id)); const introduced = new Set<string>();
  for (const step of manual.steps) for (const id of step.partsIntroduced) { if (!known.has(id)) errors.push(`unknown part ${id}`); if (introduced.has(id)) errors.push(`part ${id} introduced twice`); introduced.add(id); }
  for (const id of known) if (!introduced.has(id)) errors.push(`part ${id} is missing from the manual`);
  return errors;
}

function priority(part: PartGraph['parts'][number]): number { const role = part.role ?? ''; if (/side|top|bottom|back|rail|leg|beam/.test(role)) return 0; if (/shelf/.test(role)) return 1; if (/door|drawer|mirror/.test(role)) return 2; return 3; }
