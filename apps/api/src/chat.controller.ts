// SPDX-License-Identifier: AGPL-3.0-or-later
import { Body, Controller, HttpException, HttpStatus, Post } from '@nestjs/common';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { assertValid, schemas, validateDesignSpec, validateDesignSpecDelta, type DesignSpec, type DesignSpecDelta } from '@furniture/contracts';
import { AnthropicModelPort, deterministicScope, fastPathDelta, OpenAICompatibleModelPort, type AuditEntry, type ModelPort } from '@furniture/llm-gateway';
import { solve } from '@furniture/kernel';
import { store } from './store';
import { effectiveModelConfig } from './model-config';

const auditFile = join(process.env.DATA_DIR ?? join(process.cwd(), 'data'), 'llm-audit.ndjson');
function audit(entry: AuditEntry) { mkdirSync(dirname(auditFile), { recursive: true }); appendFileSync(auditFile, `${JSON.stringify(entry)}\n`); }
function usedToday(sessionId?: string) { if (!existsSync(auditFile)) return 0; const day = new Date().toISOString().slice(0, 10); return readFileSync(auditFile, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as AuditEntry).filter((entry) => (!sessionId || entry.sessionId === sessionId) && entry.at.startsWith(day) && entry.outcome === 'ok').reduce((sum, entry) => sum + entry.inputTokens + entry.outputTokens, 0); }
function merge(spec: DesignSpec, delta: DesignSpecDelta): DesignSpec { const parametersPatch = Object.fromEntries(Object.entries(delta.parametersPatch).filter((entry): entry is [string, string | number | boolean] => entry[1] !== null)); const finishPatch = Object.fromEntries(Object.entries(delta.finishPatch ?? {}).filter((entry): entry is [string, string] => entry[1] !== null)); return { ...spec, productType: delta.productType ?? spec.productType, parameters: { ...spec.parameters, ...parametersPatch }, finish: { ...spec.finish, ...finishPatch }, origin: 'llm', revision: spec.revision + 1 }; }
// The Setup page (/admin) is the source of truth; env vars only fill blanks.
function port(): { port: ModelPort; instruction: string; largeModel: string } {
  const cfg = effectiveModelConfig();
  const models = { small: cfg.modelSmall, large: cfg.modelLarge };
  const modelPort = cfg.provider === 'anthropic'
    ? new AnthropicModelPort(cfg.apiKey, models)
    : new OpenAICompatibleModelPort(cfg.baseUrl, cfg.apiKey, models);
  return { port: modelPort, instruction: cfg.agentInstruction, largeModel: cfg.modelLarge };
}

@Controller('api/chat')
export class ChatController {
  @Post()
  async chat(@Body() body: { sessionId?: string; message?: string; spec: unknown; manufacturerId?: string }) {
    const sessionId = body.sessionId ?? 'anonymous'; const message = body.message?.trim() ?? '';
    if (!message || message.length > 2000) throw new HttpException({ error: 'Message must be 1–2000 characters.' }, HttpStatus.BAD_REQUEST);
    const spec = assertValid(validateDesignSpec, body.spec, 'DesignSpec'); const manufacturer = store.getManufacturer(body.manufacturerId ?? spec.manufacturerId ?? 'mfr_demo');
    if (!manufacturer) throw new HttpException({ error: 'Unknown manufacturer.' }, HttpStatus.BAD_REQUEST);
    const limit = Number(process.env.SESSION_TOKEN_BUDGET ?? 200000); const dailyLimit = Number(process.env.DAILY_TOKEN_BUDGET ?? 2000000); if (usedToday(sessionId) >= limit || usedToday() >= dailyLimit) return { ok: false, mode: 'forms', message: 'Chat budget reached; form editing remains available.' };
    const started = Date.now(); const quick = fastPathDelta(message);
    let delta: DesignSpecDelta; let mode: 'fastpath' | 'llm' = 'fastpath';
    if (quick) { delta = { parametersPatch: quick }; audit({ at: new Date().toISOString(), sessionId, stage: 'fastpath', model: 'none', inputTokens: 0, outputTokens: 0, latencyMs: Date.now() - started, outcome: 'ok' }); }
    else {
      const scope = deterministicScope(message); audit({ at: new Date().toISOString(), sessionId, stage: 'scope_gate', model: 'deterministic', inputTokens: 0, outputTokens: 0, latencyMs: 0, outcome: scope === 'out_of_scope' ? 'refused' : 'ok' });
      if (scope === 'out_of_scope') return { ok: false, mode: 'refused', message: 'I can only help design furniture this manufacturer can build.' };
      mode = 'llm';
      const gateway = port();
      try { const response = await gateway.port.completeStructured({ system: `${gateway.instruction}\nReturn only a DesignSpecDelta. Manufacturer ${manufacturer.identity.name} offers: ${manufacturer.productClasses.join(', ')}. Never calculate geometry.`, messages: [{ role: 'user', content: message }], schema: schemas.designSpecDelta, tier: 'large', maxTokens: 900 }); delta = assertValid(validateDesignSpecDelta, response.json, 'DesignSpecDelta'); audit({ at: new Date().toISOString(), sessionId, stage: 'extract', model: gateway.largeModel, inputTokens: response.usage.inputTokens, outputTokens: response.usage.outputTokens, latencyMs: Date.now() - started, outcome: 'ok' }); }
      catch (error) { audit({ at: new Date().toISOString(), sessionId, stage: 'extract', model: gateway.largeModel, inputTokens: 0, outputTokens: 0, latencyMs: Date.now() - started, outcome: 'error' }); return { ok: false, mode: 'forms', message: `Chat extraction failed safely: ${(error as Error).message}` }; }
    }
    const next = merge(spec, delta); const result = solve(next, manufacturer); return { ok: result.ok, mode, delta, spec: next, ...(result.ok ? { partGraph: result.graph } : { errors: result.errors }) };
  }
}
