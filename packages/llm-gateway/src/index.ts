// SPDX-License-Identifier: AGPL-3.0-or-later
// Provider-agnostic model layer (design/05 §2, design/07 §1).
// The gateway never trusts provider schema adherence: callers re-validate
// every response against the contracts package's AJV validators.

export interface Msg {
  role: 'user' | 'assistant';
  content: string;
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

// Adapters (openai-compatible, anthropic), the scope gate, the fast-path
// grammar, and budget/audit middleware land here in milestone M4 (design/07 §3).
