// SPDX-License-Identifier: AGPL-3.0-or-later
// Ops sanity-review console (design/06 §2.3): the mandatory HUMAN gate before
// production. The release button stays disabled until every check is ticked.
import { useCallback, useEffect, useState } from 'react';

interface ProjectDetail {
  id: string;
  title: string;
  state: string;
  revision: number;
  manufacturerId: string;
  partGraph?: { parts: { id: string; name: string; qty: number }[]; hardware: { kind: string; count: number }[]; warnings?: string[] };
  events: { from: string; to: string; actor: { role: string }; at: string; note?: string }[];
}

const CHECKS = [
  'Constraint solver passes on the final revision',
  'All hardware resolves to the manufacturer stable catalog',
  'Part sizes fit the manufacturer envelope',
  'Order pack opens in the agreed format (dxf+csv_v1)',
  'Warnings reviewed (wall-anchor, two-person steps)',
];

export function OpsPage() {
  const [items, setItems] = useState<ProjectDetail[]>([]);
  const [checked, setChecked] = useState<Record<string, boolean[]>>({});
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const refresh = useCallback(() => {
    fetch('/api/projects?state=sanity_review')
      .then((r) => r.json())
      .then(async (list: { id: string }[]) => {
        const detailed = await Promise.all(
          list.map((p) => fetch(`/api/projects/${p.id}`).then((r) => r.json() as Promise<ProjectDetail>)),
        );
        setItems(detailed);
      })
      .catch(() => setMsg({ kind: 'err', text: 'Cannot load queue — API offline?' }));
  }, []);

  useEffect(refresh, [refresh]);

  async function act(id: string, to: string, note: string) {
    const r = await fetch(`/api/projects/${id}/transition`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, role: 'ops', note }),
    });
    const j = await r.json();
    setMsg(r.ok
      ? { kind: 'ok', text: `${id} → ${j.project.state.replaceAll('_', ' ')}` }
      : { kind: 'err', text: j.error ?? 'Transition failed' });
    refresh();
  }

  return (
    <div className="card">
      <h3>Orders awaiting sanity review</h3>
      <p className="subtitle" style={{ fontSize: '0.85rem' }}>
        Nothing enters production purely machine-approved. Tick every check, then release.
      </p>
      {msg && <div className={`msg ${msg.kind}`}>{msg.text}</div>}
      {items.length === 0 && <p className="subtitle" style={{ fontSize: '0.9rem' }}>Queue is empty.</p>}
      {items.map((p) => {
        const marks = checked[p.id] ?? CHECKS.map(() => false);
        const allChecked = marks.every(Boolean);
        return (
          <div key={p.id} style={{ borderTop: '1px solid var(--border)', paddingTop: '0.9rem', marginTop: '0.9rem' }}>
            <b>{p.title}</b> <span className="chip review">sanity review</span>
            <div className="meta mono" style={{ color: 'var(--muted)', fontSize: '0.82rem' }}>
              {p.id} · rev {p.revision} · {p.manufacturerId} ·{' '}
              {p.partGraph ? `${p.partGraph.parts.length} part types, ${p.partGraph.hardware.reduce((n, h) => n + h.count, 0)} hardware items` : 'solve failed!'}
            </div>
            {p.partGraph?.warnings?.map((w) => <div className="msg warn" key={w}>{w}</div>)}
            <ul className="checklist">
              {CHECKS.map((c, i) => (
                <li key={c}>
                  <input
                    type="checkbox"
                    checked={marks[i]}
                    onChange={() => setChecked((prev) => {
                      const next = [...(prev[p.id] ?? CHECKS.map(() => false))];
                      next[i] = !next[i];
                      return { ...prev, [p.id]: next };
                    })}
                  />
                  {c}
                </li>
              ))}
            </ul>
            <div className="btn-row">
              <button className="btn primary" disabled={!allChecked}
                onClick={() => void act(p.id, 'in_production', `Released; checklist complete (${CHECKS.length}/${CHECKS.length})`)}>
                Release to production
              </button>
              <button className="btn danger" onClick={() => {
                const note = window.prompt('Anomaly description (returns the design to draft):') ?? 'Anomaly found';
                void act(p.id, 'draft', note);
              }}>Return to draft</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
