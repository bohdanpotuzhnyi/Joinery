// SPDX-License-Identifier: AGPL-3.0-or-later
// AssemblyPlanner + ManualGenerator (design/04). Milestone M7.
// Deterministic: topological sort of the PartGraph joint DAG; the LLM may
// only polish captionFriendly fields afterwards, never step structure.
import type { PartGraph, ManualDocument } from '@furniture/contracts';

export function generateManual(graph: PartGraph, sourceHash: string): ManualDocument {
  // M7 replaces this with the real planner (structural joints first,
  // gravity-friendly ordering, two-person flags, wall-anchor step).
  // This stub emits one step per structural joint in declaration order so the
  // contract shape is exercised end-to-end from day one.
  const structural = graph.joints.filter((j) => j.structural !== false);
  return {
    manualVersion: 1,
    sourcePartGraphHash: sourceHash,
    steps: structural.map((j, i) => ({
      stepNo: i + 1,
      partsIntroduced: [j.partB],
      hardwareUsed: [{ sku: j.hardwareSku, kind: j.kind, count: j.count ?? 1 }],
      joints: [j.id],
      captionTemplate: `Attach ${j.partB} to ${j.partA} using ${j.count ?? 1}× ${j.kind}.`,
    })),
  };
}
