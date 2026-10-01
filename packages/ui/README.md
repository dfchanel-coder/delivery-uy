# packages/ui

Status: **not implemented**.

Purpose: shared React/Next.js design system for `apps/admin`
(ARCHITECTURE.md section 3, `docs/MODULE_BOUNDARIES.md`).

Why it is empty:

- `apps/admin` does not exist yet, so there is no consumer to design against;
- inventing components now would violate AGENTS.md section 5 (no placeholder
  implementations presented as finished work).

Planned content when created:

- design tokens (colour, spacing, typography) as CSS variables;
- primitives: `Button`, `Input`, `Select`, `Table`, `Modal`, `Toast`;
- layout: `AppShell`, `Sidebar`, `PageHeader`;
- accessibility baseline (focus management, labels, contrast).

Next step: PHASE 01, together with the `apps/admin` skeleton.