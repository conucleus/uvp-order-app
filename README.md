# uvp-order-app

Browser participant console for UVP Orders. The runnable package is `app/`.

The app has one flow: wallet session → create order (config version → draft →
invites → buyer EIP-712 finalize) → invite acceptance → order-room read view.
Product access and typed-data verification come from
`@uvp-eth/uvp-client/browser`; chain facts stay with `UVPStateMachine`.

```bash
pnpm --filter @uvp-eth/order-app dev
pnpm --filter @uvp-eth/order-app typecheck
pnpm --filter @uvp-eth/order-app test
pnpm --filter @uvp-eth/order-app test:e2e
pnpm --filter @uvp-eth/order-app test:e2e:configured
pnpm --filter @uvp-eth/order-app build
```

Set `VITE_UVP_CHAIN_SERVICES_URL` for the participant service. Without it the
shell renders fail-closed and shows no order views. Optional
`VITE_UVP_CONFIG_ID` / `VITE_UVP_CONFIG_VERSION` prefill the order form; the
server has no config directory endpoint, so the version is always read by
`configId + version`.

Wallet session currently uses the app-owned `/store/auth/challenge|verify`
transport (token kept in `localStorage`); the server-side generic participant
session contract is still a gap. See `app/README.md` and `app/.env.example`.
