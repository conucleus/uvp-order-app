# UVP Order App

Order App 是参与者处理 Order 待办的浏览器入口。它从 Product API 读取分配给当前钱包的任务、证据要求、签名材料、提交状态和链上证明。

## 责任边界

- Task 可见性来自 Product 投影。
- 提交权来自 Order 级 Signal 授权和当前 executor overlay。
- 业务签名由参与者钱包产生；服务端可以代付 gas，但不能代造业务授权。
- Supplier 能力和匹配属于 Store metadata，不影响提交权。
- Plan 发布、Order 和 Signal 事实来自 `UVPStateMachine`。

## 运行

```bash
pnpm --filter @uvp-eth/order-app dev
pnpm --filter @uvp-eth/order-app typecheck
pnpm --filter @uvp-eth/order-app build
pnpm --filter @uvp-eth/order-app test
pnpm --filter @uvp-eth/order-app test:e2e
```

当前环境变量：

- `VITE_UVP_CHAIN_SERVICES_URL`: Product API 地址。
- `VITE_UVP_ORDER_APP_DEMO=1`: 本地演示数据开关。
- `VITE_UVP_ORDER_APP_WALLET_ADDRESS`: 参与者钱包过滤条件。

没有 Product API 且未启用演示模式时，应用显示空壳和服务缺失提示，不生成任务或证明。

## 通用任务动作

Order App 支持 Signal 提交、stage executor patch、stage resource patch 和 Store 编写的 participant add-on manifest。Manifest 描述表单与按钮，不能授予链上权限。

普通界面使用待办、提交确认、证据、证明、履约者和执行方等产品语言；协议标识放在高级证明视图。
