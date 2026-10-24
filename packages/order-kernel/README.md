# @uvp-eth/order-kernel

通用 headless 订单内核（public 包）。只放可跨宿主复用的能力：

- Product API transport 与传输 DTO 类型（订单、任务、证据、要求包、邀请、开单草稿、装修读面）；
- StageEscrow 读模型、配置解析、ABI、动作构造/提交、双签分配、revert 解码；
- 参与者会话的纯读模型；
- EIP-1193 provider / EIP-712 签名类型与钱包错误类型。

不含 React 组件、CSS、路由、页面，也不含行业/宿主专用文案。构建期 env 与
浏览器 `localStorage` 由宿主通过参数注入；kernel 本身不读 `import.meta.env`。

## 出口

```ts
import {
  createProductApiClient,
  type ProductApiClient,
  type ProductApiClientOptions
} from "@uvp-eth/order-kernel/product";

import {
  resolveEscrowConfig,
  parseOrderEscrowList,
  buildStageEscrowCall
} from "@uvp-eth/order-kernel/escrow";

import { readParticipantSession } from "@uvp-eth/order-kernel/session/participant";
import type { Eip1193Provider } from "@uvp-eth/order-kernel/wallet/provider";
```

`exports` 同时提供根入口 `@uvp-eth/order-kernel` 和上述子路径。
