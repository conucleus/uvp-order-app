export type OrderAppSection = "tasks" | "orders" | "proof";

export interface OrderAppRoute {
  readonly section: OrderAppSection;
  readonly taskId?: string;
  readonly orderId?: string;
  readonly inviteId?: string;
}

const sections = new Set<OrderAppSection>(["tasks", "orders", "proof"]);

export function readOrderAppRoute(hash = window.location.hash): OrderAppRoute {
  const raw = hash.replace(/^#/u, "");
  const params = new URLSearchParams(raw.startsWith("?") ? raw.slice(1) : raw);
  const section = params.get("section");
  return {
    section: section && sections.has(section as OrderAppSection) ? section as OrderAppSection : "tasks",
    taskId: params.get("task") ?? undefined,
    orderId: params.get("order") ?? undefined,
    inviteId: params.get("invite") ?? readInviteIdFromSearch()
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

function readInviteIdFromSearch(): string | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  return new URLSearchParams(window.location.search).get("invite") ?? undefined;
}
