# registration 模块（rough）

order app 的最小注册模块：实体注册表单、钱包归属签名证明、身份背书事实展示。
本目录之外的文件（含 `App.tsx`）由 Lead 接线时修改；本模块只导出
`RegistrationPage` 与类型化 client。

## 1. 交付物

| 文件 | 内容 |
| --- | --- |
| `RegistrationPage.tsx` | `RegistrationPage`：实体注册表单（企业名称/注册号/联系人，写路径未就绪时显式不可提交）、钱包归属签名证明、身份背书事实展示 |
| `client.ts` | `RegistrationClient` / `createRegistrationClient`：身份背书与登记档案只读 + 钱包会话地址锚定写；`RegistrationApiError` 错误分类 |
| `types.ts` | 服务端响应 DTO 的只读镜像（形态单源在 chain-services，见 §2） |
| `blockers.ts` | 实体注册写路径缺失的精确 blocker（页面展示与本文共用的单一事实源） |
| `form.ts` | 表单本地校验（只做必填与长度上限；无服务端格式契约可依） |
| `registration.css` | 本页样式（复用 app 的 CSS token 与通用按钮/横幅类） |
| `index.ts` | 对外导出 |

## 2. 已接的数据通路（复用现有 API）

服务端真身全部在 `uvp-chain-services/service/src/`：

### 2.1 身份背书 / 登记档案（公开只读，无需会话）

| 调用 | 路由 | 服务端单源 |
| --- | --- | --- |
| `client.loadIdentityBindings({ account, activeOnly:false })` | `GET /identity/bindings?account=<0x…>&activeOnly=false` | `api/routes/governance.ts:117-163`（投影类型 `indexer/identity-projections.ts:20-55`，过滤 `:103-128`） |
| `client.loadIdentityDescriptor(subjectId, descriptorHash)` | `GET /identity/descriptors/:subjectId/:descriptorHash` | `api/routes/governance.ts:122-150`；DTO/哈希重算 `governance/descriptors.ts:188-214` |

注意：`activeOnly=false` 是必需的——字符串 `"false"` 在路由层已收敛为 boolean，
撤销记录才会返回（`api/routes/governance.ts:168-196`）。

### 2.2 钱包会话与地址锚定（写；复用 order app 现有 SIWE 会话）

钱包登录本身不重写：`ProductApiClient.proveWalletControl`（`app/src/api/productApi.ts:551-581`，
challenge → personal_sign → `/store/auth/verify`，并把 token 持久化到
`uvp-order-app:wallet-session`，`:395-415`）。页面通过 `wallet` prop 注入现有
`OrderAppActions`（`proveWalletControl/requestWalletAddress/hasInjectedWallet`），通过
`session` prop 注入 `currentSessionToken` 取值器。

地址归属绑定（把地址记入当前会话账号，支持多地址）走同一会话：

| 调用 | 路由 | 服务端单源 |
| --- | --- | --- |
| `client.loadAccountAddresses()` | `GET /store/auth/addresses`（`x-uvp-store-session`） | `api/routes/store-auth.ts:66-77`；`store/sessions/service.ts:331-334` |
| `client.bindWalletAddress({ address })` | `POST /store/auth/challenge` `{address,intent:"anchor_address"}` → personal_sign → `POST /store/auth/verify` `{nonce,signature}`（两次均带 `x-uvp-store-session`） | `api/routes/store-auth.ts:28-55`；intent 校验与账号一致性 `store/sessions/service.ts:104-111, 223-281` |

`bindWalletAddress` 不持久化 verify 新签发的 session token：账号级锚定已落在
服务端，order app 继续用原有参与者会话（新会话行按 TTL 自然过期）。撤销地址的
接口 `POST /store/auth/addresses/revoke`（`store-auth.ts:79-90`）存在，本 rough
版本未做 UI。

CORS 侧 `x-uvp-store-session` 在服务端 allow-headers 白名单内
（`service/src/api/server.ts:636`）；跨源部署仍需 `UVP_API_CORS_ALLOWED_ORIGINS`
精确配置（`:618-626`）。

