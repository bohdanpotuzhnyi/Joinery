// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { deterministicScope, fastPathDelta, parseModelRef } from '../src';

describe('LLM gateway deterministic safety boundary', () => {
  it('extracts dimension and count edits without a provider call', () => {
    expect(fastPathDelta('Make the wardrobe width 90 cm with 3 doors and no hanging rail.')).toEqual({ width: 900, doorCount: 3, hangingRail: false });
  });
  it('understands spoken word order — number before dimension word', () => {
    expect(fastPathDelta('make it 90 cm wide please')).toEqual({ width: 900 });
    expect(fastPathDelta('I want it 2.1 m tall and 60 cm deep')).toEqual({ height: 2100, depth: 600 });
    expect(fastPathDelta('600 deep')).toEqual({ depth: 600 }); // bare mm
  });
  it('keeps non-furniture requests out of the model path', () => {
    expect(deterministicScope('Write my university essay')).toBe('out_of_scope');
    expect(deterministicScope('I need a bed with drawers')).toBe('in_scope_design');
  });
  it('never refuses natural design language (plurals, materials, colors)', () => {
    expect(deterministicScope('I want the doors to feel more elegant, maybe oak')).toBe('in_scope_design');
    expect(deterministicScope('can we do the shelves in walnut')).toBe('in_scope_design');
    expect(deterministicScope('something lighter, maybe white, for a small bedroom')).toBe('in_scope_design');
    expect(deterministicScope('make it a bit taller')).toBe('in_scope_design');
  });
  it('parses DeepSeek and other provider references', () => {
    expect(parseModelRef('deepseek:deepseek-chat')).toEqual({ provider: 'deepseek', model: 'deepseek-chat' });
  });
});
