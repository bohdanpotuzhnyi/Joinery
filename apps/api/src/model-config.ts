// SPDX-License-Identifier: AGPL-3.0-or-later
// Single source of truth for the AI model configuration. The admin Setup page
// writes it (admin.controller), the chat pipeline reads it (chat.controller).
// Environment variables are the fallback for fields the admin left empty, so
// a headless deploy can still be configured via .env alone.
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

export const MASK = '••••••••';

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

export function loadModelConfig(): ModelConfig {
  if (!existsSync(DATA_FILE)) return { ...DEFAULTS };
  return { ...DEFAULTS, ...(JSON.parse(readFileSync(DATA_FILE, 'utf8')) as Partial<ModelConfig>) };
}

export function saveModelConfig(cfg: ModelConfig): void {
  mkdirSync(dirname(DATA_FILE), { recursive: true });
  writeFileSync(DATA_FILE, JSON.stringify(cfg, null, 2));
}

/**
 * Effective config for the chat pipeline: Setup-page values win; env vars fill
 * anything the admin left empty. Model refs are plain model names here (the
 * provider is a separate field), while env refs may be "provider:model" —
 * strip the prefix when falling back.
 */
export function effectiveModelConfig(env: NodeJS.ProcessEnv = process.env): ModelConfig {
  const cfg = loadModelConfig();
  const stripRef = (ref?: string) => (ref?.includes(':') ? ref.slice(ref.indexOf(':') + 1) : ref);
  return {
    ...cfg,
    baseUrl: cfg.baseUrl || env.OPENAI_COMPAT_BASE_URL || 'http://localhost:11434/v1',
    apiKey: cfg.apiKey || (cfg.provider === 'anthropic' ? env.ANTHROPIC_API_KEY : env.OPENAI_COMPAT_API_KEY) || '',
    modelSmall: cfg.modelSmall || stripRef(env.MODEL_SMALL) || 'qwen3:8b',
    modelLarge: cfg.modelLarge || stripRef(env.MODEL_LARGE) || stripRef(env.MODEL_SMALL) || 'qwen3:8b',
  };
}
