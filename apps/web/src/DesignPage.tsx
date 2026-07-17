// SPDX-License-Identifier: AGPL-3.0-or-later
// Customer surface: parametric design (zero-LLM path) + the order lifecycle —
// confirm → manufacturer review → prototype → verify → finalize (design/06 §2).
// Sections mode: the wardrobe is a row of open/closed compartments, each with
// its own interior. Room context feeds validation and ships with the print.
import { useCallback, useEffect, useState } from 'react';
import { ModelViewer } from './ModelViewer';

interface Part {
  id: string;
  name: string;
  qty: number;
  size: { length: number; width: number; thickness: number };
  material: string;
}

interface SolveResponse {
  ok: boolean;
  error?: string;
  /** Nest's default framework-level error shape (e.g. body-parser limits) uses this instead of `error`. */
  message?: string;
  errors?: { code: string; message: string }[];
  partGraph?: {
    parts: Part[];
    hardware: { sku?: string; kind: string; count: number }[];
    warnings?: string[];
  };
  cutListCsv?: string;
  sceneGlbBase64?: string;
  objText?: string;
}

interface ImageImportResponse extends SolveResponse {
  spec?: { productType: string; parameters: Record<string, unknown> };
  delta?: { assumptions?: string[]; clarifyingQuestion?: string | null };
}

const WARDROBE_PARAM_KEYS = ['width', 'height', 'depth', 'doorCount', 'shelfCount', 'hangingRail'] as const;

interface Manufacturer { manufacturerId: string; name: string; productClasses: string[] }

interface ProjectSummary {
  id: string;
  title: string;
  state: string;
  revision: number;
  manufacturerId: string;
  lastEvent?: { note?: string; actor?: { role: string } } | null;
}

interface Section {
  closed: boolean;
  shelves: number;
  hangingRail: boolean;
  doorShelves: number;
}

interface Room { widthMm?: number; depthMm?: number; heightMm?: number; photoKey?: string }

const CHIP_CLASS: Record<string, string> = {
  draft: '', manufacturer_review: 'review', prototype_printed: 'review',
  customer_verify: 'active', sanity_review: 'review', finalized: 'active',
  order_submitted: 'active', in_production: 'done', closed: 'done',
};

const DEFAULT_SECTIONS: Section[] = [
  { closed: true, shelves: 3, hangingRail: false, doorShelves: 0 },
  { closed: true, shelves: 0, hangingRail: true, doorShelves: 0 },
  { closed: true, shelves: 0, hangingRail: false, doorShelves: 3 },
  { closed: true, shelves: 2, hangingRail: false, doorShelves: 0 },
  { closed: false, shelves: 4, hangingRail: false, doorShelves: 0 },
];

