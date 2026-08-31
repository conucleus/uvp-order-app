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
