// app 路由：只有开单与订单房间两个视图；邀请链接走 ?invite=&inviteToken=
// 查询参数（一次性 token 不进入 hash 导航）。

export type OrderAppSection = "create" | "orders";

export interface OrderAppRoute {
  readonly section: OrderAppSection;
  readonly orderId?: string | undefined;
}

export interface InviteEntry {
  readonly inviteId: string;
  readonly inviteToken?: string | undefined;
}

const sections = new Set<OrderAppSection>(["create", "orders"]);
const inviteSearchKeys = ["invite", "inviteToken"] as const;

export function readOrderAppRoute(hash = window.location.hash): OrderAppRoute {
  const raw = hash.replace(/^#/u, "");
  const params = new URLSearchParams(raw.startsWith("?") ? raw.slice(1) : raw);
  const section = params.get("section");
  const orderId = params.get("order") ?? undefined;
  return {
    section: section && sections.has(section as OrderAppSection) ? section as OrderAppSection : "create",
    ...(orderId ? { orderId } : {})
  };
}

export function routeHash(route: OrderAppRoute): string {
  const params = new URLSearchParams({ section: route.section });
  if (route.orderId) {
    params.set("order", route.orderId);
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
