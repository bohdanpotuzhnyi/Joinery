// SPDX-License-Identifier: AGPL-3.0-or-later
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { DesignController } from './design.controller';
import { AdminController } from './admin.controller';
import { ManufacturersController } from './manufacturers.controller';
import { ProjectsController } from './projects.controller';

@Module({
  controllers: [HealthController, DesignController, AdminController, ManufacturersController, ProjectsController],
})
export class AppModule {}
