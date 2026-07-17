// SPDX-License-Identifier: AGPL-3.0-or-later
// Provider-agnostic model layer (design/05 §2, design/07 §1).
// The gateway never trusts provider schema adherence: callers re-validate
// every response against the contracts package's AJV validators.

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: string; dataBase64: string };

export interface Msg {
  role: 'user' | 'assistant';
  /** Plain text, or a content-part array for multimodal (vision) messages. */
  content: string | ContentPart[];
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface StructuredRequest {
  system: string;
  messages: Msg[];
  /** JSON Schema the reply must satisfy; adapters use the provider's best mechanism. */
  schema: object;
  tier: 'small' | 'large';
  maxTokens: number;
}

export interface StructuredResponse {
  json: unknown;
  usage: TokenUsage;
}

export class ModelGatewayError extends Error {}

/**
 * The single interface every model provider implements. "Model selection can
 * be any": openai-compatible covers Ollama/vLLM/llama.cpp/LocalAI/OpenRouter/
 * OpenAI/Mistral; anthropic covers Claude; add adapters by implementing this.
 */
export interface ModelPort {
  completeStructured(req: StructuredRequest): Promise<StructuredResponse>;
}

export interface ModelRouteConfig {
  /** e.g. "ollama:qwen3:8b" or "anthropic:claude-sonnet-5" */
  small: string;
  large: string;
  openaiCompatBaseUrl?: string;
  openaiCompatApiKey?: string;
  anthropicApiKey?: string;
}

export function parseModelRef(ref: string): { provider: string; model: string } {
  const idx = ref.indexOf(':');
  if (idx === -1) throw new Error(`Invalid model ref "${ref}" — expected "provider:model"`);
  return { provider: ref.slice(0, idx), model: ref.slice(idx + 1) };
}

export function routeConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ModelRouteConfig {
  return {
    small: env.MODEL_SMALL ?? 'ollama:qwen3:8b',
    large: env.MODEL_LARGE ?? env.MODEL_SMALL ?? 'ollama:qwen3:8b',
    openaiCompatBaseUrl: env.OPENAI_COMPAT_BASE_URL,
    openaiCompatApiKey: env.OPENAI_COMPAT_API_KEY,
    anthropicApiKey: env.ANTHROPIC_API_KEY,
  };
}

function toOpenAIContent(content: Msg['content']) {
  if (typeof content === 'string') return content;
  return content.map((part) => part.type === 'text'
    ? { type: 'text', text: part.text }
    : { type: 'image_url', image_url: { url: `data:${part.mediaType};base64,${part.dataBase64}` } });
}

export class OpenAICompatibleModelPort implements ModelPort {
  constructor(private readonly baseUrl: string, private readonly apiKey = '', private readonly models: Record<'small' | 'large', string> = { small: 'gpt-4o-mini', large: 'gpt-4o-mini' }) {}
  async completeStructured(req: StructuredRequest): Promise<StructuredResponse> {
    const messages = req.messages.map((m) => ({ role: m.role, content: toOpenAIContent(m.content) }));
    const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}) }, body: JSON.stringify({
      model: this.models[req.tier],
      messages: [{ role: 'system', content: req.system }, ...messages],
      max_tokens: req.maxTokens,
      response_format: { type: 'json_schema', json_schema: { name: 'structured_response', strict: true, schema: req.schema } },
      // "Thinking" models served via vLLM (Qwen3 and similar) burn the whole
      // token budget on a hidden reasoning trace unless told not to, leaving
      // no room for the actual answer. Ignored as an unrecognized field by
      // providers that don't support it.
      chat_template_kwargs: { enable_thinking: false },
    }) });
    if (!res.ok) throw new ModelGatewayError(`OpenAI-compatible provider returned ${res.status}: ${await res.text()}`);
    const body = await res.json() as { choices?: { message?: { content?: string; reasoning?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    const content = body.choices?.[0]?.message?.content;
    if (!content) {
      const spentOnReasoning = Boolean(body.choices?.[0]?.message?.reasoning);
      throw new ModelGatewayError(spentOnReasoning
        ? 'Provider spent its whole token budget on internal reasoning and never produced a final answer — try raising maxTokens.'
        : 'Provider returned no structured message content.');
    }
    return { json: JSON.parse(content), usage: { inputTokens: body.usage?.prompt_tokens ?? 0, outputTokens: body.usage?.completion_tokens ?? 0 } };
  }
}

function toAnthropicContent(content: Msg['content']) {
  if (typeof content === 'string') return content;
  return content.map((part) => part.type === 'text'
    ? { type: 'text', text: part.text }
    : { type: 'image', source: { type: 'base64', media_type: part.mediaType, data: part.dataBase64 } });
}

export class AnthropicModelPort implements ModelPort {
  constructor(private readonly apiKey: string, private readonly models: Record<'small' | 'large', string>) {}
  async completeStructured(req: StructuredRequest): Promise<StructuredResponse> {
    const messages = req.messages.map((m) => ({ role: m.role, content: toAnthropicContent(m.content) }));
    const res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: this.models[req.tier], max_tokens: req.maxTokens, system: req.system, messages, tools: [{ name: 'respond', description: 'Return only the validated structured result.', input_schema: req.schema }], tool_choice: { type: 'tool', name: 'respond' } }) });
    if (!res.ok) throw new ModelGatewayError(`Anthropic returned ${res.status}: ${await res.text()}`);
    const body = await res.json() as { content?: { type: string; input?: unknown }[]; usage?: { input_tokens?: number; output_tokens?: number } };
    const tool = body.content?.find((item) => item.type === 'tool_use'); if (!tool?.input) throw new ModelGatewayError('Anthropic returned no tool result.');
    return { json: tool.input, usage: { inputTokens: body.usage?.input_tokens ?? 0, outputTokens: body.usage?.output_tokens ?? 0 } };
  }
}

