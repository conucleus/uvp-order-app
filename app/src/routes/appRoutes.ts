export type OrderAppSection = "tasks" | "orders" | "proof" | "registration";

export interface OrderAppRoute {
  readonly section: OrderAppSection;
  readonly taskId?: string | undefined;
  readonly orderId?: string | undefined;
  readonly inviteId?: string | undefined;
}

/** 邀请入口：?invite=<inviteId>&inviteToken=<一次性令牌> 只在进入应用时读取一次。 */
export interface InviteEntry {
  readonly inviteId: string;
  readonly inviteToken?: string | undefined;
}

/**
 * Reader 装修页入口：?decoration=<zhixuId>。
 * 只带秩序 id（公共读），不含一次性凭据，因此链接可分享、刷新可重开；
 * 与邀请入口互不消费，两者同时出现时邀请优先（加入流程更需要上下文）。
 */
export interface DecorationEntry {
  readonly zhixuId: string;
}

const sections = new Set<OrderAppSection>(["tasks", "orders", "proof", "registration"]);
const inviteSearchKeys = ["invite", "inviteToken"] as const;

/**
 * 路由只认 hash：?invite= 搜索参数属于"进入应用的邀请入口"，由
 * readInviteEntryFromSearch 在进入时读取进应用状态；地址栏上的一次性
 * 令牌保留到流程终态（accept/reject 成功或明确离开）才由
 * clearInviteSearchParams 清除，中途失败/刷新后仍可凭 URL 重试。
 * 路由不回读 search：hash 导航（只改 hash 不清 search）留下的 search
 * 残留不会在导航后还原邀请面板，"返回待办"保持可达。
 */
export function readOrderAppRoute(hash = window.location.hash): OrderAppRoute {
  const raw = hash.replace(/^#/u, "");
  const params = new URLSearchParams(raw.startsWith("?") ? raw.slice(1) : raw);
  const section = params.get("section");
  return {
    section: section && sections.has(section as OrderAppSection) ? section as OrderAppSection : "tasks",
    taskId: params.get("task") ?? undefined,
    orderId: params.get("order") ?? undefined,
    inviteId: params.get("invite") ?? undefined
  };
}

export function routeHash(route: OrderAppRoute): string {
  const params = new URLSearchParams({ section: route.section });
  if (route.taskId) {
    params.set("task", route.taskId);
  }
  if (route.orderId) {
    params.set("order", route.orderId);
  }
  if (route.inviteId) {
    params.set("invite", route.inviteId);
  }
  return `#${params.toString()}`;
}

export function readInviteEntryFromSearch(search = readSearch()): InviteEntry | undefined {
  if (typeof window === "undefined" && search === undefined) {
    return undefined;
  }
  const params = new URLSearchParams(search ?? "");
  const inviteId = params.get("invite")?.trim();
  if (!inviteId) {
    return undefined;
  }
  const inviteToken = params.get("inviteToken")?.trim();
  return { inviteId, ...(inviteToken ? { inviteToken } : {}) };
}

/** 读取 reader 装修入口（?decoration=<zhixuId>）；缺失或空白返回 undefined。 */
export function readDecorationEntryFromSearch(search = readSearch()): DecorationEntry | undefined {
  const zhixuId = new URLSearchParams(search ?? "").get("decoration")?.trim();
  return zhixuId ? { zhixuId } : undefined;
}

/** 离开 reader 装修页时移除 decoration 搜索参数，避免刷新后回到装修页。 */
export function clearDecorationSearchParam(history = window.history): void {
  if (typeof window === "undefined") {
    return;
  }
  const url = new URL(window.location.href);
  if (!url.searchParams.has("decoration")) {
    return;
  }
  url.searchParams.delete("decoration");
  history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

/**
 * 消费邀请搜索参数后把它们从地址栏移除（保留其余参数）。
 * inviteToken 是一次性凭据，也不应留在可被分享/刷新还原的 URL 里。
 */
export function clearInviteSearchParams(history = window.history): void {
  if (typeof window === "undefined") {
    return;
  }
  const url = new URL(window.location.href);
  let changed = false;
  for (const key of inviteSearchKeys) {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      changed = true;
    }
  }
  if (changed) {
    history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }
}

function readSearch(): string | undefined {
  return typeof window === "undefined" ? undefined : window.location.search;
}
