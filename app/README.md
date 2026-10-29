# UVP Order App（链上直连 demo B）

浏览器里的订单控制台：连接注入式钱包（EIP-1193），粘贴/载入 used-car 编译器产出的
plan artifact，钱包签 `commitPlan` + `finalizePlan` 注册计划，再签
`triggerOrderFromOutsideFor` 出生订单（钱包 = publisher = birthAuthorizer），随后读
链上订单事实/事件、发信号。没有 backend、会话 token、草稿、邀请、配置目录或任务收件箱。

## 责任边界

- **浏览器不编译 DSL**：compiler（`zhixu-loader` 依赖 `node:fs`）不在浏览器运行；
  artifact 由 used-car 的编译/发布脚本在 Node 侧产出后手填（`definition` 只作 bundle
  形状的一部分，不参与浏览器计算）。
- 计划注册的 typed data/calldata 与出生 trigger 的 typed data/calldata 由
  `@uvp-eth/uvp-client/core` 构造；本 app 不复制 ABI/typehash/编码。
- 签名全部由钱包产生（`eth_signTypedData_v4` / `eth_sendTransaction`）；app 不接触私钥。
- 出生提交人 = birthAuthorizer = 当前钱包；creator 缺省为当前钱包，可改。
- 出生时把 artifact 声明的全部事实键授权给当前钱包（role/metadataHash 置零，仅 demo
  引导；不是协议角色）。信号提交仍以链上授权为准，未授权时显示链上
  `UnauthorizedSignalSubmitter` 回滚。
- 链上事实以 `UVPStateMachine` 为准：读取失败、空事件、链上回滚三者分开呈现，app 不
  在本地推进/补偿业务状态，也不预检 hook/阶段是否该放行。
- 注册完成后校验 `planExists(artifact.planId)`；为 false 时按 `plan_id_mismatch` 失败，
  避免用别的 publisher 的 artifact 出生。

## 运行

```bash
pnpm --filter @uvp-eth/order-app dev
pnpm --filter @uvp-eth/order-app typecheck
pnpm --filter @uvp-eth/order-app test
pnpm --filter @uvp-eth/order-app build
```

## 环境变量

- `VITE_UVP_STATE_MACHINE`（必填）：UVPStateMachine 地址。
- `VITE_CHAIN_ID`（必填）：链 ID；钱包网络不一致时连接失败具名。
- `VITE_RPC_URL`（必填）：只读 RPC（读事实/事件、交易预检）。
- `VITE_UVP_FROM_BLOCK`（可选，缺省 0）：事件扫描起点。

见 `.env.example`。

## artifact 形状

used-car 编译器/发布脚本产出的 bundle 顶层四字段：

```json
{
  "definition": { "apiVersion": "…", "kind": "…", "metadata": { }, "spec": { } },
  "onchain": { "planId": "0x…", "compiledHooks": [], "signalCapabilities": [], "selectorBindings": [] },
  "registerArgs": { "planHash": "0x…", "hooksHash": "0x…", "capabilitiesRoot": "0x…", "hooks": [], "executorCandidates": [] },
  "planId": "0x…"
}
```

浏览器只用 `onchain.compiledHooks`（选 mint 出生 trigger 与 positive 依赖）、
`onchain.signalCapabilities`/`selectorBindings`（出生 attribution 与事实键授权）和
`registerArgs`（注册 calldata），以及 `planId`。artifact 必须按当前钱包地址作为
publisher 编译/发布；否则注册后 `planExists(artifact.planId)` 为 false，会具名失败。

## 流程

1. 连接钱包；链 ID 与 `VITE_CHAIN_ID` 不一致会拒绝。
2. 粘贴/载入 artifact → 解析（坏 JSON/坏形状/坏 planId/缺 trigger/多义 trigger 具名失败）。
3. 注册：钱包签 `commitPlan`（publisher = birthAuthorizer = 当前钱包，deadline = 链上
   时间 + 1 小时）→ 发送 → 发送 `finalizePlan` → 读 `planExists`。
4. 出生：填 creator/payloadHash/idempotencyKey → 钱包签出生 typed data → 发送
   `triggerOrderFromOutsideFor` → 显示推导 orderId 并自动读取事实。
5. 读取订单事实/事件（按 planId + orderId 过滤，fromBlock 可配）。
6. 发信号：钱包直发 `submitSignal`；attribution 留空且 planId 等于已解析 artifact 时，按
   artifact 能力表自动补 proof（显式填写的 attribution 优先）。

## 目录

- `src/App.tsx`：唯一外壳（artifact、注册、出生、事实/事件读取、发信号面板）。
- `src/chain/config.ts`：环境变量校验与缺/坏配置问题码。
- `src/chain/client.ts`：公共 RPC 只读、钱包连接、EIP-712 签名、交易预检/发送/回执。
- `src/chain/plan.ts`：artifact 解析、出生 trigger 选择、commit/出生 typed data/calldata
  （构造单源是 `@uvp-eth/uvp-client/core`）。
- `src/chain/input.ts`：发信号输入校验与 `buildSubmitStateMachineSignalCall`。
- `src/chain/events.ts` / `abi.ts`：事实事件解码与最小只读 ABI。
- `src/app/ErrorBoundary.tsx`：渲染错误如实呈现、不自动重试。

## 测试

`pnpm --filter @uvp-eth/order-app test` 跑 `src/**/*.test.ts`：发信号输入/钱包错误映射，
以及 artifact 解析的具名失败、出生 trigger 选择、出生准备（capability attribution 与
授权去重）。

Playwright e2e 已删除：旧 spec 断言的是已移除的 backend 流程文案（必然红）；有意义的
e2e 需要 live chain + 已部署 state machine + 已发布 artifact + 注入钱包，属 L6
integration/live-chain 面，不是本 L5 app 的测试层；静态文案快照属于回声测试，不补。
