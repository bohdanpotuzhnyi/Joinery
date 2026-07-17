// SPDX-License-Identifier: AGPL-3.0-or-later
// Step 1 of the table flow: free-form text (typed or transcribed voice) →
// structured brief → generated leg×top candidates → solved preview.
// Deterministic end to end; an LLM can enrich the brief later via /api/chat.
import { Body, Controller, HttpException, HttpStatus, Param, Post } from '@nestjs/common';
import type { DesignSpec, RoomContext } from '@furniture/contracts';
import { generateTableVariants, parseTableBrief, solve, type TableBrief, type TableVariant } from '@furniture/kernel';
import { buildGlb, buildObj, buildScene } from '@furniture/scene';
import { store } from './store';
import { applyTransition } from './workflow';

@Controller('api/designs/table-variants')
export class TableController {
  @Post()
  propose(@Body() body: { manufacturerId?: string; text?: string; seats?: number; room?: RoomContext }) {
    const manufacturerId = body.manufacturerId ?? 'mfr_demo';
    const profile = store.getManufacturer(manufacturerId);
    if (!profile) throw new HttpException({ error: `No manufacturer "${manufacturerId}"` }, HttpStatus.BAD_REQUEST);
    if (!profile.stableCatalog.legs?.length) {
      return { ok: false, errors: [{ code: 'no_legs', message: `${profile.identity.name} has no predefined table legs — pick another workshop for tables.` }] };
    }

    const brief: TableBrief = { ...parseTableBrief(body.text ?? ''), ...(body.seats ? { seats: body.seats } : {}) };
    const variants = generateTableVariants(brief, profile, body.room);
    if (variants.length === 0) {
      return { ok: false, errors: [{ code: 'no_fit', message: 'No leg + top combination satisfies the brief and the room. Relax a constraint.' }] };
    }

    const spec: DesignSpec = {
      specVersion: 1, projectId: 'prj_table_proposal', revision: 1, manufacturerId,
      productType: 'table', parameters: { variants } as unknown as DesignSpec['parameters'],
      ...(body.room ? { room: body.room } : {}),
      origin: 'fastpath',
    };
    const result = solve(spec, profile);
    if (!result.ok) return { ok: false, errors: result.errors, brief, variants };

    return {
      ok: true,
      brief,
      variants,
      spec,
      partGraph: result.graph,
      scene: buildScene(result.graph),
      sceneGlbBase64: Buffer.from(buildGlb(result.graph)).toString('base64'),
      objText: buildObj(result.graph),
    };
  }

  /** The moment of truth: the customer holds the printed candidates and picks
   * one. Records the selection as a new revision and finalizes the order. */
  @Post(':projectId/select')
  select(@Param('projectId') projectId: string, @Body() body: { index: number }) {
    const p = store.getProject(projectId);
    if (!p) throw new HttpException({ error: `No project "${projectId}"` }, HttpStatus.NOT_FOUND);
    if (p.state !== 'customer_verify') {
      throw new HttpException({ error: `Candidates can only be selected while verifying the printed pack (current: ${p.state}).` }, HttpStatus.CONFLICT);
    }
    const prev = p.revisions[p.revisions.length - 1].designspec;
    const variants = (prev.parameters as { variants?: TableVariant[] }).variants ?? [];
    if (!variants[body.index]) {
      throw new HttpException({ error: `Candidate ${body.index} does not exist (have ${variants.length}).` }, HttpStatus.BAD_REQUEST);
    }
    const nextSpec: DesignSpec = {
      ...prev,
      parameters: { ...prev.parameters, selectedVariant: body.index },
      revision: p.revisions.length + 1,
    };
    const profile = store.getManufacturer(p.manufacturerId)!;
    const result = solve(nextSpec, profile);
    if (!result.ok) return { ok: false, errors: result.errors };
    p.revisions.push({ revNo: nextSpec.revision, designspec: nextSpec, origin: 'form', createdAt: new Date().toISOString() });
    const label = variants[body.index].label ?? `candidate ${String.fromCharCode(65 + body.index)}`;
    applyTransition(p, 'finalized', { role: 'customer' }, `Selected printed ${label}`);
    applyTransition(p, 'order_submitted', { role: 'system' });
    applyTransition(p, 'sanity_review', { role: 'system' });
    store.updateProject(p);
    return { ok: true, projectId: p.id, state: p.state, selected: variants[body.index] };
  }
}
