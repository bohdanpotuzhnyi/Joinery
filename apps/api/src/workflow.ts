// SPDX-License-Identifier: AGPL-3.0-or-later
// The two-bosses order workflow (design/06 §2.3): a guarded state machine.
// Every transition is validated (state graph + actor role), recorded as an
// immutable WorkflowEvent, and the project state is the last event's `to`.
import {
  assertValid, validateWorkflowEvent,
  type WorkflowEvent, type WorkflowState,
} from '@furniture/contracts';
import type { StoredProject } from './store';

type Role = WorkflowEvent['actor']['role'];

/** state → allowed next states, and who may trigger each. */
const TRANSITIONS: Record<WorkflowState, Partial<Record<WorkflowState, Role[]>>> = {
  draft: { customer_confirmed: ['customer'] },
  customer_confirmed: { geometry_generated: ['system'] },
  geometry_generated: { manufacturer_review: ['system'] },
  manufacturer_review: {
    prototype_printed: ['manufacturer'], // approve + print scale model
    draft: ['manufacturer'],             // reject with reason
  },
  prototype_printed: { customer_verify: ['manufacturer', 'system'] }, // shipped
  customer_verify: {
    finalized: ['customer'],
    draft: ['customer'],                 // modification request → next revision
  },
  finalized: { order_submitted: ['system'] },
  order_submitted: { sanity_review: ['system'] },
  sanity_review: {
    in_production: ['ops'],              // mandatory human release
    draft: ['ops'],                      // anomaly found
  },
  in_production: { closed: ['system', 'manufacturer'] },
  closed: {},
};

export class TransitionError extends Error {}

export function applyTransition(
  project: StoredProject,
  to: WorkflowState,
  actor: WorkflowEvent['actor'],
  note?: string,
  evidenceKeys?: string[],
): WorkflowEvent {
  const allowedRoles = TRANSITIONS[project.state]?.[to];
  if (!allowedRoles) {
    const nexts = Object.keys(TRANSITIONS[project.state] ?? {});
    throw new TransitionError(
      `Cannot go from "${project.state}" to "${to}". Allowed next states: ${nexts.length ? nexts.join(', ') : 'none (terminal)'}.`,
    );
  }
  if (!allowedRoles.includes(actor.role)) {
    throw new TransitionError(
      `Role "${actor.role}" may not trigger ${project.state} → ${to} (allowed: ${allowedRoles.join(', ')}).`,
    );
  }
  const event = assertValid(validateWorkflowEvent, {
    eventVersion: 1,
    projectId: project.id,
    from: project.state,
    to,
    actor,
    at: new Date().toISOString(),
    specRevision: project.revisions.length,
    ...(note ? { note } : {}),
    ...(evidenceKeys ? { evidenceKeys } : {}),
  }, 'WorkflowEvent');

  project.events.push(event);
  project.state = to;
  return event;
}

export function allowedNext(state: WorkflowState, role: Role): WorkflowState[] {
  return (Object.entries(TRANSITIONS[state] ?? {}) as [WorkflowState, Role[]][])
    .filter(([, roles]) => roles.includes(role))
    .map(([to]) => to);
}
