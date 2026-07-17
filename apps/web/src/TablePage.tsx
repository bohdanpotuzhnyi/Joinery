// SPDX-License-Identifier: AGPL-3.0-or-later
// The table candidate flow: (1) free-form brief + room → (2) generated
// leg×top candidates, all in one printable pack → (3) send to the print
// manufacturer → (4) customer picks the printed candidate → production.
import { useCallback, useEffect, useState } from 'react';
import { ModelViewer } from './ModelViewer';

interface Variant {
  shape: 'rect' | 'rounded' | 'oval' | 'round';
  length: number;
  width: number;
  thickness: number;
  legSku: string;
  label?: string;
}

interface ProposeResponse {
  ok: boolean;
  errors?: { code: string; message: string }[];
  brief?: { seats?: number; shapes?: string[]; maxLengthMm?: number };
  variants?: Variant[];
  spec?: unknown;
  sceneGlbBase64?: string;
  objText?: string;
}

interface ProjectSummary {
  id: string;
  title: string;
  state: string;
  revision: number;
  productType: string;
  parameters: { variants?: Variant[]; selectedVariant?: number };
  lastEvent?: { note?: string } | null;
}

const CHIP_CLASS: Record<string, string> = {
  draft: '', manufacturer_review: 'review', prototype_printed: 'review',
  customer_verify: 'active', sanity_review: 'review', finalized: 'active',
  order_submitted: 'active', in_production: 'done', closed: 'done',
};

function TopView({ v }: { v: Variant }) {
  const s = 90 / Math.max(v.length, v.width);
  const w = v.length * s, d = v.width * s;
  const inset = 80 * s;
  const legs = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz], i) => (
    <circle key={i} cx={50 + sx * (w / 2 - inset)} cy={50 + sz * (d / 2 - inset)} r={2.5} fill="#e8a33d" />
  ));
  return (
    <svg width={100} height={100} viewBox="0 0 100 100" role="img" aria-label={`${v.shape} top view`}>
      {v.shape === 'round' && <circle cx={50} cy={50} r={w / 2} fill="#57493a" stroke="#8a7350" />}
      {v.shape === 'oval' && <ellipse cx={50} cy={50} rx={w / 2} ry={d / 2} fill="#57493a" stroke="#8a7350" />}
      {(v.shape === 'rect' || v.shape === 'rounded') && (
        <rect x={50 - w / 2} y={50 - d / 2} width={w} height={d} rx={v.shape === 'rounded' ? 8 : 1} fill="#57493a" stroke="#8a7350" />
      )}
      {v.shape !== 'round' && v.shape !== 'oval' ? legs : null}
    </svg>
  );
}