## 3. 实体注册：精确 blocker（没有可用写路径）

**blocker 单源：`src/registration/blockers.ts`（`entityRegistrationBlocker`）。**
页面提交按钮不发送任何请求，只显示该事实；不存在"假成功"实现。

已核对并排除的候选写路径：

1. **公开身份路由只有读**。`/identity/bindings`、`/identity/descriptors/…`
   都是 GET 投影/快照（`api/routes/governance.ts:117-166`），没有 POST/PUT。
2. **治理登记写只属于治理管理员，且要求已存在的审核记录**。
   `POST /admin/governance/register-identity`（`api/routes/governance.ts:84-89`）
   先经 `adminPrincipalFromHeaders` 门禁（`:38-44`），服务层再断言
   `GOVERNANCE_ADMIN_ROLES`（`governance/service.ts:140-141`）；没有供应商审核记录
   直接 409 `review_not_approved`（`:145-164`）。descriptor 由审核记录构建
   （`:167-173`），不接受请求体里的企业名称/注册号/联系人。
3. **供应商身份登记写属于 Store 运营面**。
   `POST /store/suppliers/:id/request-identity-registration`
   （`api/routes/store-suppliers.ts:143, 217-230`）需要
   `store.supplier.identity.register` 能力（`:328-338`）、会话已锚定（`:183-187`）、
   确认字段（`:341-362`），且 supplier 记录必须已存在。
4. **加入闭环不是实体注册**。`POST /store/join-applications`
   （`api/routes/store-join.ts:22-31`）提交的是订单范围内的角色授权申请
   （`store/join/types.ts:18-24, 41-62`：planId/roleSlotId/authorizationKind/
   applicantSubjectId…），字段与实体注册无关，且要求锚定 Store 会话。
5. **链上注册表没有自助写入**。`UVPIdentityRegistry.registerIdentityBinding`
   是 `onlyOwner`（`uvp-protocol/contracts/uvp-contracts/src/UVPIdentityRegistry.sol:67-72`），
   registrar = 治理服务签名地址；钱包只能签名证明地址控制权，不能自行登记绑定。
6. **Order App 消费的 Product API 没有注册/身份写路由**。`/product/*` 路由只做
   参与者身份解析与订单/任务/证据/邀请（`api/routes/product-read.ts`、
   `api/routes/product-bff.ts`），grep 无注册写入端点。
7. **全仓没有任何地方接受这三个字段**。在 uvp-eth 源码内检索
   `registrationNumber|businessLicense|legalName|contactName|companyName|统一社会信用代码`
   （排除 node_modules/dist/out 与本模块）无命中；产品语义侧明确"注册/实名/钱包 →
   A 就绪后切 A"（`/Users/uyhendu/project/used-car/docs/order-app-split-and-functions.md` §1 职责矩阵、
   §2.1），A 层接口目前只读（`/Users/uyhendu/project/used-car/docs/store-ab-layer.md` §4），
   实体注册属订单 app 基座范围（`/Users/uyhendu/project/used-car/docs/order-app-base-components.md` §2.1）。

**解除条件**（`entityRegistrationBlocker.unblockCondition`）：A 层或 Chain Services
提供参与者可用的实体注册/实名核验写接口（包含三字段的服务端契约）后，表单提交
按该接口接线；在此之前保持显式不可用。

> 如果只把"注册表单"接到某个 Store 运营接口，会把参与者注册伪装成治理动作
> （需要管理员身份/审核记录），本模块不这么做。

## 4. 身份事实展示口径

- 只展示服务端返回的事实：背书状态（`背书有效` / `背书已撤销`）、身份主体
  （subjectId）、背书钱包、登记方、登记指针、链上来源与证明字段、登记档案原文
  与哈希重算结果。页面不给"可信/已认证/风险低"之类评价。
- "没有记录"与"读取失败"分开：只有请求成功且 `bindings` 为空才显示"该地址当前
  没有身份背书"；失败显示错误与重试，并明确"读取失败不等于没有记录"。
- 链语言（交易哈希/区块/合约地址/档案 URI）收在每条的 `链上来源与证明字段`
  折叠层；页面主视野用产品语言（背书有效/已撤销、登记方、身份主体）。
