export type OrderAppSection = "tasks" | "orders" | "proof";

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

const sections = new Set<OrderAppSection>(["tasks", "orders", "proof"]);
const inviteSearchKeys = ["invite", "inviteToken"] as const;

/**
 * 路由只认 hash：?invite= 搜索参数属于"进入应用的邀请入口"，由
 * readInviteEntryFromSearch 在挂载时消费一次并从地址栏清除。
 * 若路由持续回读 search，hash 导航（只改 hash 不清 search）会让
 * 邀请面板永远还原，"返回待办"全部失效。
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
