// SPDX-License-Identifier: AGPL-3.0-or-later
// Customer surface: parametric design (zero-LLM path) + the order lifecycle —
// confirm → manufacturer review → prototype → verify → finalize (design/06 §2).
import { useCallback, useEffect, useState } from 'react';
import { ModelViewer } from './ModelViewer';
import { ArPreview } from './ArPreview';

interface Part {
  id: string;
  name: string;
  qty: number;
  size: { length: number; width: number; thickness: number };
  material: string;
}

interface SolveResponse {
  ok: boolean;
  errors?: { code: string; message: string }[];
  partGraph?: {
    parts: Part[];
    hardware: { sku?: string; kind: string; count: number }[];
    warnings?: string[];
  };
  cutListCsv?: string;
  sceneGlbBase64?: string;
}

interface Manufacturer { manufacturerId: string; name: string; productClasses: string[] }

interface ProjectSummary {
  id: string;
  title: string;
  state: string;
  revision: number;
  manufacturerId: string;
  lastEvent?: { note?: string; actor?: { role: string } } | null;
}

const CHIP_CLASS: Record<string, string> = {
  draft: '', manufacturer_review: 'review', prototype_printed: 'review',
  customer_verify: 'active', sanity_review: 'review', finalized: 'active',
  order_submitted: 'active', in_production: 'done', closed: 'done',
};