export type Scope = 'in_scope_design' | 'in_scope_question' | 'out_of_scope';
export interface AuditEntry { at: string; sessionId: string; stage: 'fastpath' | 'scope_gate' | 'extract'; model: string; inputTokens: number; outputTokens: number; latencyMs: number; outcome: 'ok' | 'refused' | 'schema_reject' | 'error'; }
export interface GatewayAudit { record(entry: AuditEntry): void; usedToday(sessionId: string): number; }

export function deterministicScope(message: string): Scope {
  // Plural-tolerant (door|doors, shelf|shelves…), and covers materials,
  // colors, rooms, and hardware — natural design talk must never be refused.
  // Biased to fail OPEN: only clearly unrelated messages are out of scope,
  // since the token budget already bounds abuse (design/05 §2.2).
  const furniture = /\b(wardrobes?|cabinets?|furniture|beds?|mattress(?:es)?|vanit(?:y|ies)|kommoden?|dressers?|closets?|drawers?|shel(?:f|ves)|doors?|tables?|sofas?|panels?|legs?|rails?|mirrors?|handles?|hinges?)\b/i;
  const materials = /\b(wood(?:en)?|oak|pine|walnut|birch|beech|maple|ash|mdf|plywood|veneer|melamine|lacquer(?:ed)?)\b/i;
  const design = /\b(design|colou?rs?|white|black|gr[ae]y|finish|style|room|bedroom|hallway|kitchen|living|storage|assembl\w*|build|fit|measure\w*|dimensions?|wide|tall|high|deep|narrow(?:er)?|wider|taller|higher|deeper|smaller|bigger|larger|millimet(?:er|re)s?|centimet(?:er|re)s?|mm|cm)\b/i;
  return furniture.test(message) || materials.test(message) || design.test(message)
    ? 'in_scope_design'
    : 'out_of_scope';
}

/** Parses cheap dimension/count edits without ever sending user text to a model. */
export function fastPathDelta(message: string): Record<string, number | string | boolean> | undefined {
  const patch: Record<string, number | string | boolean> = {};
  const toMm = (value: string, unit?: string) => Number(value) * (unit?.toLowerCase() === 'cm' ? 10 : unit?.toLowerCase() === 'm' ? 1000 : 1);
  // "width 900", "height to 2.1 m" — dimension word first.
  const dimension = /\b(width|height|depth)\s*(?:to|=|of|is)?\s*(\d+(?:\.\d+)?)\s*(mm|cm|m)?\b/ig;
  for (const match of message.matchAll(dimension)) patch[match[1].toLowerCase()] = toMm(match[2], match[3]);
  // "90 cm wide", "make it 2.1 m tall", "60 deep" — number first, how people talk.
  const spoken = /\b(\d+(?:\.\d+)?)\s*(mm|cm|m)?\s*(wide|broad|tall|high|deep)\b/ig;
  const axis: Record<string, string> = { wide: 'width', broad: 'width', tall: 'height', high: 'height', deep: 'depth' };
  for (const match of message.matchAll(spoken)) patch[axis[match[3].toLowerCase()]] = toMm(match[1], match[2]);
  const count = /\b(\d+)\s+(doors?|shelves?|drawers?)\b/ig; for (const match of message.matchAll(count)) patch[`${match[2].toLowerCase().replace(/s$/, '')}Count`] = Number(match[1]);
  if (/\b(no|without) hanging rail\b/i.test(message)) patch.hangingRail = false; else if (/\bhanging rail\b/i.test(message)) patch.hangingRail = true;
  return Object.keys(patch).length ? patch : undefined;
}
