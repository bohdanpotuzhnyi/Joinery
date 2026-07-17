// SPDX-License-Identifier: AGPL-3.0-or-later
import 'reflect-metadata';
import { existsSync } from 'fs';
import { join } from 'path';
import { json, urlencoded } from 'express';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

// Default Express body limit is 100kb — too small for a base64-encoded photo
// upload (image-import, room photos). Bump it to comfortably cover
// MAX_IMAGE_BYTES (8MB) plus base64/JSON overhead.
const BODY_LIMIT = '12mb';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  app.use(json({ limit: BODY_LIMIT }));
  app.use(urlencoded({ extended: true, limit: BODY_LIMIT }));
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
