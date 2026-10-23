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

- `VITE_UVP_CHAIN_SERVICES_URL`: Product API 地址（必填，缺失时启动即报错）。
- `VITE_UVP_ORDER_APP_WALLET_ADDRESS`: 参与者钱包过滤条件。

未配置 `VITE_UVP_CHAIN_SERVICES_URL` 时启动即报错，错误信息包含该变量名；应用只显示未配置错误提示，不生成任务或证明。

## 装修数据（reader 装修页与任务证据要求）

- Reader 装修页入口：`/?decoration=<zhixuId>`（只读，不需要钱包会话；链接可分享、刷新可重开）。页面用产业语言渲染 theme（展示名/描述/标签/亮点）、参与方与责任、阶段与材料要求。
- 数据来源：`GET /product/zhixus/<zhixuId>`（秩序详情，公共读）+ `GET /store/decoration/<planId>`（Store 装修数据，取 `zhixu.planPublication.planId`）。装修是 Store 数据域的可删除投影，不是链上事实；取不到时页面显式提示，不冒充"没有装修数据"。
- 任务证据要求：任务投影自带 `evidenceSpec` 时以投影为准；缺失时按 `taskId`（精确）→ `stageId` 用装修 `taskDeclarations` 补位，任务详情标注"材料要求来自秩序装修数据"。
- 执行者选择：任务投影带 `selectableTargets` 时走既有 stage executor patch 流程；缺失但秩序阶段声明了 `selectedStageTargets`（DSL `selectedStages`）时，按秩序详情派生目标阶段入口。界面不引入"静态/动态执行者"概念。

## 通用任务动作

Order App 支持 Signal 提交、stage executor patch、stage resource patch 和 Store 编写的 participant add-on manifest。Manifest 描述表单与按钮，不能授予链上权限。

普通界面使用待办、提交确认、证据、证明、履约者和执行方等产品语言；协议标识放在高级证明视图。
