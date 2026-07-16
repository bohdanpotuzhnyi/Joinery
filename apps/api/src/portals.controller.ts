// SPDX-License-Identifier: AGPL-3.0-or-later
// Role-separated portal API. Authentication can be placed in front later;
// these routes never accept a role from the browser request body.
import { Body, Controller, Get, HttpException, HttpStatus, Param, Post } from '@nestjs/common';
import type { WorkflowState } from '@furniture/contracts';
import { store } from './store';
import { allowedNext, applyTransition, TransitionError } from './workflow';

function summary(id: string) { const project = store.getProject(id); if (!project) throw new HttpException({ error: `No project "${id}"` }, HttpStatus.NOT_FOUND); const spec = project.revisions.at(-1)!.designspec; return { id: project.id, title: project.title, manufacturerId: project.manufacturerId, state: project.state, revision: project.revisions.length, parameters: spec.parameters, events: project.events }; }
function transition(id: string, to: WorkflowState, role: 'customer' | 'manufacturer' | 'ops', note?: string) { const project = store.getProject(id); if (!project) throw new HttpException({ error: `No project "${id}"` }, HttpStatus.NOT_FOUND); try { applyTransition(project, to, { role }, note); if (project.state === 'finalized') { applyTransition(project, 'order_submitted', { role: 'system' }); applyTransition(project, 'sanity_review', { role: 'system' }); } store.updateProject(project); return { ok: true, project: summary(id), allowedNext: allowedNext(project.state, role) }; } catch (error) { throw new HttpException({ error: (error as TransitionError).message }, HttpStatus.CONFLICT); } }

@Controller('api/client')
export class ClientPortalController {
  @Get('projects/:id') get(@Param('id') id: string) { return summary(id); }
  @Post('projects/:id/finalize') finalize(@Param('id') id: string, @Body() body: { note?: string }) { return transition(id, 'finalized', 'customer', body.note); }
  @Post('projects/:id/request-changes') changes(@Param('id') id: string, @Body() body: { note?: string }) { return transition(id, 'draft', 'customer', body.note); }
}
@Controller('api/manufacturer')
export class ManufacturerPortalController {
  @Get('projects') queue() { return store.listProjects().filter((project) => project.state === 'manufacturer_review' || project.state === 'prototype_printed').map((project) => summary(project.id)); }
  @Post('projects/:id/approve-prototype') approve(@Param('id') id: string, @Body() body: { note?: string }) { return transition(id, 'prototype_printed', 'manufacturer', body.note ?? 'Approved for prototype'); }
  @Post('projects/:id/ship-prototype') ship(@Param('id') id: string, @Body() body: { note?: string }) { return transition(id, 'customer_verify', 'manufacturer', body.note ?? 'Prototype shipped'); }
  @Post('projects/:id/reject') reject(@Param('id') id: string, @Body() body: { note: string }) { return transition(id, 'draft', 'manufacturer', body.note); }
}
@Controller('api/ops')
export class OpsPortalController {
  @Get('projects') queue() { return store.listProjects({ state: 'sanity_review' }).map((project) => summary(project.id)); }
  @Post('projects/:id/release') release(@Param('id') id: string, @Body() body: { note?: string }) { return transition(id, 'in_production', 'ops', body.note ?? 'Released after sanity review'); }
  @Post('projects/:id/return-to-draft') returnToDraft(@Param('id') id: string, @Body() body: { note: string }) { return transition(id, 'draft', 'ops', body.note); }
}
