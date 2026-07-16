// SPDX-License-Identifier: AGPL-3.0-or-later
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors(); // same-origin in production behind Caddy; open for dev
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`furniture api listening on :${port}`);
}

void bootstrap();
