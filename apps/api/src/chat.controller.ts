// SPDX-License-Identifier: AGPL-3.0-or-later
import { Body, Controller, HttpException, HttpStatus, Post } from '@nestjs/common';
import { assertValid, schemas, validateDesignSpec, validateDesignSpecDelta, type DesignSpecDelta } from '@furniture/contracts';
import { deterministicScope, fastPathDelta } from '@furniture/llm-gateway';
import { solve } from '@furniture/kernel';
import { store } from './store';
import { audit, merge, port, usedToday } from './llm-pipeline';

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
