// SPDX-License-Identifier: AGPL-3.0-or-later
// Project lifecycle: create → confirm (auto-chains through geometry into the
// manufacturer's queue) → role-guarded transitions → revisions loop.
// Roles come from the request body — demo-grade stand-in for real auth (M6+).
import { Body, Controller, Get, HttpException, HttpStatus, Param, Post, Query } from '@nestjs/common';
import {
  assertValid, validateDesignSpec,
  type DesignSpec, type WorkflowEvent, type WorkflowState,
} from '@furniture/contracts';
import { solve } from '@furniture/kernel';
import { buildScene } from '@furniture/scene';
import { cutListCsvExporter } from '@furniture/exporters';
import { store, type StoredProject } from './store';
import { allowedNext, applyTransition, TransitionError } from './workflow';

type Role = WorkflowEvent['actor']['role'];

function summary(p: StoredProject) {
  const spec = p.revisions[p.revisions.length - 1].designspec;
  return {
    id: p.id,
    title: p.title,
    productType: p.productType,
    manufacturerId: p.manufacturerId,
    state: p.state,
    revision: p.revisions.length,
    parameters: spec.parameters,
    createdAt: p.createdAt,
    lastEvent: p.events[p.events.length - 1] ?? null,
  };
}

function solveProject(p: StoredProject) {
  const profile = store.getManufacturer(p.manufacturerId);
  if (!profile) throw new HttpException({ error: `Manufacturer ${p.manufacturerId} vanished` }, HttpStatus.CONFLICT);
  const spec = p.revisions[p.revisions.length - 1].designspec;
  return { profile, spec, result: solve(spec, profile) };
}

@Controller('api/projects')
export class ProjectsController {
  @Get()
  list(@Query('state') state?: WorkflowState, @Query('manufacturerId') manufacturerId?: string) {
    return store.listProjects({ state, manufacturerId }).map(summary);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    const p = store.getProject(id);
    if (!p) throw new HttpException({ error: `No project "${id}"` }, HttpStatus.NOT_FOUND);
    const { result } = solveProject(p);
    return {
      ...summary(p),
      events: p.events,
      revisions: p.revisions.map((r) => ({ revNo: r.revNo, origin: r.origin, createdAt: r.createdAt, parameters: r.designspec.parameters })),
      ...(result.ok
        ? {
            partGraph: result.graph,
            scene: buildScene(result.graph),
            cutListCsv: cutListCsvExporter.export(result.graph, {}).files[0].content,
          }
        : { solveErrors: result.errors }),
    };
  }

  @Post()
  create(@Body() body: { title?: string; spec: unknown }) {
    let spec: DesignSpec;
    try {
      spec = assertValid(validateDesignSpec, body.spec, 'DesignSpec');
    } catch (e) {
      throw new HttpException({ error: (e as Error).message }, HttpStatus.BAD_REQUEST);
    }
    const manufacturerId = spec.manufacturerId ?? 'mfr_demo';
    const profile = store.getManufacturer(manufacturerId);
    if (!profile) throw new HttpException({ error: `No manufacturer "${manufacturerId}"` }, HttpStatus.BAD_REQUEST);

    const result = solve({ ...spec, manufacturerId }, profile);
    if (!result.ok) return { ok: false, errors: result.errors };

    const title = body.title ?? `${spec.productType} ${String(spec.parameters.width)}×${String(spec.parameters.height)}`;
    const project = store.createProject(manufacturerId, title, { ...spec, manufacturerId });
    return { ok: true, project: summary(project) };
  }

  /** Customer confirms → system auto-chains geometry → manufacturer queue. */
  @Post(':id/confirm')
  confirm(@Param('id') id: string) {
    const p = store.getProject(id);
    if (!p) throw new HttpException({ error: `No project "${id}"` }, HttpStatus.NOT_FOUND);
    const { result } = solveProject(p);
    if (!result.ok) {
      return { ok: false, errors: result.errors };
    }
    try {
      // Evidence: hash-worthy snapshot of what the customer saw (design/06 §2.3).
      applyTransition(p, 'customer_confirmed', { role: 'customer' }, undefined,
        [`confirmation:rev${p.revisions.length}`]);
      applyTransition(p, 'geometry_generated', { role: 'system' },
        `${result.graph.parts.length} parts, ${result.graph.hardware.reduce((n, h) => n + h.count, 0)} hardware items`);
      applyTransition(p, 'manufacturer_review', { role: 'system' });
    } catch (e) {
      throw new HttpException({ error: (e as Error).message }, HttpStatus.CONFLICT);
    }
    store.updateProject(p);
    return { ok: true, project: summary(p) };
  }

  /** Role-guarded manual transition (manufacturer approve/reject, ops release…). */
  @Post(':id/transition')
  transition(@Param('id') id: string, @Body() body: { to: WorkflowState; role: Role; note?: string }) {
    const p = store.getProject(id);
    if (!p) throw new HttpException({ error: `No project "${id}"` }, HttpStatus.NOT_FOUND);
    try {
      applyTransition(p, body.to, { role: body.role }, body.note);
      // System auto-chains that follow human decisions:
      if (p.state === 'finalized') {
        applyTransition(p, 'order_submitted', { role: 'system' });
        applyTransition(p, 'sanity_review', { role: 'system' });
      }
    } catch (e) {
      if (e instanceof TransitionError) {
        throw new HttpException({ error: e.message }, HttpStatus.CONFLICT);
      }
      throw e;
    }
    store.updateProject(p);
    return { ok: true, project: summary(p), allowedNext: { customer: allowedNext(p.state, 'customer'), manufacturer: allowedNext(p.state, 'manufacturer'), ops: allowedNext(p.state, 'ops') } };
  }

  /** New revision (customer modification loop) — must be in draft first. */
  @Post(':id/revise')
  revise(@Param('id') id: string, @Body() body: { parameters: Record<string, number | string | boolean> }) {
    const p = store.getProject(id);
    if (!p) throw new HttpException({ error: `No project "${id}"` }, HttpStatus.NOT_FOUND);
    if (p.state !== 'draft') {
      throw new HttpException({ error: `Revisions are only allowed in draft (current: ${p.state}). Request changes first.` }, HttpStatus.CONFLICT);
    }
    const prev = p.revisions[p.revisions.length - 1].designspec;
    const nextSpec: DesignSpec = { ...prev, parameters: { ...prev.parameters, ...body.parameters }, revision: p.revisions.length + 1 };
    const profile = store.getManufacturer(p.manufacturerId)!;
    const result = solve(nextSpec, profile);
    if (!result.ok) return { ok: false, errors: result.errors };
    p.revisions.push({ revNo: nextSpec.revision, designspec: nextSpec, origin: 'form', createdAt: new Date().toISOString() });
    store.updateProject(p);
    return { ok: true, project: summary(p) };
  }
}
