# @uvp-eth/order-app

Human/operator signal console for UVP orders.

The first screen opens to `我的待办` and shows assigned signal containers as
ordinary work items: who is expected to submit, which wallet must sign, what
inputs/evidence are required, whether supplier backing is present, and what
proof or fingerprint exists. It is intentionally separate from Store Console and
does not include the removed escrow demo.

Public status: prototype participant app. It demonstrates the human signal
console and wallet-bound Product API flow, but it is not a production operations
console or audited wallet product.

PRD109 is the repo-split convergence gate for this app. The participant UI
should consume Product DTO stage executor authority, resource requirements,
docked Zhixu runtime projections, proof summaries, and signal-container actions without
adding business-specific branches. Prototype/open surfaces must stay labeled as
not runtime-complete.

## Scripts

```bash
pnpm --filter @uvp-eth/order-app dev
pnpm --filter @uvp-eth/order-app dev:demo
pnpm --filter @uvp-eth/order-app typecheck
pnpm --filter @uvp-eth/order-app build
pnpm --filter @uvp-eth/order-app test
pnpm --filter @uvp-eth/order-app test:full-mode-gate
pnpm --filter @uvp-eth/order-app test:e2e
pnpm --filter @uvp-eth/order-app test:e2e:full
pnpm --filter @uvp-eth/order-app test:e2e:readiness
pnpm --filter @uvp-eth/order-app readiness
uvp-deploy/deploy/scripts/order-app-browser-e2e.sh --mode fixture
```

## Runtime Configuration

- `VITE_UVP_CHAIN_SERVICES_URL` or `VITE_PRODUCT_API_BASE_URL`: real Product API
  base URL.
- `UVP_ORDER_APP_E2E_PROFILE=full`: full staging participant gate. It also
  requires `VITE_PRODUCT_API_BASE_URL` or `VITE_UVP_CHAIN_SERVICES_URL` and
  `UVP_ORDER_APP_FULL_FLOW_SUMMARY` or
  `UVP_ORDER_APP_BROWSER_E2E_FLOW_SUMMARY`.
- `VITE_UVP_ORDER_APP_DEMO=1`: explicit local demo mode using
  `@uvp-eth/product-dto/fixtures`.
- `VITE_UVP_ORDER_APP_WALLET_ADDRESS`: optional participant wallet filter for
  `/product/me*` calls.
- Non-production wallet switch: in `local`, `development`, `test`, `testnet`,
  `base-sepolia`, or `anvil` runtime profiles, `?participantWallet=0x...`
  stores a session-only wallet override under
  `uvp-order-app:participant-wallet-override`. This only changes the Product
  API participant wallet filter for E2E/testnet rehearsals; it does not create
  demo tasks, fake signatures, or fake API responses. Production/staging
  profiles ignore this override.
- `VITE_UVP_ORDER_APP_EVIDENCE_ROUTE_MODE=chain-services-compat`: temporary
  local compatibility mode for chain-services' current `/product/evidence`
  routes. The PRD63 boundary remains `/evidence`.

When no Product API base URL is configured and demo mode is not enabled, the app
shows an empty participant shell with an explicit service-missing banner. It
does not silently fabricate production orders.

Demo evidence, demo proof, participant wallet overrides, and chain-services
compatibility evidence routes are local-only adapters. They must remain visibly
labeled and disabled for production-like runtime profiles.

## Signal Console Scope

This package owns the browser path for human review and operator-supervised
wallet submission. Executor-kit owns the CLI/SDK/MCP path. Both use the same
Product API prepare/submit boundary and proof projection.

User-facing copy should say `待办`, `提交确认`, `凭证指纹`, `证明`, `履约者`,
`执行方`, and `供应商背书`. Avoid exposing HookReady, source IDs, signal IDs,
ABI, calldata, gas, or custody/release language in ordinary screens.

## Production Readiness Gate

`pnpm --filter @uvp-eth/order-app readiness` runs typecheck, build, unit tests,
browser API-stub negative tests, mobile smoke, and production-like fail-closed
checks.

Current browser readiness coverage:

- explicit local demo smoke and evidence/proof checks through `test:e2e`;
- Product API stub negative paths for missing evidence, wrong wallet, rejected
  signature, indexer lag, and revoked supplier trust warning;
- signal-container display for executing wallet, supplier backing, required
  inputs/evidence, payload fingerprint, and proof context;
- mobile viewport smoke for task cards, task details, and the proof drawer;
- fail-closed runtime with no API base URL and no demo mode, proving demo/mock
  controls stay unavailable.

`uvp-deploy/deploy/scripts/order-app-browser-e2e.sh` writes an Order App summary
under `logs/order-app-browser-e2e/` and intentionally marks Store Console as not
executed. `--mode full --require-full` is a fail-closed release gate: it refuses
to run without a Product API URL and chain-backed flow summary, rejects
`product-api.test`/stub/demo URLs, blocks `VITE_UVP_ORDER_APP_DEMO=1`, and the
full spec rejects summaries that do not prove required chain transactions.

## Product API Boundary

The client boundary is in `src/api/productApi.ts` and is typed against Product
DTOs from `@uvp-eth/product-dto` for participant profile, orders, tasks, and
proof rows.

Participant add-ons support two rendering modes. If a task includes
`addOnManifest`, the app renders the Store-authored declarative page and maps
manifest actions to the Product API. If no manifest is present, it falls back to
the built-in executor action UI for signal submission, stage executor patches,
and stage resource patches.
The manifest can describe fields and buttons, but it cannot grant authority:
wallet signatures, order permissions, and chain contracts still decide whether
an action is accepted.

For Phase 2 manifests, stage executor patch actions prepare
`stage_executor_patch` with
`selectorWallet`, `targetStageId`, `executorWallet`, `executorMetadataHash`, and
`metadataURI`; `executorReference` may be displayed but never replaces the hash.
Stage resource patch actions prepare `stage_resource_patch` with `selectorWallet`,
`targetStageId`, `resourceKey`, `manifestURI`, `manifestHash`, and `policyHash`
only. Resource visibility stays inside the off-chain resource manifest.

Implemented route boundary:

```text
GET  /product/me
GET  /product/me/orders
GET  /product/me/tasks
GET  /product/me/tasks/:taskId
GET  /product/orders/:orderId
POST /product/invites/:inviteId/accept
POST /product/tasks/:taskId/prepare-submit
POST /product/tasks/:taskId/submit
POST /product/tasks/:taskId/prepare-stage-executor-patch
POST /product/tasks/:taskId/submit-stage-executor-patch
POST /product/tasks/:taskId/prepare-stage-resource-patch
POST /product/tasks/:taskId/submit-stage-resource-patch
POST /evidence
GET  /evidence/:evidenceId/proof
```

The evidence routes are the PRD63 target. Existing chain-services compatibility
can be enabled for local migration only through
`VITE_UVP_ORDER_APP_EVIDENCE_ROUTE_MODE=chain-services-compat`.
