// SPDX-License-Identifier: AGPL-3.0-or-later
// Manufacturer portal (design/06 §1 + §2.3): review queue for incoming
// designs, and the onboarding wizard producing a validated ManufacturerProfile.
// Role is implied by the page — real auth replaces this after the workshop.
import { useCallback, useEffect, useState } from 'react';

interface ProjectSummary {
  id: string;
  title: string;
  state: string;
  revision: number;
  manufacturerId: string;
  parameters: Record<string, number | string | boolean>;
}

const REVIEW_STATES = ['manufacturer_review', 'prototype_printed'];

export function MfrPage() {
  const [queue, setQueue] = useState<ProjectSummary[]>([]);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const refresh = useCallback(() => {
    fetch('/api/projects')
      .then((r) => r.json())
      .then((all: ProjectSummary[]) => setQueue(all.filter((p) => REVIEW_STATES.includes(p.state))))
      .catch(() => setMsg({ kind: 'err', text: 'Cannot load queue — API offline?' }));
  }, []);

  useEffect(refresh, [refresh]);

  async function act(id: string, to: string, note?: string) {
    const r = await fetch(`/api/projects/${id}/transition`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, role: 'manufacturer', note }),
    });
    const j = await r.json();
    setMsg(r.ok
      ? { kind: 'ok', text: `${id}: ${j.project.state.replaceAll('_', ' ')}` }
      : { kind: 'err', text: j.error ?? 'Transition failed' });
    refresh();
  }

  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(320px, 1.3fr) minmax(300px, 1fr)', alignItems: 'start' }}>
      <div className="card">
        <h3>Review queue</h3>
        {msg && <div className={`msg ${msg.kind}`}>{msg.text}</div>}
        {queue.length === 0 && <p className="subtitle" style={{ fontSize: '0.9rem' }}>No designs waiting. Customer confirmations land here.</p>}
        {queue.map((p) => (
          <div className="queue-item" key={p.id}>
            <div className="grow">
              <b>{p.title}</b> <span className="chip review">{p.state.replaceAll('_', ' ')}</span>
              <div className="meta mono">
                {p.id} · rev {p.revision} · {Object.entries(p.parameters).map(([k, v]) => `${k}=${String(v)}`).join(' ')}
              </div>
            </div>
            {p.state === 'manufacturer_review' && (
              <>
                <button className="btn primary small" onClick={() => void act(p.id, 'prototype_printed', 'Approved; scale prototype printed')}>
                  Approve &amp; print prototype
                </button>
                <button className="btn danger small" onClick={() => {
                  const note = window.prompt('Rejection reason (goes to the customer):') ?? 'Rejected';
                  void act(p.id, 'draft', note);
                }}>Reject</button>
              </>
            )}
            {p.state === 'prototype_printed' && (
              <button className="btn small" onClick={() => void act(p.id, 'customer_verify', 'Prototype shipped')}>
                Mark prototype shipped
              </button>
            )}
          </div>
        ))}
      </div>
      <OnboardingCard onDone={refresh} />
    </div>
  );
}

/* Defaults for catalog sections the wizard doesn't ask about (yet):
   a sane RTA hardware set the kernel can resolve SKUs against. */
const DEFAULT_CATALOG = {
  fasteners: [{ sku: 'conf_6.3x50', kind: 'confirmat_6.3x50' }],
  hinges: [{ sku: 'hinge_clip_110', kind: 'clip_top_110' }],
  connectors: [{ sku: 'cam_15_dowel_8', kind: 'cam_dowel_pair' }],
  finishes: [{ id: 'MDF18_white', displayName: 'White MDF', kind: 'melamine' }],
};

const ALL_CLASSES = ['wardrobe', 'bed', 'vanity', 'kommode', 'kitchen', 'shelf', 'table'];

const TOOL_KINDS: { id: string; label: string }[] = [
  { id: 'cnc_3axis', label: 'CNC (3-axis)' },
  { id: 'cnc_5axis', label: 'CNC (5-axis)' },
  { id: 'laser_cutter', label: 'Laser cutter' },
  { id: 'fdm_printer', label: '3D printer (FDM)' },
  { id: 'sla_printer', label: '3D printer (resin)' },
  { id: 'edgebander', label: 'Edgebander' },
  { id: 'panel_saw', label: 'Panel saw' },
  { id: 'drill_press', label: 'Drill press' },
  { id: 'sander', label: 'Sander' },
  { id: 'spray_booth', label: 'Spray booth' },
];

