# Furniture Platform (MLP)

Custom-furniture design platform: conversational design over a **deterministic
parametric kernel**, constrained by a **manufacturer capability profile**,
producing 3D models, printable prototypes, CNC-ready cut lists, and generated
assembly manuals.

- License: **AGPL-3.0-or-later** (see `LICENSE`). Sign commits with DCO (`git commit -s`).
- Design docs: `../design/` (start with `README.md` there; build plan is `07-build-architecture.md`).
- LLM-provider-agnostic: configure any model via `.env` (`MODEL_SMALL`/`MODEL_LARGE`);
  the platform is fully functional with the LLM disabled (form-based editing).

## Layout

| Path                   | Package                  | What                                                                                             |
|------------------------|--------------------------|--------------------------------------------------------------------------------------------------|
| `packages/contracts`   | `@furniture/contracts`   | The six JSON-Schema contracts + TS types + validators. **Everything else depends only on this.** |
| `packages/kernel`      | `@furniture/kernel`      | Deterministic core: product templates, constraint solver, PartGraph builder                      |
| `packages/exporters`   | `@furniture/exporters`   | PartGraph → cut list CSV / DXF / SVG / 3MF                                                       |
| `packages/scene`       | `@furniture/scene`       | PartGraph → glTF scene                                                                           |
| `packages/manual`      | `@furniture/manual`      | PartGraph → assembly plan → ManualDocument                                                       |
| `packages/llm-gateway` | `@furniture/llm-gateway` | ModelPort + provider adapters + scope gate + budgets                                             |
| `apps/api`             | `@furniture/api`         | NestJS API, workflow state machine, persistence                                                  |
| `apps/web`             | `@furniture/web`         | React SPA: `/design` (customer), `/mfr` (manufacturer), `/ops` (sanity review)                   |
| `infra/`               | —                        | docker-compose, Caddy, SQL migrations                                                            |

## Develop

```bash
pnpm install
pnpm build && pnpm test
pnpm dev:api   # http://localhost:3000/healthz
pnpm dev:web   # http://localhost:5173
```

## Deploy (single server)

```bash
cp .env.example .env  # fill in
docker compose -f infra/docker-compose.yml up -d --build
```
# Joinery
