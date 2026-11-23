// order-app e2e 不在本 L5 包内：旧 Playwright spec 断言已移除的 backend 流程，
// 有意义的 e2e 需要 live chain + artifact + 注入钱包（L6）。保留显式失败入口，
// 防止 `pnpm --filter @uvp-eth/order-app test:e2e` 因脚本缺失而 0 退出（假绿）。

console.error(
  "order-app e2e is not implemented in this package: the deleted Playwright suite cannot be reported as green. " +
    "The L6 integration lane must provide a live-chain browser e2e (or remove its e2e step) before this command can pass."
);
process.exit(1);