export function TablePage() {
  const [text, setText] = useState('');
  const [room, setRoom] = useState<{ widthMm?: number; depthMm?: number; heightMm?: number; photoKey?: string }>({});
  const [proposal, setProposal] = useState<ProposeResponse | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const refreshProjects = useCallback(() => {
    fetch('/api/projects').then((r) => r.json())
      .then((all: ProjectSummary[]) => setProjects(all.filter((p) => p.productType === 'table')))
      .catch(() => undefined);
  }, []);
  useEffect(refreshProjects, [refreshProjects]);

  async function uploadPhoto(file: File) {
    const dataBase64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const r = await fetch('/api/uploads', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataBase64, mime: file.type }),
    });
    const j = await r.json();
    if (r.ok) setRoom((prev) => ({ ...prev, photoKey: j.key }));
    setFlash(r.ok ? { kind: 'ok', text: 'Room photo attached.' } : { kind: 'err', text: j.error ?? 'Upload failed' });
  }

  async function propose() {
    setBusy(true);
    setFlash(null);
    try {
      const r = await fetch('/api/designs/table-variants', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, room: (room.widthMm || room.depthMm || room.photoKey) ? room : undefined }),
      });
      const j = (await r.json()) as ProposeResponse;
      setProposal(j);
      if (!j.ok) setFlash({ kind: 'err', text: j.errors?.[0]?.message ?? 'No proposals possible' });
    } finally {
      setBusy(false);
    }
  }

  async function sendToPrint() {
    if (!proposal?.spec) return;
    setBusy(true);
    try {
      const created = await fetch('/api/projects', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: `table candidates (${proposal.variants?.length})`, spec: proposal.spec }),
      }).then((r) => r.json());
      if (!created.ok) { setFlash({ kind: 'err', text: created.errors?.[0]?.message ?? created.error }); return; }
      const confirmed = await fetch(`/api/projects/${created.project.id}/confirm`, { method: 'POST' }).then((r) => r.json());
      setFlash(confirmed.ok
        ? { kind: 'ok', text: `Candidate pack ${created.project.id} sent — the workshop will print all ${proposal.variants?.length} minis and ship them to you.` }
        : { kind: 'err', text: confirmed.error ?? 'Failed' });
      refreshProjects();
    } finally {
      setBusy(false);
    }
  }

  async function selectCandidate(projectId: string, index: number) {
    const r = await fetch(`/api/designs/table-variants/${projectId}/select`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ index }),
    });
    const j = await r.json();
    setFlash(r.ok
      ? { kind: 'ok', text: `Selection recorded — "${j.selected?.label ?? index}" heads to sanity review, then production.` }
      : { kind: 'err', text: j.error ?? 'Selection failed' });
    refreshProjects();
  }

  return (
    <>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(300px, 1fr) minmax(360px, 1.6fr)', alignItems: 'start' }}>
        <div className="card">
          <h3>Step 1 — just say it</h3>
          <p className="subtitle" style={{ fontSize: '0.85rem' }}>
            Describe the table in your own words. We parse it locally — an AI provider only makes it smarter.
          </p>
          <label className="field">
            <textarea rows={3} value={text} placeholder='e.g. "a round table for 6 people, at most 1.4 m across"'
              onChange={(e) => setText(e.target.value)} />
          </label>
          <h3>Your room</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 0.5rem' }}>
            <label className="field"><span>Wall (mm)</span>
              <input type="number" value={room.widthMm ?? ''} placeholder="3600"
                onChange={(e) => setRoom((r) => ({ ...r, widthMm: e.target.value ? Number(e.target.value) : undefined }))} />
            </label>
            <label className="field"><span>Depth (mm)</span>
              <input type="number" value={room.depthMm ?? ''} placeholder="4200"
                onChange={(e) => setRoom((r) => ({ ...r, depthMm: e.target.value ? Number(e.target.value) : undefined }))} />
            </label>
          </div>
          <label className="field"><span>Room photo — sofa, plants and all {room.photoKey ? '✓' : ''}</span>
            <input type="file" accept="image/jpeg,image/png,image/webp"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadPhoto(f); }} />
          </label>
          <button className="btn primary" disabled={busy} style={{ width: '100%' }} onClick={() => void propose()}>
            {busy ? 'Working…' : 'Propose tops & legs'}
          </button>
          {flash && <div className={`msg ${flash.kind}`}>{flash.text}</div>}
        </div>

        <div className="card">
          <h3>Step 2 — candidates {proposal?.variants ? `(${proposal.variants.length})` : ''}</h3>
          {!proposal?.ok && <p className="subtitle" style={{ fontSize: '0.9rem' }}>Proposals appear here: your custom tops on the workshop's predefined legs.</p>}
          {proposal?.ok && proposal.variants && (
            <>
              <div className="grid cols-3" style={{ gap: '0.8rem' }}>
                {proposal.variants.map((v, i) => (
                  <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '0.6rem', textAlign: 'center' }}>
                    <TopView v={v} />
                    <div style={{ fontSize: '0.78rem' }}>
                      <b>Candidate {String.fromCharCode(65 + i)}</b><br />
                      <span className="subtitle">{v.shape} · {v.length}×{v.width} mm<br />{v.thickness} mm top · {v.legSku.replace('leg_', '')}</span>
                    </div>
                  </div>
                ))}
              </div>
              {proposal.sceneGlbBase64 && (
                <div style={{ marginTop: '0.9rem' }}>
                  <ModelViewer glbBase64={proposal.sceneGlbBase64} />
                </div>
              )}
              <div className="btn-row">
                {proposal.objText && (
                  <a className="btn"
                    href={URL.createObjectURL(new Blob([proposal.objText], { type: 'model/obj' }))}
                    download="table-candidates.obj"
                  >⬇ OBJ of all candidates</a>
                )}
                <button className="btn primary" disabled={busy} onClick={() => void sendToPrint()}>
                  Send candidates to 3D print →
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {projects.length > 0 && (
        <div className="card" style={{ marginTop: '1.25rem' }}>
          <h3>My table orders</h3>
          {projects.map((p) => (
            <div className="queue-item" key={p.id}>
              <div className="grow">
                <b>{p.title}</b>{' '}
                <span className={`chip ${CHIP_CLASS[p.state] ?? ''}`}>{p.state.replaceAll('_', ' ')}</span>
                <div className="meta mono">{p.id} · rev {p.revision}
                  {p.parameters.selectedVariant !== undefined ? ` · picked ${String.fromCharCode(65 + p.parameters.selectedVariant)}` : ''}
                </div>
              </div>
              {p.state === 'customer_verify' && (p.parameters.variants ?? []).map((v, i) => (
                <button key={i} className="btn small primary" onClick={() => void selectCandidate(p.id, i)}>
                  I pick {String.fromCharCode(65 + i)}
                </button>
              ))}
              {p.state === 'in_production' && <span className="meta">🎉 being fabricated</span>}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
