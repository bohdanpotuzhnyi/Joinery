// SPDX-License-Identifier: AGPL-3.0-or-later
// Room photo uploads. Stored on disk keyed by content hash; the DesignSpec
// references the key (spec.room.photoKey). Analysis of the photo (what's in
// the room, dimension estimation) is a vision-model hook on top of this store.
import { Body, Controller, Get, HttpException, HttpStatus, Param, Post, Res } from '@nestjs/common';
import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const uploadsDir = join(process.env.DATA_DIR ?? join(process.cwd(), 'data'), 'uploads');
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 8 * 1024 * 1024;

@Controller('api/uploads')
export class UploadsController {
  @Post()
  upload(@Body() body: { dataBase64?: string; mime?: string }) {
    if (!body.dataBase64 || !body.mime) {
      throw new HttpException({ error: 'dataBase64 and mime are required.' }, HttpStatus.BAD_REQUEST);
    }
    if (!ALLOWED.has(body.mime)) {
      throw new HttpException({ error: `Only ${[...ALLOWED].join(', ')} are accepted.` }, HttpStatus.BAD_REQUEST);
    }
    const bytes = Buffer.from(body.dataBase64, 'base64');
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) {
      throw new HttpException({ error: `Image must be 1 byte – ${MAX_BYTES / 1024 / 1024} MB.` }, HttpStatus.BAD_REQUEST);
    }
    const ext = body.mime.split('/')[1];
    const key = `${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}.${ext}`;
    mkdirSync(uploadsDir, { recursive: true });
    writeFileSync(join(uploadsDir, key), bytes);
    return { ok: true, key };
  }

  @Get(':key')
  serve(@Param('key') key: string, @Res() res: { setHeader: (name: string, value: string) => void; send: (data: Buffer) => void }) {
    if (!/^[a-f0-9]{16}\.(jpeg|png|webp)$/.test(key)) {
      throw new HttpException({ error: 'Bad key.' }, HttpStatus.BAD_REQUEST);
    }
    const file = join(uploadsDir, key);
    if (!existsSync(file)) throw new HttpException({ error: 'Not found.' }, HttpStatus.NOT_FOUND);
    res.setHeader('Content-Type', `image/${key.split('.')[1]}`);
    res.send(readFileSync(file));
  }
}
