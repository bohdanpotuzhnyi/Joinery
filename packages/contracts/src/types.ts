// SPDX-License-Identifier: AGPL-3.0-or-later
// Hand-maintained TypeScript mirrors of the JSON Schemas in ../schemas.
// The schemas are the source of truth; keep these in sync (checked by tests
// validating fixtures against BOTH the schema and these types).

export type ProductType = 'wardrobe' | 'bed' | 'vanity' | 'kommode';

export interface DesignSpec {
  specVersion: 1;
  projectId: string;
  revision: number;
  manufacturerId?: string;
  productType: ProductType;
  parameters: Record<string, number | string | boolean>;
  finish?: { materialId?: string; colorId?: string };
  origin?: 'llm' | 'form' | 'fastpath';
  notes?: string;
}

export type Face = 'front' | 'back' | 'top' | 'bottom' | 'left' | 'right' | 'edge';

export type FeatureKind =
  | 'dowel_hole' | 'camlock_bore' | 'camlock_pin_hole' | 'confirmat_pilot'
  | 'shelf_pin_hole' | 'hinge_cup' | 'dado' | 'rabbet' | 'engrave_label';

export interface PartFeature {
  kind: FeatureKind;
  face?: Face;
  x?: number;
  y?: number;
  params?: Record<string, unknown>;
}

export interface Part {
  id: string;
  name: string;
  qty: number;
  size: { length: number; width: number; thickness: number };
  material: string;
  grain?: 'length' | 'width' | 'none';
  features?: PartFeature[];
  role?: string;
  transform?: { t?: [number, number, number]; r?: [number, number, number] };
}

export type JointKind =
  | 'cam_dowel' | 'confirmat' | 'dowel_glued' | 'shelf_pins'
  | 'hinge' | 'slide' | 'screw' | 'rail_bracket';

export interface Joint {
  id: string;
  kind: JointKind;
  partA: string;
  partB: string;
  hardwareSku?: string;
  count?: number;
  structural?: boolean;
}

export interface HardwareItem {
  sku?: string;
  kind: string;
  count: number;
}

export interface PartGraph {
  graphVersion: 1;
  source: { projectId: string; revision: number; specHash?: string };
  units: 'mm';
  parts: Part[];
  joints: Joint[];
  hardware: HardwareItem[];
  boundingBox?: { w?: number; h?: number; d?: number };
  warnings?: string[];
}

export interface SkuEntry {
  sku: string;
  kind: string;
  datasheet?: Record<string, unknown>;
}

export type Process =
  | 'cnc_wood_2d' | 'edge_banding' | 'drilling'
  | 'print_prototype_fdm' | 'lacquering' | 'veneering';

export interface Capability {
  process: Process;
  materials?: string[];
  envelopeMm?: { x?: number; y?: number; z?: number };
  minFeatureMm?: number;
  internalCornerRadiusMm?: number;
  params?: Record<string, unknown>;
}

export type ProductClass =
  | 'wardrobe' | 'bed' | 'vanity' | 'kommode' | 'kitchen' | 'shelf' | 'table';

export interface ManufacturerProfile {
  profileVersion: 1;
  manufacturerId: string;
  identity: { name: string; locale?: string; contact?: string };
  stableCatalog: {
    fasteners?: SkuEntry[];
    hinges?: SkuEntry[];
    slides?: SkuEntry[];
    legs?: SkuEntry[];
    connectors?: SkuEntry[];
    edgebands?: SkuEntry[];
    finishes?: { id: string; displayName: string; kind?: string }[];
  };
  capabilities: Capability[];
  standards?: { id: 'system32'; params?: Record<string, unknown> }[];
  productClasses: ProductClass[];
  rules?: { maxPieceWeightKg?: number; leadTimeDays?: number; orderFormat?: 'dxf+csv_v1' };
}

export interface DesignBrief {
  briefVersion: 1;
  sessionId: string;
  manufacturerId: string;
  room?: {
    kind?: 'bedroom' | 'living' | 'kitchen' | 'hallway' | 'office' | 'bathroom' | 'other';
    dimensionsMm?: { w?: number; d?: number; h?: number };
    photoKeys?: string[];
    constraints?: string[];
  };
  productClass?: ProductClass | 'unknown';
  needs?: string[];
  budgetHint?: 'low' | 'mid' | 'high' | 'unknown';
  outOfScope?: boolean;
  notes?: string;
}

export interface ManualStep {
  stepNo: number;
  partsIntroduced: string[];
  hardwareUsed: { sku?: string; kind: string; count: number }[];
  joints?: string[];
  captionTemplate: string;
  captionFriendly?: string;
  explodedOffsets?: Record<string, [number, number, number]>;
  cameraPose?: Record<string, unknown>;
  warnings?: string[];
  twoPerson?: boolean;
  estimatedMinutes?: number;
}

export interface ManualDocument {
  manualVersion: 1;
  sourcePartGraphHash: string;
  totalEstimatedMinutes?: number;
  tools?: string[];
  steps: ManualStep[];
}

export type WorkflowState =
  | 'draft' | 'customer_confirmed' | 'geometry_generated' | 'manufacturer_review'
  | 'prototype_printed' | 'customer_verify' | 'finalized' | 'order_submitted'
  | 'sanity_review' | 'in_production' | 'closed';

export interface WorkflowEvent {
  eventVersion: 1;
  projectId: string;
  from: WorkflowState;
  to: WorkflowState;
  actor: { role: 'customer' | 'manufacturer' | 'ops' | 'system'; id?: string };
  at: string;
  specRevision?: number;
  evidenceKeys?: string[];
  note?: string;
}
