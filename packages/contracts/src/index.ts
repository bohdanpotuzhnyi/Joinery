// SPDX-License-Identifier: AGPL-3.0-or-later
import Ajv2020, { type ValidateFunction, type ErrorObject } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';

import designSpecSchema from '../schemas/design-spec.schema.json';
import partGraphSchema from '../schemas/part-graph.schema.json';
import manufacturerProfileSchema from '../schemas/manufacturer-profile.schema.json';
import designBriefSchema from '../schemas/design-brief.schema.json';
import manualDocumentSchema from '../schemas/manual-document.schema.json';
import workflowEventSchema from '../schemas/workflow-event.schema.json';
import designSpecDeltaSchema from '../schemas/design-spec-delta.schema.json';

import type {
  DesignSpec, DesignSpecDelta, PartGraph, ManufacturerProfile, DesignBrief, ManualDocument, WorkflowEvent,
} from './types';

export * from './types';

export const schemas = {
  designSpec: designSpecSchema,
  partGraph: partGraphSchema,
  manufacturerProfile: manufacturerProfileSchema,
  designBrief: designBriefSchema,
  manualDocument: manualDocumentSchema,
  workflowEvent: workflowEventSchema,
  designSpecDelta: designSpecDeltaSchema,
} as const;

const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
addFormats(ajv);

function compile<T>(schema: object): ValidateFunction<T> {
  return ajv.compile<T>(schema);
}

export const validateDesignSpec = compile<DesignSpec>(designSpecSchema);
export const validatePartGraph = compile<PartGraph>(partGraphSchema);
export const validateManufacturerProfile = compile<ManufacturerProfile>(manufacturerProfileSchema);
export const validateDesignBrief = compile<DesignBrief>(designBriefSchema);
export const validateManualDocument = compile<ManualDocument>(manualDocumentSchema);
export const validateWorkflowEvent = compile<WorkflowEvent>(workflowEventSchema);
export const validateDesignSpecDelta = compile<DesignSpecDelta>(designSpecDeltaSchema);

export function formatErrors(errors: ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message ?? 'invalid'}`);
}

/** Parse + validate in one step; throws with readable message on failure. */
export function assertValid<T>(validate: ValidateFunction<T>, data: unknown, label: string): T {
  if (!validate(data)) {
    throw new Error(`${label} failed validation:\n${formatErrors(validate.errors).join('\n')}`);
  }
  return data;
}