export function DesignPage() {
  const [params, setParams] = useState({
    width: 800, height: 2100, depth: 600, doorCount: 2, shelfCount: 4, hangingRail: false,
  });
  const [sections, setSections] = useState<Section[] | null>(null); // null = classic mode
  const [room, setRoom] = useState<Room>({});
  const [manufacturers, setManufacturers] = useState<Manufacturer[]>([]);
  const [mfrId, setMfrId] = useState('mfr_demo');
  const [res, setRes] = useState<SolveResponse | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoNote, setPhotoNote] = useState<{ assumptions?: string[]; clarifyingQuestion?: string | null } | null>(null);
  const [otherProductType, setOtherProductType] = useState<string | null>(null);

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

  const spec = () => {
    const parameters: Record<string, unknown> = sections
      ? { width: params.width, height: params.height, depth: params.depth, sections }
      : { ...params };
    const hasRoom = room.widthMm || room.depthMm || room.heightMm || room.photoKey;
    return {
      specVersion: 1, projectId: 'prj_web_demo', revision: 1, manufacturerId: mfrId,
      productType: 'wardrobe', parameters, origin: 'form',
      ...(hasRoom ? { room } : {}),
    };
  };

  const solve = useCallback(async (manufacturerId = mfrId) => {
    setBusy(true);
    setPhotoNote(null);
    setOtherProductType(null);
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
  }, [mfrId, params, sections, room]);

  useEffect(() => { void solve(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Branch feature: read a DESIGN out of a photo/diagram via the vision model.
  function onPhotoSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setPhotoPreview(reader.result as string);
    reader.readAsDataURL(file);
  }

  async function importFromPhoto() {
    if (!photoPreview) return;
    const match = /^data:([^;]+);base64,(.*)$/s.exec(photoPreview);
    if (!match) return;
    const [, mime, dataBase64] = match;
    setPhotoBusy(true);
    setFlash(null);
    setPhotoNote(null);
    try {
      const r = await fetch('/api/designs/from-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataBase64, mime, manufacturerId: mfrId }),
      });
      const data: ImageImportResponse = await r.json();
      if (!data.ok) {
        setFlash({ kind: 'err', text: data.errors?.[0]?.message ?? data.error ?? data.message ?? 'Could not read a design from that photo.' });
        return;
      }
      setRes(data);
      setPhotoNote(data.delta ?? null);
      const productType = data.spec?.productType ?? 'wardrobe';
      if (productType === 'wardrobe') {
        setOtherProductType(null);
        const p = data.spec!.parameters;
        setParams((prev) => ({
          ...prev,
          ...Object.fromEntries(WARDROBE_PARAM_KEYS.filter((k) => k in p).map((k) => [k, p[k]])),
        }));
      } else {
        setOtherProductType(productType);
      }
      setFlash({ kind: 'ok', text: 'Generated a 3D model from your photo — refine it below.' });
    } catch {
      setFlash({ kind: 'err', text: 'API unreachable — is pnpm dev:api running?' });
    } finally {
      setPhotoBusy(false);
    }
  }

  // Main feature: attach the ROOM photo as context that travels with the spec.
  async function uploadPhoto(file: File) {
    const dataBase64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const r = await fetch('/api/uploads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataBase64, mime: file.type }),
    });
    const j = await r.json();
    if (r.ok) {
      setRoom((prev) => ({ ...prev, photoKey: j.key }));
      setFlash({ kind: 'ok', text: 'Room photo attached — it travels with the design.' });
    } else {
      setFlash({ kind: 'err', text: j.error ?? 'Upload failed' });
    }
  }

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
      body: JSON.stringify({ parameters: spec().parameters }),
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
  const setSection = (i: number, patch: Partial<Section>) =>
    setSections((prev) => prev!.map((sec, j) => (j === i ? { ...sec, ...patch } : sec)));

  const g = res?.partGraph;
  const s = 1 / 5;
  const W = params.width * s, H = params.height * s;
  const frontSlots = sections ? sections.length : params.doorCount;
  const slotW = ((params.width - 4 - (frontSlots - 1) * 3) / frontSlots) * s;

  return (
    <>
      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <h3>Start from a photo</h3>
        <p className="subtitle" style={{ marginBottom: '0.9rem' }}>
          Upload a photo or a dimensioned line drawing (e.g. an assembly-instruction diagram) and generate a starting
          3D model from it. This is a best-effort reading of the image — check the result and refine it below.
        </p>
        <div style={{ display: 'flex', gap: '0.9rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <label className="field" style={{ flex: '1 1 220px', marginBottom: 0 }}>
            <span>Image (JPEG, PNG, or WebP)</span>
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={onPhotoSelected} />
          </label>
          {photoPreview && <img src={photoPreview} alt="Selected furniture" style={{ maxHeight: 96, borderRadius: 8, border: '1px solid var(--border)' }} />}
          <button className="btn primary" type="button" disabled={!photoPreview || photoBusy}
            onClick={() => void importFromPhoto()}>
            {photoBusy ? 'Reading photo…' : 'Generate design from photo'}
          </button>
        </div>
        {photoNote?.clarifyingQuestion && <div className="msg warn" style={{ marginTop: '0.75rem' }}>{photoNote.clarifyingQuestion}</div>}
        {photoNote?.assumptions && photoNote.assumptions.length > 0 && (
          <ul style={{ marginTop: '0.75rem', fontSize: '0.85rem', color: 'var(--muted)' }}>
            {photoNote.assumptions.map((a) => <li key={a}>{a}</li>)}
          </ul>
        )}
        {otherProductType && (
          <div className="msg warn" style={{ marginTop: '0.75rem' }}>
            Generated a {otherProductType} — the form and order flow below only support wardrobes for now, so this
            preview isn't editable yet.
          </div>
        )}
      </div>

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

          <label className="field inline"><span><b>Sections mode</b> (compartments, each open or closed)</span>
            <input type="checkbox" checked={sections !== null}
              onChange={(e) => {
                if (e.target.checked) { setSections(DEFAULT_SECTIONS); setParams((p) => ({ ...p, width: Math.max(p.width, 2500) })); }
                else setSections(null);
              }} />
          </label>

          {sections === null ? (
            <>
              <label className="field"><span>Doors</span><input type="number" value={params.doorCount} onChange={num('doorCount')} /></label>
              <label className="field"><span>Shelves</span><input type="number" value={params.shelfCount} onChange={num('shelfCount')} /></label>
              <label className="field inline"><span>Hanging rail</span>
                <input type="checkbox" checked={params.hangingRail}
                  onChange={(e) => setParams((p) => ({ ...p, hangingRail: e.target.checked }))} />
              </label>
            </>
          ) : (
            <div style={{ marginBottom: '0.85rem' }}>
              {sections.map((sec, i) => (
                <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 9, padding: '0.5rem 0.6rem', marginBottom: '0.45rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <b style={{ fontSize: '0.85rem' }}>Section {i + 1}</b>
                    <span style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <label className="chip" style={{ cursor: 'pointer', ...(sec.closed ? { color: 'var(--accent)', borderColor: 'var(--accent)' } : {}) }}>
                        <input type="checkbox" style={{ display: 'none' }} checked={sec.closed}
                          onChange={(e) => setSection(i, { closed: e.target.checked, ...(e.target.checked ? {} : { doorShelves: 0 }) })} />
                        {sec.closed ? 'closed' : 'open'}
                      </label>
                      <button type="button" className="btn small danger" onClick={() => setSections((prev) => prev!.filter((_, j) => j !== i))}>×</button>
                    </span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.3rem 0.6rem', marginTop: '0.4rem', fontSize: '0.8rem' }}>
                    <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>Shelves
                      <input type="number" min={0} max={12} value={sec.shelves} style={{ width: 56 }}
                        onChange={(e) => setSection(i, { shelves: Number(e.target.value) })} />
                    </label>
                    <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>Hanger
                      <input type="checkbox" checked={sec.hangingRail}
                        onChange={(e) => setSection(i, { hangingRail: e.target.checked })} />
                    </label>
                    {sec.closed && (
                      <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>Door shelves
                        <input type="number" min={0} max={6} value={sec.doorShelves} style={{ width: 56 }}
                          onChange={(e) => setSection(i, { doorShelves: Number(e.target.value) })} />
                      </label>
                    )}
                  </div>
                </div>
              ))}
              <button type="button" className="btn small" disabled={sections.length >= 8}
                onClick={() => setSections((prev) => [...prev!, { closed: true, shelves: 2, hangingRail: false, doorShelves: 0 }])}>
                + Add section
              </button>
            </div>
          )}

          <h3 style={{ marginTop: '0.5rem' }}>Your room <span className="subtitle" style={{ fontWeight: 400, fontSize: '0.75rem' }}>(optional — the more we know, the better)</span></h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 0.5rem' }}>
            <label className="field"><span>Wall (mm)</span>
              <input type="number" value={room.widthMm ?? ''} placeholder="3200"
                onChange={(e) => setRoom((r) => ({ ...r, widthMm: e.target.value ? Number(e.target.value) : undefined }))} />
            </label>
            <label className="field"><span>Depth (mm)</span>
              <input type="number" value={room.depthMm ?? ''} placeholder="4000"
                onChange={(e) => setRoom((r) => ({ ...r, depthMm: e.target.value ? Number(e.target.value) : undefined }))} />
            </label>
            <label className="field"><span>Ceiling (mm)</span>
              <input type="number" value={room.heightMm ?? ''} placeholder="2400"
                onChange={(e) => setRoom((r) => ({ ...r, heightMm: e.target.value ? Number(e.target.value) : undefined }))} />
            </label>
          </div>
          <label className="field"><span>Room photo {room.photoKey ? '✓ attached' : ''}</span>
            <input type="file" accept="image/jpeg,image/png,image/webp"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadPhoto(f); }} />
          </label>

          <button className="btn" type="submit" disabled={busy} style={{ width: '100%', marginBottom: '0.5rem' }}>
            {busy ? 'Working…' : 'Solve design'}
          </button>
          {res?.ok && !otherProductType && (
            <button className="btn primary" type="button" disabled={busy} style={{ width: '100%' }}
              onClick={() => void confirmAndSend()}>
              Confirm &amp; send to manufacturer
            </button>
          )}
          {res && !res.ok && (res.errors ?? []).map((e) => (
            <div className="msg err" key={e.code + e.message}>{e.message}</div>
          ))}
          {g?.warnings?.map((w) => <div className="msg warn" key={w}>{w}</div>)}
          {flash && <div className={`msg ${flash.kind}`}>{flash.text}</div>}
        </form>

        {res?.ok && g && (
          <>
            <div className="card">
              <h3>3D model</h3>
              {res.sceneGlbBase64 && <ModelViewer glbBase64={res.sceneGlbBase64} />}
              {res.objText && (
                <a className="btn" style={{ marginTop: '0.6rem' }}
                  href={URL.createObjectURL(new Blob([res.objText], { type: 'model/obj' }))}
                  download="wardrobe.obj"
                >⬇ Download 3D model (OBJ)</a>
              )}
              {!otherProductType && (
                <>
                  <h4 style={{ marginTop: '1rem' }}>Front elevation</h4>
                  <div className="drawing-wrap">
                    <svg width={W + 16} height={H + 16} role="img" aria-label="wardrobe front elevation">
                      <g transform="translate(8,8)">
                        <rect x={0} y={0} width={W} height={H} fill="#3a3128" stroke="#8a7350" rx={2} />
                        {Array.from({ length: frontSlots }, (_, i) => {
                          const closed = sections ? sections[i]?.closed : true;
                          const x = 2 * s + i * (slotW + 3 * s);
                          return closed ? (
                            <g key={i}>
                              <rect x={x} y={2 * s} width={slotW} height={H - 4 * s} fill="#57493a" stroke="#8a7350" rx={1.5} />
                              <circle cx={i < frontSlots / 2 ? x + slotW - 7 : x + 7} cy={H / 2} r={2.5} fill="#e8a33d" />
                            </g>
                          ) : (
                            <g key={i}>
                              <rect x={x} y={2 * s} width={slotW} height={H - 4 * s} fill="#241f1a" stroke="#8a7350" rx={1.5} />
                              {Array.from({ length: sections?.[i]?.shelves ?? 0 }, (_, k) => (
                                <line key={k} x1={x} x2={x + slotW}
                                  y1={2 * s + ((H - 4 * s) / ((sections?.[i]?.shelves ?? 0) + 1)) * (k + 1)}
                                  y2={2 * s + ((H - 4 * s) / ((sections?.[i]?.shelves ?? 0) + 1)) * (k + 1)}
                                  stroke="#8a7350" strokeWidth={1.5} />
                              ))}
                            </g>
                          );
                        })}
                      </g>
                    </svg>
                  </div>
                  <p className="subtitle" style={{ fontSize: '0.8rem', marginTop: '0.6rem' }}>
                    {params.width} × {params.height} × {params.depth} mm — scale 1 px : 5 mm
                  </p>
                </>
              )}
            </div>

            <div className="card">
              <h3>Parts &amp; hardware</h3>
              <div style={{ maxHeight: 340, overflowY: 'auto' }}>
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
              </div>
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
