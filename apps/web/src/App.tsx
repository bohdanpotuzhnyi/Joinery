// SPDX-License-Identifier: AGPL-3.0-or-later
// Shell: topbar + pathname routing (no router dep yet). Surfaces:
// /design (customer, M3/M4), /admin (model & agent setup), /mfr + /ops (M6).
import { useEffect, useState } from 'react';
import { DesignPage } from './DesignPage';
import { AdminPage } from './AdminPage';
import { MfrPage } from './MfrPage';
import { OpsPage } from './OpsPage';
import { ManualPage } from './ManualPage';
import { TablePage } from './TablePage';

const nav = [
  { path: '/design', label: 'Design studio' },
  { path: '/table', label: 'Table' },
  { path: '/mfr', label: 'Manufacturer' },
  { path: '/ops', label: 'Ops' },
  { path: '/admin', label: 'Setup' },
  { path: '/manual', label: 'Manual' },
];

const titles: Record<string, { eyebrow: string; title: string; sub: string }> = {
  '/design': {
    eyebrow: 'Customer',
    title: 'Design studio',
    sub: 'Set your parameters — every dimension is computed and checked against what the manufacturer can actually build.',
  },
  '/admin': {
    eyebrow: 'Admin',
    title: 'Platform setup',
    sub: 'Choose the model provider, add a token, and set the instruction the design agent runs with. Any provider works — local or hosted.',
  },
  '/mfr': {
    eyebrow: 'Manufacturer',
    title: 'Manufacturer portal',
    sub: 'Review incoming designs, print prototypes, and manage your capability profile.',
  },
  '/ops': {
    eyebrow: 'Ops',
    title: 'Sanity review console',
    sub: 'The mandatory human gate: re-verify every order before it enters production.',
  },
  '/manual': { eyebrow: 'Assembly', title: 'Build manual', sub: 'Step through the deterministic instructions for an exact project revision.' },
  '/table': {
    eyebrow: 'Customer',
    title: 'Table studio',
    sub: 'Say what you want. We generate custom tops on the workshop’s predefined legs, print the candidates, and you pick the one you hold in your hand.',
  },
};

function Home() {
  return (
    <>
      <div className="eyebrow">Open furniture platform</div>
      <h1>Furniture that fits your room,<br />made by a real workshop.</h1>
      <p className="subtitle">
        Describe what you need, see it in 3D, hold a printed miniature, then have it
        CNC-fabricated — with a step-by-step manual generated for your exact design.
        Deterministic geometry, AGPL-3.0, any AI model you like.
      </p>
      <div className="grid cols-3" style={{ marginTop: '1.75rem' }}>
        <a className="card home-card" href="/design">
          <div className="icon">📐</div>
          <h3>Design studio</h3>
          <p>Parametric wardrobe design with live constraint checking, parts list and cut-list export.</p>
        </a>
        <a className="card home-card" href="/mfr">
          <div className="icon">🏭</div>
          <h3>Manufacturer portal</h3>
          <p>Capability onboarding and order review queue. Coming in M6.</p>
        </a>
        <a className="card home-card" href="/admin">
          <div className="icon">⚙️</div>
          <h3>Setup</h3>
          <p>Configure the AI provider, models and the agent instruction. Admin only.</p>
        </a>
      </div>
    </>
  );
}

export function App() {
  const path = window.location.pathname;
  const [apiOk, setApiOk] = useState<boolean | null>(null);

  useEffect(() => {
    fetch('/healthz')
      .then((r) => r.json())
      .then((j) => setApiOk(Boolean(j.ok)))
      .catch(() => setApiOk(false));
  }, []);

  const head = titles[path];

  return (
    <>
      <header className="topbar">
        <a className="brand" href="/">
          <span className="mark">▤</span> Furniture Platform
        </a>
        <nav>
          {nav.map((n) => (
            <a key={n.path} href={n.path} className={path === n.path ? 'active' : ''}>{n.label}</a>
          ))}
        </nav>
        <span className="api-pill">
          <span className={`api-dot ${apiOk ? 'ok' : apiOk === null ? '' : 'bad'}`} />
          {apiOk === null ? 'checking…' : apiOk ? 'API online' : 'API offline'}
        </span>
      </header>
      <main className={`page ${path === '/' ? 'page-narrow' : ''}`}>
        {head && (
          <div style={{ marginBottom: '1.5rem' }}>
            <div className="eyebrow">{head.eyebrow}</div>
            <h2>{head.title}</h2>
            <p className="subtitle">{head.sub}</p>
          </div>
        )}
        {path === '/design' && <DesignPage />}
        {path === '/table' && <TablePage />}
        {path === '/admin' && <AdminPage />}
        {path === '/mfr' && <MfrPage />}
        {path === '/ops' && <OpsPage />}
        {path === '/manual' && <ManualPage />}
        {path === '/' && <Home />}
      </main>
    </>
  );
}
