# UVP Order App

参与者处理订单的浏览器工作台。只有一个流程：钱包会话 → 开单（配置版本 → 草稿 →
邀请 → 本人 EIP-712 确认）→ 邀请接受 → 订单房间读面。客户端能力来自
`@uvp-eth/uvp-client/browser`；本仓不再保留任务收件箱、要求包、注册、通知、
装修或证明等第二套界面。

## 责任边界

- 开单只提交配置版本、金额、期限与验收标准；订单复用配置版本已发布的 plan。
- 邀请是一次性 token 链接（`?invite=&inviteToken=`），token 只在页面内存与链接中，
  不写入 hash 导航。
- 业务签名由参与者钱包产生；app 只做域/条款核对与钱包调用，不接触私钥。
- 订单/阶段/任务/句柄读面由服务端按 `(order, stage, slot, wallet)` scope 裁剪；
  读不到就是读不到，不伪造空结果。
- 链上事实以 `UVPStateMachine` 为准；app 不推进业务状态。

## 运行

```bash
pnpm --filter @uvp-eth/order-app dev
pnpm --filter @uvp-eth/order-app typecheck
pnpm --filter @uvp-eth/order-app test
pnpm --filter @uvp-eth/order-app build
pnpm --filter @uvp-eth/order-app test:e2e
pnpm --filter @uvp-eth/order-app test:e2e:configured
```

主流程 e2e 只有两个 profile：`fail-closed`（未配置参与者服务，默认）与
`configured`（指向假服务地址，渲染登录门与工作台外壳）。两者都不启动真实后端。

## 环境变量

- `VITE_UVP_CHAIN_SERVICES_URL`（必填）：参与者服务地址；缺失时外壳 fail-closed，
  不渲染开单、邀请或订单房间。
- `VITE_UVP_CONFIG_ID` / `VITE_UVP_CONFIG_VERSION`（可选）：开单页预填的默认配置
  版本；服务端没有配置目录接口，只能按 `configId + version` 读取。

见 `.env.example`。

## 钱包会话（已知缺口）

当前会话 transport 是 app 自有的 `/store/auth/challenge` → `personal_sign` →
`/store/auth/verify`，token 保存在浏览器 `localStorage`（`uvp-order-app:wallet-session`）。
服务端尚未提供 generic participant-session 契约；契约落地后替换 `src/session/` 的
transport，调用面（`currentSessionToken` / `proveWalletControl`）不变。

## 目录

- `src/App.tsx`：唯一工作台外壳（会话门 + 开单/订单房间路由 + 邀请入口）。
- `src/kernel/`：开单、邀请接受、订单房间页面与 transport 端口（DTO 单源仍是
  `@uvp-eth/product-dto`，签名类型单源是 `@uvp-eth/protocol-bindings`）。
- `src/session/`：钱包会话 transport 与 token 存储。
- `src/routes/`：hash 路由与邀请查询参数。
