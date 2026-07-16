// SPDX-License-Identifier: AGPL-3.0-or-later
// Manufacturer onboarding (design/06 §1): a validated ManufacturerProfile in,
// stored as the capability database that gates all downstream generation.
import { Body, Controller, Get, HttpException, HttpStatus, Param, Post } from '@nestjs/common';
import {
  assertValid, validateManufacturerProfile, type ManufacturerProfile,
} from '@furniture/contracts';
import { store } from './store';

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
    return { ok: true, manufacturerId: profile.manufacturerId };
  }
}
