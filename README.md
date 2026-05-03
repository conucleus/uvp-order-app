# uvp-order-app

Human and operator signal console boundary for UVP orders.

`uvp-order-app/app` is the runnable participant package for invited order
executors and operators supervising wallets. It presents assigned 待办, required inputs,
wallet responsibility, supplier backing, submission confirmation, evidence
fingerprints, and proof summaries from Product DTOs and state-machine proof rows
instead of inventing a separate source of truth.

The old escrow demo UI remains deleted. Funding or stablecoin flows may appear
only as adapter-backed order conditions; this package does not custody, release,
refund, or transfer funds.

Before this workspace is split, `uvp-order-app` follows the PRD109 convergence
contract: the app is a human signal-container producer over Product DTOs, not a
place to hard-code business-specific actor, docking, or resource-access rules.

Package:

```text
@uvp-eth/order-app
```

## Development Topology

This repository is mounted by `uvp-eth` as a Git submodule. The app depends on
`@uvp-eth/product-dto` from `uvp-protocol` and `@uvp-eth/executor-kit` from
`uvp-executor-kit`.

Use the `uvp-eth` umbrella checkout for local integration development so pnpm can
resolve those cross-repository `workspace:*` dependencies. A standalone checkout
requires those packages to be published or linked into an equivalent local
workspace.

Local scripts:

```bash
pnpm --filter @uvp-eth/order-app dev
pnpm --filter @uvp-eth/order-app dev:demo
pnpm --filter @uvp-eth/order-app typecheck
pnpm --filter @uvp-eth/order-app build
pnpm --filter @uvp-eth/order-app test
pnpm --filter @uvp-eth/order-app test:e2e
```

`dev` requires a real Product API base URL through
`VITE_UVP_CHAIN_SERVICES_URL` or `VITE_PRODUCT_API_BASE_URL`. `dev:demo` sets
`VITE_UVP_ORDER_APP_DEMO=1` and uses checked-in
`@uvp-eth/product-dto/fixtures` data for local UI verification only.

## Productization Plan

`uvp-order-app` is the browser console for human review and manual operator
fallback. Executor-kit remains the CLI/SDK/MCP integration surface; both consume
the same Product API prepare/submit and proof projections.

Current signal-console surfaces:

- task inbox and detail show the executing wallet, authorization copy, supplier
  backing, required inputs/evidence, and proof status;
- evidence submission shows required files, selected evidence fingerprints,
  signing wallet preflight, and fail-closed blockers;
- proof views show transaction/proof rows and payload/evidence fingerprints
  without exposing business document plaintext;
- full mode requires a real Product API and must not fabricate orders.

Planned PRDs:

- `docs/product/prd-63-uvp-order-app-boundary-and-extraction.md`: app boundary,
  extraction path, and source-of-truth rules.
- `docs/product/prd-64-order-app-participant-onboarding.md`: invite, wallet,
  role binding, and account recovery.
- `docs/product/prd-65-order-app-task-inbox-and-plugin-runtime.md`: participant
  inbox, order room, and task plugin runtime.
- `docs/product/prd-66-order-app-evidence-and-proof-experience.md`: evidence
  capture, submission, redaction, and proof UX.
- `docs/product/prd-67-order-app-collaboration-notifications-sla.md`:
  collaboration, reminders, notifications, and deadline handling.
- `docs/product/prd-68-order-app-production-readiness-gate.md`: production
  quality bar, E2E, deployment, accessibility, and observability.
- `docs/product/prd-98-order-app-signal-console.md`: human/operator signal
  console positioning, signal-container display, and negative states.

PRD63 implements the initial runnable boundary. Later PRDs should add invite
onboarding, task plugin runtime, evidence capture, notifications, and production
readiness without moving Store Console ownership back into this package.
