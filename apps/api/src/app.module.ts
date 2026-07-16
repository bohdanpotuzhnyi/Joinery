// SPDX-License-Identifier: AGPL-3.0-or-later
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { DesignController } from './design.controller';
import { AdminController } from './admin.controller';
import { ManufacturersController } from './manufacturers.controller';
import { ProjectsController } from './projects.controller';
import { ChatController } from './chat.controller';
import { ExportsController } from './exports.controller';
import { ClientPortalController, ManufacturerPortalController, OpsPortalController } from './portals.controller';
import { ManualController } from './manual.controller';
import { SttController } from './stt.controller';
import { UploadsController } from './uploads.controller';

@Module({
  controllers: [HealthController, DesignController, AdminController, ManufacturersController, ProjectsController, ChatController, ExportsController, ClientPortalController, ManufacturerPortalController, OpsPortalController, ManualController, SttController, UploadsController],
})
export class AppModule {}