export function DesignPage() {
  const [params, setParams] = useState({
    width: 800, height: 2100, depth: 600, doorCount: 2, shelfCount: 4, hangingRail: false,
  });
  const [manufacturers, setManufacturers] = useState<Manufacturer[]>([]);
  const [mfrId, setMfrId] = useState('mfr_demo');
  const [res, setRes] = useState<SolveResponse | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const refreshProjects = useCallback(() => {
    fetch('/api/projects').then((r) => r.json()).then(setProjects).catch(() => undefined);
  }, []);

  useEffect(() => {
    fetch('/api/manufacturers').then((r) => r.json()).then((list: Manufacturer[]) => {
      setManufacturers(list);
      if (list.length && !list.some((m) => m.manufacturerId === 'mfr_demo')) setMfrId(list[0].manufacturerId);
    }).catch(() => undefined);
    refreshProjects();
  }, [refreshProjects]);

  const spec = () => ({
    specVersion: 1, projectId: 'prj_web_demo', revision: 1, manufacturerId: mfrId,
    productType: 'wardrobe', parameters: params, origin: 'form',
  });

  const solve = useCallback(async (manufacturerId = mfrId) => {
    setBusy(true);
    try {
      const r = await fetch('/api/designs/solve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...spec(), manufacturerId }),
      });
      setRes(await r.json());
    } catch {
      setRes({ ok: false, errors: [{ code: 'network', message: 'API unreachable — is pnpm dev:api running?' }] });
    } finally {
      setBusy(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mfrId, params]);

  useEffect(() => { void solve(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function confirmAndSend() {
    setBusy(true);
    setFlash(null);
    try {
      const created = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spec: spec() }),
      }).then((r) => r.json());
      if (!created.ok) {
        setFlash({ kind: 'err', text: created.errors?.[0]?.message ?? created.error ?? 'Could not create project' });
        return;
      }
      const confirmed = await fetch(`/api/projects/${created.project.id}/confirm`, { method: 'POST' })
        .then((r) => r.json());
      setFlash(confirmed.ok
        ? { kind: 'ok', text: `Sent to manufacturer — ${created.project.id} is now in their review queue.` }
        : { kind: 'err', text: confirmed.error ?? 'Confirmation failed' });
      refreshProjects();
    } finally {
      setBusy(false);
    }
  }

  async function customerAction(id: string, to: string, note?: string) {
    const r = await fetch(`/api/projects/${id}/transition`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, role: 'customer', note }),
    });
    const j = await r.json();
    setFlash(r.ok
      ? { kind: 'ok', text: `${id} → ${j.project.state.replaceAll('_', ' ')}` }
      : { kind: 'err', text: j.error ?? 'Action failed' });
    refreshProjects();
  }

  async function resubmit(id: string) {
    const rev = await fetch(`/api/projects/${id}/revise`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parameters: params }),
    }).then((r) => r.json());
    if (!rev.ok) {
      setFlash({ kind: 'err', text: rev.errors?.[0]?.message ?? rev.error ?? 'Revision failed' });
      return;
    }
    const conf = await fetch(`/api/projects/${id}/confirm`, { method: 'POST' }).then((r) => r.json());
    setFlash(conf.ok
      ? { kind: 'ok', text: `${id} resubmitted with the current parameters (rev ${rev.project.revision}).` }
      : { kind: 'err', text: conf.error ?? 'Resubmit failed' });
    refreshProjects();
  }

  const num = (k: keyof typeof params) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setParams((p) => ({ ...p, [k]: Number(e.target.value) }));

  const g = res?.partGraph;
  const s = 1 / 5;
  const W = params.width * s, H = params.height * s;
  const doorW = ((params.width - 4 - (params.doorCount - 1) * 3) / params.doorCount) * s;

  return (
    <>
      <div className="studio">
        <form className="card" onSubmit={(e) => { e.preventDefault(); void solve(); }}>
          <h3>Wardrobe parameters</h3>
          <label className="field"><span>Manufacturer</span>
            <select value={mfrId} onChange={(e) => { setMfrId(e.target.value); void solve(e.target.value); }}>
              {manufacturers.map((m) => (
                <option key={m.manufacturerId} value={m.manufacturerId}>{m.name} ({m.productClasses.join(', ')})</option>
              ))}
            </select>
          </label>
          <label className="field"><span>Width (mm)</span><input type="number" value={params.width} onChange={num('width')} /></label>
          <label className="field"><span>Height (mm)</span><input type="number" value={params.height} onChange={num('height')} /></label>
          <label className="field"><span>Depth (mm)</span><input type="number" value={params.depth} onChange={num('depth')} /></label>
          <label className="field"><span>Doors</span><input type="number" value={params.doorCount} onChange={num('doorCount')} /></label>
          <label className="field"><span>Shelves</span><input type="number" value={params.shelfCount} onChange={num('shelfCount')} /></label>
          <label className="field inline"><span>Hanging rail</span>
            <input type="checkbox" checked={params.hangingRail}
              onChange={(e) => setParams((p) => ({ ...p, hangingRail: e.target.checked }))} />
          </label>
          <button className="btn" type="submit" disabled={busy} style={{ width: '100%', marginBottom: '0.5rem' }}>
            {busy ? 'Working…' : 'Solve design'}
          </button>
          {res?.ok && (
            <button className="btn primary" type="button" disabled={busy} style={{ width: '100%' }}
              onClick={() => void confirmAndSend()}>
              Confirm &amp; send to manufacturer
            </button>
          )}
          {res && !res.ok && (res.errors ?? []).map((e) => (
            <div className="msg err" key={e.code}>{e.message}</div>
          ))}
          {g?.warnings?.map((w) => <div className="msg warn" key={w}>{w}</div>)}
          {flash && <div className={`msg ${flash.kind}`}>{flash.text}</div>}
        </form>

        {res?.ok && g && (
          <>
            <div className="card">
              <h3>3D model</h3>
              {res.sceneGlbBase64 && <ModelViewer glbBase64={res.sceneGlbBase64} />}
              {res.sceneGlbBase64 && <details style={{ marginTop: '0.75rem' }}><summary>View in your room (AR)</summary><ArPreview glbBase64={res.sceneGlbBase64} /></details>}
              <h4 style={{ marginTop: '1rem' }}>Front elevation</h4>
              <div className="drawing-wrap">
                <svg width={W + 16} height={H + 16} role="img" aria-label="wardrobe front elevation">
                  <g transform="translate(8,8)">
                    <rect x={0} y={0} width={W} height={H} fill="#3a3128" stroke="#8a7350" rx={2} />
                    {Array.from({ length: params.doorCount }, (_, i) => (
                      <rect key={i}
                        x={2 * s + i * (doorW + 3 * s)} y={2 * s}
                        width={doorW} height={H - 4 * s}
                        fill="#57493a" stroke="#8a7350" rx={1.5}
                      />
                    ))}
                    {Array.from({ length: params.doorCount }, (_, i) => (
                      <circle key={i}
                        cx={i < params.doorCount / 2 ? 2 * s + (i + 1) * doorW + i * 3 * s - 7 : 2 * s + i * (doorW + 3 * s) + 7}
                        cy={H / 2} r={2.5} fill="#e8a33d"
                      />
                    ))}
                  </g>
                </svg>
              </div>
              <p className="subtitle" style={{ fontSize: '0.8rem', marginTop: '0.6rem' }}>
                {params.width} × {params.height} × {params.depth} mm — scale 1 px : 5 mm
              </p>
            </div>

            <div className="card">
              <h3>Parts &amp; hardware</h3>
              <table>
                <thead><tr><th>ID</th><th>Part</th><th>Qty</th><th>L × W × T (mm)</th></tr></thead>
                <tbody>
                  {g.parts.map((p) => (
                    <tr key={p.id}>
                      <td className="mono">{p.id}</td><td>{p.name}</td><td>{p.qty}</td>
                      <td className="mono">{p.size.length} × {p.size.width} × {p.size.thickness}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <ul className="hardware-list" style={{ marginTop: '0.9rem' }}>
                {g.hardware.map((h) => (
                  <li key={h.kind}><b>{h.count}×</b> {h.kind}{h.sku ? <span className="mono"> · {h.sku}</span> : null}</li>
                ))}
              </ul>
              {res.cutListCsv && (
                <a
                  className="btn"
                  href={URL.createObjectURL(new Blob([res.cutListCsv], { type: 'text/csv' }))}
                  download="cutlist.csv"
                >⬇ Download cut list (CSV)</a>
              )}
            </div>
          </>
        )}
      </div>

      {projects.length > 0 && (
        <div className="card" style={{ marginTop: '1.25rem' }}>
          <h3>My projects</h3>
          {projects.map((p) => (
            <div className="queue-item" key={p.id}>
              <div className="grow">
                <b>{p.title}</b>{' '}
                <span className={`chip ${CHIP_CLASS[p.state] ?? ''}`}>{p.state.replaceAll('_', ' ')}</span>
                <div className="meta mono">{p.id} · rev {p.revision} · {p.manufacturerId}</div>
                {p.state === 'draft' && p.lastEvent?.note && (
                  <div className="meta">Feedback: “{p.lastEvent.note}”</div>
                )}
              </div>
              {p.state === 'customer_verify' && (
                <>
                  <button className="btn primary small" onClick={() => void customerAction(p.id, 'finalized', 'Miniature verified — order it')}>
                    Finalize &amp; order
                  </button>
                  <button className="btn small" onClick={() => {
                    const note = window.prompt('What should change?') ?? 'Modification requested';
                    void customerAction(p.id, 'draft', note);
                  }}>Request changes</button>
                </>
              )}
              {p.state === 'draft' && p.lastEvent && (
                <button className="btn small" onClick={() => void resubmit(p.id)}>
                  Resubmit with current parameters
                </button>
              )}
              {p.state === 'in_production' && <span className="meta">🎉 being fabricated</span>}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
