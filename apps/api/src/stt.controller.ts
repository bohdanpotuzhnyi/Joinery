// SPDX-License-Identifier: AGPL-3.0-or-later
import { Body, Controller, HttpException, HttpStatus, Post } from '@nestjs/common';
@Controller('api/stt')
export class SttController {
  @Post()
  async transcribe(@Body() body: { audioBase64?: string; mimeType?: string; filename?: string }) {
    if (!body.audioBase64 || body.audioBase64.length > 14_000_000) throw new HttpException({ error: 'Provide an audio payload under 10 MB.' }, HttpStatus.BAD_REQUEST);
    try { const audio = Buffer.from(body.audioBase64, 'base64'); const form = new FormData(); form.append('file', new Blob([audio], { type: body.mimeType ?? 'audio/webm' }), body.filename ?? 'recording.webm'); const response = await fetch(`${(process.env.WHISPER_URL ?? 'http://whisper:8000').replace(/\/$/, '')}/v1/audio/transcriptions`, { method: 'POST', body: form }); if (!response.ok) throw new Error(await response.text()); const data = await response.json() as { text?: string }; return { ok: true, text: data.text ?? '' }; } catch (error) { return { ok: false, message: `Speech recognition unavailable: ${(error as Error).message}` }; }
  }
}
