# uvp-order-app

Chain-direct browser console for UVP Orders (demo B). The runnable package is `app/`.

Flow: connect an injected EIP-1193 wallet → paste or load a hand-filled compiled
plan artifact `{definition, onchain, registerArgs, planId}` produced by the
used-car compiler/publish scripts → the wallet signs `commitPlan` and
`finalizePlan` → the wallet directly sends `submitSignal` with `orderId=0` to
create the order (the state machine generates the order id, read from the
receipt event) → read order facts/events from the state machine → submit a
signal.

There is no backend, session token, draft, invite, config directory, or task
inbox. The compiler is not browser-safe (`zhixu-loader` depends on `node:fs`), so
the browser never compiles DSL: the artifact is compiled outside and pasted/loaded.
Typed-data and calldata come from `@uvp-eth/uvp-client/core`; chain facts stay on
`UVPStateMachine`. Signal authority is resolved on chain through the single
`UVPIdentityRegistry` supplier capability namespace; this app holds no registry
state and no second identity registry.

```bash
pnpm --filter @uvp-eth/order-app dev
pnpm --filter @uvp-eth/order-app typecheck
pnpm --filter @uvp-eth/order-app test
pnpm --filter @uvp-eth/order-app build
```

Required env: `VITE_UVP_STATE_MACHINE`, `VITE_CHAIN_ID`, `VITE_RPC_URL`;
optional `VITE_UVP_FROM_BLOCK`. See `app/.env.example`.

The artifact must be compiled/published for the connected wallet as publisher;
after finalize the app reads `planExists(artifact.planId)` and fails named
(`plan_id_mismatch`) when the artifact belongs to another publisher.

Playwright e2e was removed: the old specs asserted copy from the deleted backend
flow (already red), and a meaningful replacement needs a live chain, a deployed
state machine, a published artifact, and an injected wallet — L6
integration/live-chain territory, not this L5 app. Static-copy browser specs are
echo tests and are not reintroduced. See `app/README.md`.
