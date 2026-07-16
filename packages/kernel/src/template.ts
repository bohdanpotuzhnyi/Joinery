// SPDX-License-Identifier: AGPL-3.0-or-later
import type { DesignSpec, ManufacturerProfile, PartGraph, ProductType } from '@furniture/contracts';

/**
 * A constraint violation with an actionable, user-facing message.
 * The solver never silently clamps values — it explains (design/02 §4).
 */
export interface ConstraintError {
  code: string;
  param?: string;
  message: string;
}

export type SolveResult =
  | { ok: true; graph: PartGraph }
  | { ok: false; errors: ConstraintError[] };

/**
 * A product template plugin. Adding a furniture type = implementing this
 * interface and registering it — no changes to the kernel or any adapter.
 * Templates are pure functions: same (spec, profile) in, same PartGraph out.
 */
export interface ProductTemplate {
  productType: ProductType;
  /** JSON Schema for this template's `DesignSpec.parameters` object. */
  paramSchema: object;
  /** Validate parameters against constraint rules and the manufacturer profile. */
  validate(spec: DesignSpec, profile: ManufacturerProfile): ConstraintError[];
  /** Compute the exact PartGraph. Only called with validated input. */
  build(spec: DesignSpec, profile: ManufacturerProfile): PartGraph;
}

const registry = new Map<ProductType, ProductTemplate>();

export function registerTemplate(t: ProductTemplate): void {
  registry.set(t.productType, t);
}

export function getTemplate(productType: ProductType): ProductTemplate | undefined {
  return registry.get(productType);
}

/** Validate + build in one call — the kernel's public entry point. */
export function solve(spec: DesignSpec, profile: ManufacturerProfile): SolveResult {
  if (!profile.productClasses.includes(spec.productType)) {
    return {
      ok: false,
      errors: [{
        code: 'not_offered',
        message: `${profile.identity.name} does not make ${spec.productType}s. They offer: ${profile.productClasses.join(', ')}.`,
      }],
    };
  }
  const template = registry.get(spec.productType);
  if (!template) {
    return { ok: false, errors: [{ code: 'unknown_product', message: `No template for product type "${spec.productType}".` }] };
  }
  const errors = template.validate(spec, profile);
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, graph: template.build(spec, profile) };
}
