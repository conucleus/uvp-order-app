export type OrderAppSection = "tasks" | "orders" | "create" | "proof" | "registration" | "requirements";

export interface OrderAppRoute {
  readonly section: OrderAppSection;
  readonly taskId?: string | undefined;
  readonly orderId?: string | undefined;
  readonly inviteId?: string | undefined;
  readonly draftId?: string | undefined;
}

export interface InviteEntry {
  readonly inviteId: string;
  readonly inviteToken?: string | undefined;
}

export interface DecorationEntry {
  readonly zhixuId: string;
}

const sections = new Set<OrderAppSection>(["tasks", "orders", "create", "proof", "registration", "requirements" ]);
const inviteSearchKeys = ["invite", "inviteToken"] as const;

export function readOrderAppRoute(hash = window.location.hash): OrderAppRoute {
  const raw = hash.replace(/^#/u, "");
  const params = new URLSearchParams(raw.startsWith("?") ? raw.slice(1) : raw);
  const section = params.get("section");
  return {
    section: section && sections.has(section as OrderAppSection) ? section as OrderAppSection : "tasks",
    taskId: params.get("task") ?? undefined,
    orderId: params.get("order") ?? undefined,
    inviteId: params.get("invite") ?? undefined,
    draftId: params.get("draftId") ?? undefined,
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
  if (route.draftId) {
    params.set("draftId", route.draftId);
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

export function readDecorationEntryFromSearch(search = readSearch()): DecorationEntry | undefined {
  const zhixuId = new URLSearchParams(search ?? "").get("decoration")?.trim();
  return zhixuId ? { zhixuId } : undefined;
}

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
