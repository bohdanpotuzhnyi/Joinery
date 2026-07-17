// SPDX-License-Identifier: AGPL-3.0-or-later
// Shared plumbing between the chat edge and the image-import edge: both turn
// some user input into a DesignSpecDelta via the same audited model call and
// merge it into a DesignSpec the same way.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import type { DesignSpec, DesignSpecDelta } from '@furniture/contracts';
import { AnthropicModelPort, OpenAICompatibleModelPort, type AuditEntry, type ModelPort } from '@furniture/llm-gateway';
import { effectiveModelConfig } from './model-config';

const auditFile = join(process.env.DATA_DIR ?? join(process.cwd(), 'data'), 'llm-audit.ndjson');

export function audit(entry: AuditEntry): void {
  mkdirSync(dirname(auditFile), { recursive: true });
  appendFileSync(auditFile, `${JSON.stringify(entry)}\n`);
}

export function usedToday(sessionId?: string): number {
  if (!existsSync(auditFile)) return 0;
  const day = new Date().toISOString().slice(0, 10);
  return readFileSync(auditFile, 'utf8').trim().split('\n').filter(Boolean)
    .map((line) => JSON.parse(line) as AuditEntry)
    .filter((entry) => (!sessionId || entry.sessionId === sessionId) && entry.at.startsWith(day) && entry.outcome === 'ok')
    .reduce((sum, entry) => sum + entry.inputTokens + entry.outputTokens, 0);
}

export function merge(spec: DesignSpec, delta: DesignSpecDelta): DesignSpec {
  const parametersPatch = Object.fromEntries(Object.entries(delta.parametersPatch).filter((entry): entry is [string, string | number | boolean] => entry[1] !== null));
  const finishPatch = Object.fromEntries(Object.entries(delta.finishPatch ?? {}).filter((entry): entry is [string, string] => entry[1] !== null));
  return { ...spec, productType: delta.productType ?? spec.productType, parameters: { ...spec.parameters, ...parametersPatch }, finish: { ...spec.finish, ...finishPatch }, origin: 'llm', revision: spec.revision + 1 };
}

// The Setup page (/admin) is the source of truth; env vars only fill blanks.
export function port(): { port: ModelPort; instruction: string; largeModel: string } {
  const cfg = effectiveModelConfig();
  const models = { small: cfg.modelSmall, large: cfg.modelLarge };
  const modelPort = cfg.provider === 'anthropic'
    ? new AnthropicModelPort(cfg.apiKey, models)
    : new OpenAICompatibleModelPort(cfg.baseUrl, cfg.apiKey, models);
  return { port: modelPort, instruction: cfg.agentInstruction, largeModel: cfg.modelLarge };
}