- 登记档案快照只在用户展开时按 `descriptorHash` 拉取，并原样展示档案原文；
  哈希重算一致/不一致是机械事实，不是可信评价。

## 5. 接线（Lead）

```tsx
import { RegistrationPage } from "./registration";

// api 来自 createProductApiClient（现有 ProductApiClient）
// actions 来自 createOrderAppActions(api)（现有 OrderAppActions，结构兼容）
<RegistrationPage
  session={{ currentSessionToken: () => api.currentSessionToken() }}
  wallet={actions}
  initialAddress={session.walletAddress}
  onBack={() => { /* 回到待办 */ }}
/>
```

- `client` prop 可整体替换（测试或复用宿主 client）。
- `session` 未注入时，页面仍可查询公开身份背书事实；钱包地址清单与地址绑定会
  显式显示"需要钱包会话"。
- 环境变量：`VITE_UVP_CHAIN_SERVICES_URL`（与 app 其余部分同一变量；缺失时
  `createRegistrationClient` 抛错，页面显示"参与者服务未配置"，不回退假数据）。

## 6. 验证（2026-10-23，本模块交付时实测）

命令均在 `/Users/uyhendu/project/uvp-eth/uvp-order-app/app` 下执行（未跑 git）：

```bash
cd /Users/uyhendu/project/uvp-eth/uvp-order-app/app

# 1) 全仓 typecheck（包含本模块全部 .ts/.tsx）
pnpm typecheck
# => exit 0

# 2) 全仓 build（tsc --noEmit + vite build）
pnpm build
# => exit 0；vite: 2197 modules transformed，dist 产物生成成功

# 3) 本模块独立严格类型检查（隔离并行改动的影响；与 app tsconfig 同严格度）
./node_modules/.bin/tsc --noEmit --strict --exactOptionalPropertyTypes \
  --noUncheckedIndexedAccess --jsx react-jsx --module esnext \
  --moduleResolution bundler --target ES2022 --lib ES2022,DOM,DOM.Iterable \
  --skipLibCheck --types vite/client,node src/registration/index.ts
# => exit 0

# 4) 本模块 JSX/CSS 打包检查（App.tsx 尚未接线，vite build 不包含本页）
#    在 src/registration/ 内以 esbuild 打包 index.ts 的完整导入图 => 成功

# 5) 现有单测回归（未新增测试）
pnpm test
# => 155 tests / 31 suites，pass 155，fail 0
```

说明：
- 验证期间有并行队友在改 `App.tsx`、`e2e/product-api-stub.ts` 等本模块范围外的
  文件；首次全仓 typecheck 曾因其瞬时类型错误失败（与本模块无关），其落定后
  重跑通过。
- `vite build` 目前不含本页（`App.tsx` 未接线），故另做第 4 项模块级打包检查。
- 未新增单测：理由见 §7。

## 7. Rough 边界（已知，不假称完成）

- **实体注册提交不可用**：原因与解除条件见 §3；表单不发送请求。
- **钱包绑定只到会话账号地址清单**，不是链上 `UVPIdentityRegistry` 绑定；链上
  绑定仍需治理服务登记（`registerIdentity`），本模块不越权。
- **撤销地址/档案快照列表未做 UI**：`POST /store/auth/addresses/revoke` 与
  `GET /identity/descriptors/:subjectId` 已存在，需要时可接。
- **未新增单测**：按测试纪律（仓库零测试默认、新测试是申请项），本次验证以
  typecheck/build 为准；`form.ts` 的校验逻辑是纯函数，需要时可在拥有层补测。
- **HTTP transport 局部实现**：`client.ts` 自带 fetch/超时/错误解析（与
  `productApi` 的私有 transport 同口径但未共享），因为 `productApi` 在本次
  写入范围之外。后续可抽公共 client 收敛，当前不宣称单源。
- 身份事实接口公开可读是服务端现状（`/identity/bindings`、`/identity/descriptors`），
  本模块不额外加鉴权，也不把公开读当成身份证明。

