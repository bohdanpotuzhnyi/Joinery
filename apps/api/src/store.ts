// SPDX-License-Identifier: AGPL-3.0-or-later
// File-backed repository — same entities as infra/migrations/0001_init.sql.
// Deliberately a module with load/save so the Postgres adapter (drizzle)
// replaces this file without touching controllers. Good enough for the
// single-process demo; NOT for concurrent writes.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';
import type { DesignSpec, ManufacturerProfile, WorkflowEvent, WorkflowState } from '@furniture/contracts';
import demoManufacturer from '../fixtures/demo-manufacturer.json';

export interface SpecRevision {
  revNo: number;
  designspec: DesignSpec;
  origin: 'llm' | 'form' | 'fastpath';
  createdAt: string;
}

export interface StoredProject {
  id: string;
  manufacturerId: string;
  title: string;
  productType: string;
  state: WorkflowState;
  revisions: SpecRevision[];
  events: WorkflowEvent[];
  createdAt: string;
}

interface Db {
  manufacturers: ManufacturerProfile[];
  projects: StoredProject[];
}

const DB_FILE = join(process.env.DATA_DIR ?? join(process.cwd(), 'data'), 'db.json');

function load(): Db {
  if (!existsSync(DB_FILE)) {
    // Seed with the demo manufacturer so the platform works out of the box.
    return { manufacturers: [demoManufacturer as ManufacturerProfile], projects: [] };
  }
  return JSON.parse(readFileSync(DB_FILE, 'utf8')) as Db;
}

function save(db: Db): void {
  mkdirSync(dirname(DB_FILE), { recursive: true });
  writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

export const store = {
  listManufacturers(): ManufacturerProfile[] {
    return load().manufacturers;
  },

  getManufacturer(id: string): ManufacturerProfile | undefined {
    return load().manufacturers.find((m) => m.manufacturerId === id);
  },

  upsertManufacturer(profile: ManufacturerProfile): void {
    const db = load();
    const i = db.manufacturers.findIndex((m) => m.manufacturerId === profile.manufacturerId);
    if (i >= 0) db.manufacturers[i] = profile;
    else db.manufacturers.push(profile);
    save(db);
  },

  listProjects(filter?: { state?: WorkflowState; manufacturerId?: string }): StoredProject[] {
    let projects = load().projects;
    if (filter?.state) projects = projects.filter((p) => p.state === filter.state);
    if (filter?.manufacturerId) projects = projects.filter((p) => p.manufacturerId === filter.manufacturerId);
    return projects;
  },

  getProject(id: string): StoredProject | undefined {
    return load().projects.find((p) => p.id === id);
  },

  createProject(manufacturerId: string, title: string, spec: DesignSpec): StoredProject {
    const db = load();
    const project: StoredProject = {
      id: `prj_${randomUUID().slice(0, 8)}`,
      manufacturerId,
      title,
      productType: spec.productType,
      state: 'draft',
      revisions: [{
        revNo: 1,
        designspec: { ...spec, revision: 1 },
        origin: spec.origin ?? 'form',
        createdAt: new Date().toISOString(),
      }],
      events: [],
      createdAt: new Date().toISOString(),
    };
    db.projects.push(project);
    save(db);
    return project;
  },

  updateProject(project: StoredProject): void {
    const db = load();
    const i = db.projects.findIndex((p) => p.id === project.id);
    if (i === -1) throw new Error(`project ${project.id} not found`);
    db.projects[i] = project;
    save(db);
  },
};
