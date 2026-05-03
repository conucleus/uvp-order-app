# AGENTS.md

## Module Purpose

`uvp-order-app/app` is the ordinary participant app for running UVP orders. It
serves buyers, suppliers, logistics actors, customs/document actors,
inspectors, executors, adjudicators, and invited participants.

## Boundaries

- Keep the first screen participant-oriented; it should open to `我的待办`, not a
  Store Console, catalog, or escrow demo.
- Consume Product DTOs from `@uvp-eth/product-dto` and Product API routes through
  `src/api/productApi.ts`.
- Do not import `zhixu-store/app` code or move Store Console controls here.
- Do not make this app authoritative for order, task, evidence, payment,
  approval, release, refund, dispute, attestation, or proof state.
- Do not add payment-provider, custody, exchange, settlement-rail, escrow
  release, refund, or token-transfer controls.
- Do not store contract, invoice, logistics, vehicle, or other business evidence
  plaintext on chain. UI copy should explain hashes/proofs without exposing
  protocol internals to ordinary participants.
- Do not let relayers or browser code create business signatures. Participant
  submissions must be signed by the authorized wallet.

## Local Development

- Use `pnpm --filter @uvp-eth/order-app dev` for a real Product API.
- Use `pnpm --filter @uvp-eth/order-app dev:demo` only for explicit local demo
  fixtures.
- Keep missing API states visible; do not silently fall back to demo data.
- Keep tests focused on participant shell behavior and the Product API boundary.
- Production-like readiness must fail closed: no Product API base URL and no
  explicit demo flag means no mock orders, no demo submit controls, and no
  business action fallback.
- Browser readiness summaries for this app must identify `uvp-order-app`
  separately from Store Console.
