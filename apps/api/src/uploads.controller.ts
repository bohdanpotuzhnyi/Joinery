// SPDX-License-Identifier: AGPL-3.0-or-later
// Room photo uploads. Stored on disk keyed by content hash; the DesignSpec
// references the key (spec.room.photoKey). Analysis of the photo (what's in
// the room, dimension estimation) is a vision-model hook on top of this store.
import { Body, Controller, Get, HttpException, HttpStatus, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { decodeImageUpload } from './image-validation';

const uploadsDir = join(process.env.DATA_DIR ?? join(process.cwd(), 'data'), 'uploads');

@Controller('api/uploads')
export class UploadsController {
  @Post()
  upload(@Body() body: { dataBase64?: string; mime?: string }) {
    const bytes = decodeImageUpload(body.dataBase64, body.mime);
    const ext = body.mime!.split('/')[1];
    const key = `${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}.${ext}`;
    mkdirSync(uploadsDir, { recursive: true });
    writeFileSync(join(uploadsDir, key), bytes);
    return { ok: true, key };
  }

  @Get(':key')
  serve(@Param('key') key: string, @Res() res: Response) {
    if (!/^[a-f0-9]{16}\.(jpeg|png|webp)$/.test(key)) {
      throw new HttpException({ error: 'Bad key.' }, HttpStatus.BAD_REQUEST);
    }
    const file = join(uploadsDir, key);
    if (!existsSync(file)) throw new HttpException({ error: 'Not found.' }, HttpStatus.NOT_FOUND);
    res.setHeader('Content-Type', `image/${key.split('.')[1]}`);
    res.send(readFileSync(file));
  }
}
