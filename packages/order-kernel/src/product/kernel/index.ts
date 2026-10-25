// 订单域出口：客户端、错误映射、配置摊平、开单草稿映射与邀请接受
// EIP-712 校验/摘要。DTO 与签名类型的单源分别是 product-dto 与
// protocol-bindings，本目录只做通用 transport 与宿主适配所需的纯函数。

export * from "./errors";
export * from "./types";
export * from "./client";
export * from "./config";
export * from "./draft";
export * from "./typedData";
