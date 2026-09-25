# uvp-order-app

Browser participant console for UVP Orders. The runnable package is `app/`.

It displays wallet-assigned tasks, evidence requirements, typed-data preparation, submission status and proof from the Product API. Supplier capability data may be shown as Store context, while Order-level authorization and executor constraints decide whether a wallet can act.

```bash
pnpm --filter @uvp-eth/order-app dev
pnpm --filter @uvp-eth/order-app typecheck
pnpm --filter @uvp-eth/order-app test
pnpm --filter @uvp-eth/order-app test:e2e
```

Set `VITE_UVP_CHAIN_SERVICES_URL` for the current Product API. The app only talks to the real Product API; without it the shell renders fail-closed with no tasks or proofs.

Main build-time environment variables (Vite inlines them into the bundle; runtime env changes have no effect):

- `VITE_UVP_CHAIN_SERVICES_URL`: Product API base URL; without it the shell renders fail-closed.
- `VITE_UVP_STATE_MACHINE_ADDRESS`: expected `UVPStateMachine` address for task-submit signature domain checks; missing or malformed values refuse the wallet signature (fail-closed). One address is pinned per build, so rotating the state-machine deployment requires rebuilding the app.
- `VITE_UVP_STAGE_PATCH_MODULE_ADDRESS`: expected `UVPStagePatchModule` address for stage-patch (executor/resource patch) signature domain checks — the patch domain is verified by the patch module, not the state machine; missing or malformed values refuse the signature (fail-closed). Same build-time pinning as the state-machine address.

See `app/.env.example` for the full list and defaults.
