// SPDX-License-Identifier: AGPL-3.0-or-later
import { Controller, Get } from '@nestjs/common';

@Controller()
export class HealthController {
  @Get('healthz')
  health() {
    return { ok: true, service: 'furniture-api', version: '0.1.0' };
  }

  @Get()
  index() {
    return {
      service: 'furniture-api',
      endpoints: {
        'GET /healthz': 'liveness',
        'GET /api/designs/demo': 'solve the golden wardrobe fixture (browser-friendly)',
        'POST /api/designs/solve': 'body: DesignSpec JSON → PartGraph + scene + cut list',
      },
    };
  }
}