const SERVICES: { id: string; label: string }[] = [
  { id: 'prototype_print', label: 'Prints scale prototypes' },
  { id: 'room_print', label: 'Prints the room shell with the model' },
  { id: 'assembly', label: 'Assembly service' },
  { id: 'delivery', label: 'Delivery' },
  { id: 'design_consultation', label: 'Design consultation' },
  { id: 'installation', label: 'On-site installation' },
];

const MODIFIABLE: { id: string; label: string }[] = [
  { id: 'dimensions', label: 'Dimensions' },
  { id: 'layout', label: 'Layout (sections, doors, interior)' },
  { id: 'materials', label: 'Materials' },
  { id: 'finishes', label: 'Finishes / colors' },
  { id: 'hardware', label: 'Hardware' },
];

interface ToolRow { kind: string; name: string; envX?: number; envY?: number; envZ?: number }

function OnboardingCard({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({
    name: '', locale: 'de-CH', classes: ['wardrobe'] as string[],
    envX: 2500, envY: 1250, materials: 'MDF18, PLY18, MDF12',
    system32: true, leadTimeDays: 15,
    services: ['prototype_print', 'room_print'] as string[],
    modifiable: ['dimensions', 'layout', 'finishes'] as string[],
  });
  const [tools, setTools] = useState<ToolRow[]>([
    { kind: 'cnc_3axis', name: '', envX: 2500, envY: 1250 },
    { kind: 'fdm_printer', name: '', envX: 220, envY: 220, envZ: 250 },
  ]);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const slug = form.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    const profile = {
      profileVersion: 1,
      manufacturerId: `mfr_${slug || 'unnamed'}`,
      identity: { name: form.name, locale: form.locale },
      stableCatalog: DEFAULT_CATALOG,
      capabilities: [
        // Derived from the tool list: any CNC → flat wooden parts of any shape
        // within its envelope; any FDM/SLA printer → prototype printing.
        ...(tools.some((t) => t.kind.startsWith('cnc')) ? [{
          process: 'cnc_wood_2d',
          materials: form.materials.split(',').map((m) => m.trim()).filter(Boolean),
          envelopeMm: { x: form.envX, y: form.envY },
          minFeatureMm: 8,
          internalCornerRadiusMm: 4,
        }] : []),
        { process: 'drilling' },
        ...(tools.filter((t) => t.kind === 'fdm_printer' || t.kind === 'sla_printer').slice(0, 1).map((t) => ({
          process: 'print_prototype_fdm',
          envelopeMm: { x: t.envX ?? 220, y: t.envY ?? 220, z: t.envZ ?? 250 },
        }))),
      ],
      tools: tools.map((t) => ({
        kind: t.kind,
        ...(t.name ? { name: t.name } : {}),
        ...(t.envX || t.envY || t.envZ ? { envelopeMm: { ...(t.envX ? { x: t.envX } : {}), ...(t.envY ? { y: t.envY } : {}), ...(t.envZ ? { z: t.envZ } : {}) } } : {}),
      })),
      services: form.services,
      customerModifiable: Object.fromEntries(MODIFIABLE.map((m) => [m.id, form.modifiable.includes(m.id)])),
      ...(form.system32 ? { standards: [{ id: 'system32', params: { pitchMm: 32, boreMm: 5, setbackMm: 37 } }] } : {}),
      productClasses: form.classes,
      rules: { leadTimeDays: form.leadTimeDays, orderFormat: 'dxf+csv_v1' },
    };
    const r = await fetch('/api/manufacturers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(profile),
    });
    const j = await r.json();
    setMsg(r.ok
      ? { kind: 'ok', text: `Onboarded as ${j.manufacturerId} — customers can now design against your capabilities.` }
      : { kind: 'err', text: j.error ?? 'Onboarding failed' });
    if (r.ok) onDone();
  }

  const toggleClass = (c: string) =>
    setForm((f) => ({ ...f, classes: f.classes.includes(c) ? f.classes.filter((x) => x !== c) : [...f.classes, c] }));

  return (
    <form className="card" onSubmit={(e) => void submit(e)}>
      <h3>Onboarding — become a manufacturer</h3>
      <label className="field"><span>Workshop name</span>
        <input type="text" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Schreinerei Muster" />
      </label>
      <label className="field"><span>Product classes you make</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
          {ALL_CLASSES.map((c) => (
            <label key={c} className="chip" style={{ cursor: 'pointer', ...(form.classes.includes(c) ? { color: 'var(--accent)', borderColor: 'var(--accent)' } : {}) }}>
              <input type="checkbox" style={{ display: 'none' }} checked={form.classes.includes(c)} onChange={() => toggleClass(c)} />
              {c}
            </label>
          ))}
        </div>
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 0.8rem' }}>
        <label className="field"><span>Max part length (mm)</span>
          <input type="number" value={form.envX} onChange={(e) => setForm({ ...form, envX: Number(e.target.value) })} />
        </label>
        <label className="field"><span>Max part width (mm)</span>
          <input type="number" value={form.envY} onChange={(e) => setForm({ ...form, envY: Number(e.target.value) })} />
        </label>
      </div>
      <label className="field"><span>Sheet materials (comma-separated)</span>
        <input type="text" value={form.materials} onChange={(e) => setForm({ ...form, materials: e.target.value })} />
      </label>
      <label className="field"><span>Machines on your floor</span>
        <div>
          {tools.map((tool, i) => (
            <div key={i} style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', marginBottom: '0.35rem' }}>
              <select value={tool.kind} style={{ flex: 2 }}
                onChange={(e) => setTools((prev) => prev.map((t, j) => (j === i ? { ...t, kind: e.target.value } : t)))}>
                {TOOL_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
              </select>
              <input type="text" placeholder="model (optional)" value={tool.name} style={{ flex: 2 }}
                onChange={(e) => setTools((prev) => prev.map((t, j) => (j === i ? { ...t, name: e.target.value } : t)))} />
              <button type="button" className="btn small danger" onClick={() => setTools((prev) => prev.filter((_, j) => j !== i))}>×</button>
            </div>
          ))}
          <button type="button" className="btn small" onClick={() => setTools((prev) => [...prev, { kind: 'panel_saw', name: '' }])}>+ Add machine</button>
        </div>
      </label>
      <label className="field"><span>Services you offer</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
          {SERVICES.map((sv) => (
            <label key={sv.id} className="chip" style={{ cursor: 'pointer', ...(form.services.includes(sv.id) ? { color: 'var(--accent)', borderColor: 'var(--accent)' } : {}) }}>
              <input type="checkbox" style={{ display: 'none' }} checked={form.services.includes(sv.id)}
                onChange={() => setForm((f) => ({ ...f, services: f.services.includes(sv.id) ? f.services.filter((x) => x !== sv.id) : [...f.services, sv.id] }))} />
              {sv.label}
            </label>
          ))}
        </div>
      </label>
      <label className="field"><span>What customers may modify</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
          {MODIFIABLE.map((m) => (
            <label key={m.id} className="chip" style={{ cursor: 'pointer', ...(form.modifiable.includes(m.id) ? { color: 'var(--accent)', borderColor: 'var(--accent)' } : {}) }}>
              <input type="checkbox" style={{ display: 'none' }} checked={form.modifiable.includes(m.id)}
                onChange={() => setForm((f) => ({ ...f, modifiable: f.modifiable.includes(m.id) ? f.modifiable.filter((x) => x !== m.id) : [...f.modifiable, m.id] }))} />
              {m.label}
            </label>
          ))}
        </div>
      </label>
      <label className="field inline"><span>System 32 drilling standard</span>
        <input type="checkbox" checked={form.system32} onChange={(e) => setForm({ ...form, system32: e.target.checked })} />
      </label>
      <label className="field"><span>Lead time (days)</span>
        <input type="number" value={form.leadTimeDays} onChange={(e) => setForm({ ...form, leadTimeDays: Number(e.target.value) })} />
      </label>
      <button className="btn primary" type="submit">Register workshop</button>
      {msg && <div className={`msg ${msg.kind}`}>{msg.text}</div>}
    </form>
  );
}
