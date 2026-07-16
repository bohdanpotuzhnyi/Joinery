// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from 'vitest';
import type { StoredProject } from '../src/store';
import { applyTransition, allowedNext, TransitionError } from '../src/workflow';

function project(state: StoredProject['state'] = 'draft'): StoredProject {
  return {
    id: 'prj_test', manufacturerId: 'mfr_demo', title: 't', productType: 'wardrobe',
    state, revisions: [{ revNo: 1, designspec: {} as never, origin: 'form', createdAt: '' }],
    events: [], createdAt: '',
  };
}

describe('order workflow state machine', () => {
  it('walks the full happy path with the right actors', () => {
    const p = project();
    applyTransition(p, 'customer_confirmed', { role: 'customer' });
    applyTransition(p, 'geometry_generated', { role: 'system' });
    applyTransition(p, 'manufacturer_review', { role: 'system' });
    applyTransition(p, 'prototype_printed', { role: 'manufacturer' });
    applyTransition(p, 'customer_verify', { role: 'manufacturer' });
    applyTransition(p, 'finalized', { role: 'customer' });
    applyTransition(p, 'order_submitted', { role: 'system' });
    applyTransition(p, 'sanity_review', { role: 'system' });
    applyTransition(p, 'in_production', { role: 'ops' });
    expect(p.state).toBe('in_production');
    expect(p.events).toHaveLength(9);
    expect(p.events.every((e) => e.projectId === 'prj_test')).toBe(true);
  });

  it('rejects skipping states', () => {
    expect(() => applyTransition(project(), 'in_production', { role: 'ops' }))
      .toThrow(TransitionError);
  });

  it('rejects the wrong actor — only ops may release to production', () => {
    const p = project('sanity_review');
    expect(() => applyTransition(p, 'in_production', { role: 'manufacturer' }))
      .toThrow(/may not trigger/);
    expect(() => applyTransition(p, 'in_production', { role: 'system' }))
      .toThrow(/may not trigger/); // the human gate cannot be automated away
  });

  it('lets the customer loop back to draft from verification', () => {
    const p = project('customer_verify');
    applyTransition(p, 'draft', { role: 'customer' }, 'doors feel too narrow on the miniature');
    expect(p.state).toBe('draft');
    expect(p.events[0].note).toContain('miniature');
  });

  it('reports allowed next states per role', () => {
    expect(allowedNext('manufacturer_review', 'manufacturer')).toEqual(['prototype_printed', 'draft']);
    expect(allowedNext('manufacturer_review', 'customer')).toEqual([]);
    expect(allowedNext('closed', 'ops')).toEqual([]);
  });
});
