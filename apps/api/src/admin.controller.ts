// SPDX-License-Identifier: AGPL-3.0-or-later
// Admin model/agent configuration (design/05 §2.3 model router, design/07 M4).
// Stored server-side in data/model-config.json — the API key is write-only:
// GET returns a masked value, and PUT keeps the stored key when the masked
// placeholder is sent back. Demo-grade: no auth yet; ships behind /ops login
// in M6.
import { Body, Controller, Get, HttpException, HttpStatus, Post, Put } from '@nestjs/common';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

export interface ModelConfig {
  provider: 'openai-compatible' | 'anthropic';
  baseUrl: string;
  apiKey: string;
  modelSmall: string;
  modelLarge: string;
  agentInstruction: string;
}

// cwd is apps/api in dev (pnpm --filter) and /repo in the container — both
// writable, and overridable via DATA_DIR for any other layout.
const DATA_FILE = join(process.env.DATA_DIR ?? join(process.cwd(), 'data'), 'model-config.json');
const MASK = '••••••••';

const DEFAULTS: ModelConfig = {
  provider: 'openai-compatible',
  baseUrl: 'http://localhost:11434/v1',
  apiKey: '',
  modelSmall: 'qwen3:8b',
  modelLarge: 'qwen3:32b',
  agentInstruction:
    'You are the furniture design assistant. You only help design furniture this manufacturer can build. ' +
    'You never compute dimensions yourself — you emit DesignSpec parameter patches for the kernel to validate.',
};

function load(): ModelConfig {
  if (!existsSync(DATA_FILE)) return { ...DEFAULTS };
  return { ...DEFAULTS, ...(JSON.parse(readFileSync(DATA_FILE, 'utf8')) as Partial<ModelConfig>) };
}

function save(cfg: ModelConfig): void {
  mkdirSync(dirname(DATA_FILE), { recursive: true });
  writeFileSync(DATA_FILE, JSON.stringify(cfg, null, 2));
}

function masked(cfg: ModelConfig) {
  return {
    ...cfg,
    apiKey: cfg.apiKey ? `${MASK}${cfg.apiKey.slice(-4)}` : '',
  };
}

@Controller('api/admin/model-config')
export class AdminController {
  @Get()
  get() {
    return masked(load());
  }

  @Put()
  put(@Body() body: Partial<ModelConfig>) {
    const current = load();
    const next: ModelConfig = { ...current, ...body };
    // Masked value round-tripped from the UI means "keep the stored key".
    if (typeof body.apiKey === 'string' && body.apiKey.startsWith(MASK)) {
      next.apiKey = current.apiKey;
    }
    if (next.provider !== 'openai-compatible' && next.provider !== 'anthropic') {
      throw new HttpException({ error: `Unknown provider "${String(next.provider)}"` }, HttpStatus.BAD_REQUEST);
    }
    save(next);
    return masked(next);
  }

  @Post('test')
  async test() {
    const cfg = load();
    const started = Date.now();
    try {
      let url: string;
      let headers: Record<string, string>;
      if (cfg.provider === 'anthropic') {
        url = 'https://api.anthropic.com/v1/models';
        headers = { 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' };
      } else {
        url = `${cfg.baseUrl.replace(/\/$/, '')}/models`;
        headers = cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {};
      }
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
      const ms = Date.now() - started;
      if (!res.ok) {
        return { ok: false, status: res.status, message: `Provider answered ${res.status} ${res.statusText}`, ms };
      }
      const data = (await res.json()) as { data?: unknown[] };
      const count = Array.isArray(data.data) ? data.data.length : undefined;
      return { ok: true, message: `Connected${count !== undefined ? ` — ${count} models visible` : ''}`, ms };
    } catch (e) {
      return { ok: false, message: `Cannot reach provider: ${(e as Error).message}`, ms: Date.now() - started };
    }
  }
}
