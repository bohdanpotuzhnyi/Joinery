// SPDX-License-Identifier: AGPL-3.0-or-later
import 'reflect-metadata';
import { existsSync } from 'fs';
import { join } from 'path';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.enableCors(); // same-origin in production behind Caddy; open for dev

  // The production image contains the Vite build. Keeping this in the API
  // process makes the Compose deployment a single public origin, while Vite
  // remains the development server for local UI work.
  const webDist = join(process.cwd(), 'apps', 'web', 'dist');
  if (existsSync(webDist)) {
    app.useStaticAssets(webDist, { redirect: false });
    // Register Nest routes first so this history-API fallback can never mask
    // /api or /healthz. It lets direct links such as /design load the SPA.
    await app.init();
    const express = app.getHttpAdapter().getInstance() as {
      get: (path: RegExp, handler: (_req: unknown, res: { sendFile: (file: string, options: { root: string }) => void }) => void) => void;
    };
    express.get(/^(?!\/api(?:\/|$)|\/healthz$).*/, (_req, res) => {
      res.sendFile('index.html', { root: webDist });
    });
  }
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`furniture api listening on :${port}`);
}

void bootstrap();
