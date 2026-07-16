// SPDX-License-Identifier: AGPL-3.0-or-later
// Manufacturer onboarding (design/06 §1): a validated ManufacturerProfile in,
// stored as the capability database that gates all downstream generation.
import { Body, Controller, Get, HttpException, HttpStatus, Param, Post } from '@nestjs/common';
import {
  assertValid, validateManufacturerProfile, type ManufacturerProfile,
} from '@furniture/contracts';
import { store } from './store';
import { solve } from '@furniture/kernel';

@Controller('api/manufacturers')
export class ManufacturersController {
  @Get()
  list() {
    // Public listing: identity + what they offer, not the full catalog.
    return store.listManufacturers().map((m) => ({
      manufacturerId: m.manufacturerId,
      name: m.identity.name,
      locale: m.identity.locale,
      productClasses: m.productClasses,
      leadTimeDays: m.rules?.leadTimeDays,
    }));
  }

  @Get(':id')
  get(@Param('id') id: string) {
    const m = store.getManufacturer(id);
    if (!m) throw new HttpException({ error: `No manufacturer "${id}"` }, HttpStatus.NOT_FOUND);
    return m;
  }

  @Post()
  onboard(@Body() body: unknown) {
    let profile: ManufacturerProfile;
    try {
      profile = assertValid(validateManufacturerProfile, body, 'ManufacturerProfile');
    } catch (e) {
      throw new HttpException({ error: (e as Error).message }, HttpStatus.BAD_REQUEST);
    }
    store.upsertManufacturer(profile);
    // A capability/catalog change is allowed, but never silently invalidates
    // a live design: the portal receives the affected-project list to review.
    const affected = store.listProjects({ manufacturerId: profile.manufacturerId })
      .map((project) => ({ id: project.id, result: solve(project.revisions.at(-1)!.designspec, profile) }))
      .filter((entry) => !entry.result.ok)
      .map((entry) => ({ id: entry.id, errors: entry.result.ok ? [] : entry.result.errors }));
    return { ok: true, manufacturerId: profile.manufacturerId, affectedProjects: affected };
  }
}
