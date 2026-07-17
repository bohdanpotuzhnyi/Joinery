// SPDX-License-Identifier: AGPL-3.0-or-later
import { HttpException, HttpStatus } from '@nestjs/common';

export const ALLOWED_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** Validates and decodes an uploaded image; throws a 400 with a user-facing message on failure. */
export function decodeImageUpload(dataBase64?: string, mime?: string): Buffer {
  if (!dataBase64 || !mime) {
    throw new HttpException({ error: 'dataBase64 and mime are required.' }, HttpStatus.BAD_REQUEST);
  }
  if (!ALLOWED_IMAGE_MIMES.has(mime)) {
    throw new HttpException({ error: `Only ${[...ALLOWED_IMAGE_MIMES].join(', ')} are accepted.` }, HttpStatus.BAD_REQUEST);
  }
  const bytes = Buffer.from(dataBase64, 'base64');
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new HttpException({ error: `Image must be 1 byte – ${MAX_IMAGE_BYTES / 1024 / 1024} MB.` }, HttpStatus.BAD_REQUEST);
  }
  return bytes;
}
