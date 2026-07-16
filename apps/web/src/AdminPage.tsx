// SPDX-License-Identifier: AGPL-3.0-or-later
// Admin setup: which provider/models the agent runs on, and its instruction.
// The API key is write-only — the server returns a masked value and keeps the
// stored key when the mask is sent back unchanged.
import { useEffect, useState } from 'react';

interface ModelConfig {
  provider: 'openai-compatible' | 'anthropic';
  baseUrl: string;
  apiKey: string;
  modelSmall: string;
  modelLarge: string;
  agentInstruction: string;
}

type Status = { kind: 'ok' | 'err' | 'warn'; text: string } | null;

export function AdminPage() {
  const [cfg, setCfg] = useState<ModelConfig | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/admin/model-config')
      .then((r) => r.json())
      .then(setCfg)
      .catch(() => setStatus({ kind: 'err', text: 'Cannot load config — is the API running?' }));
  }, []);

  if (!cfg) return <p className="subtitle">Loading configuration…</p>;

  const set = <K extends keyof ModelConfig>(k: K) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setCfg({ ...cfg, [k]: e.target.value });

  async function save() {
    setBusy(true);
    setStatus(null);
    try {
      const r = await fetch('/api/admin/model-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setCfg(await r.json());
      setStatus({ kind: 'ok', text: 'Saved. The agent will use this configuration on its next call.' });
    } catch (e) {
      setStatus({ kind: 'err', text: `Save failed: ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  }

  async function testConnection() {
    setBusy(true);
    setStatus({ kind: 'warn', text: 'Testing connection…' });
    try {
      const r = await fetch('/api/admin/model-config/test', { method: 'POST' });
      const j = (await r.json()) as { ok: boolean; message: string; ms: number };
      setStatus({ kind: j.ok ? 'ok' : 'err', text: `${j.message} (${j.ms} ms)` });
    } catch (e) {
      setStatus({ kind: 'err', text: `Test failed: ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  }

  const isAnthropic = cfg.provider === 'anthropic';

  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(300px, 1fr) minmax(300px, 1fr)', alignItems: 'start' }}>
      <div className="card">
        <h3>Model provider</h3>
        <label className="field">
          <span>Provider</span>
          <select value={cfg.provider} onChange={set('provider')}>
            <option value="openai-compatible">OpenAI-compatible (Ollama / vLLM / llama.cpp / OpenRouter / …)</option>
            <option value="anthropic">Anthropic (Claude)</option>
          </select>
        </label>
        {!isAnthropic && (
          <label className="field">
            <span>Base URL</span>
            <input type="text" value={cfg.baseUrl} onChange={set('baseUrl')} placeholder="http://localhost:11434/v1" />
          </label>
        )}
        <label className="field">
          <span>API key / token {isAnthropic ? '' : '(empty is fine for local Ollama/vLLM)'}</span>
          <input type="password" value={cfg.apiKey} onChange={set('apiKey')} placeholder="sk-…" autoComplete="off" />
        </label>
        <label className="field">
          <span>Small model — scope gate, simple edits, caption polish</span>
          <input type="text" value={cfg.modelSmall} onChange={set('modelSmall')} placeholder="qwen3:8b" />
        </label>
        <label className="field">
          <span>Large model — full intent extraction</span>
          <input type="text" value={cfg.modelLarge} onChange={set('modelLarge')} placeholder="qwen3:32b" />
        </label>
        <div className="btn-row">
          <button className="btn primary" disabled={busy} onClick={() => void save()}>Save</button>
          <button className="btn" disabled={busy} onClick={() => void testConnection()}>Test connection</button>
        </div>
        {status && <div className={`msg ${status.kind}`}>{status.text}</div>}
      </div>

      <div className="card">
        <h3>Agent instruction</h3>
        <p className="subtitle" style={{ fontSize: '0.85rem', marginBottom: '0.7rem' }}>
          System prompt for the design assistant. It can only emit schema-validated
          DesignSpec patches — geometry stays deterministic regardless of what is written here.
        </p>
        <label className="field">
          <textarea rows={9} value={cfg.agentInstruction} onChange={set('agentInstruction')} />
        </label>
        <div className="btn-row">
          <button className="btn primary" disabled={busy} onClick={() => void save()}>Save</button>
        </div>
      </div>
    </div>
  );
}
