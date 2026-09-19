/**
 * The routes this app describes to crawlers, and what it says about them.
 *
 * Kept free of `next-intl/server` and of `next` itself so the table — and the tests that hold the
 * routes and the locale files to it — can be read without a request context. The metadata builders
 * that consume it live in `routeMetadata.ts`.
 *
 * Titles are deliberately bare — `"Lender Portfolio"`, not `"Lender Portfolio | Zizalend"`. The
 * root layout sets the title template `%s | Zizalend`, which Next.js applies to every page title
 * underneath it, so a title that spelled the suffix out rendered as
 * `"Lender Portfolio | Zizalend | Zizalend"`.
 */
export type RouteMetadataKey =
  | "home"
  | "activity"
  | "analytics"
  | "kingdom"
  | "lend"
  | "liquidations"
  | "loans"
  | "loanDetail"
  | "notifications"
  | "remittances"
  | "repay"
  | "requestLoan"
  | "sendRemittance"
  | "settings"
  | "uiDemo"
  | "wallet"
  | "adminDisputes"
  | "adminDisputeDetail"
  | "adminGovernance";

export interface DescribedRoute {
  key: RouteMetadataKey;
  /**
   * The path without the locale prefix. Dynamic segments keep their bracket form: the route file
   * passes the resolved path, and this is the value the sitemap and the tests need.
   */
  path: string;
  /** Whether a crawler should index it. Account, admin, and demo surfaces should not. */
  indexable: boolean;
}

/**
 * Every localised route that describes itself.
 *
 * One list rather than a convention, because it is read by three things that must agree: the
 * routes themselves, the sitemap, and the test that fails when a route directory has no metadata.
 */
export const DESCRIBED_ROUTES: readonly DescribedRoute[] = [
  { key: "home", path: "", indexable: true },
  { key: "activity", path: "/activity", indexable: true },
  { key: "analytics", path: "/analytics", indexable: true },
  { key: "kingdom", path: "/kingdom", indexable: true },
  { key: "lend", path: "/lend", indexable: true },
  { key: "liquidations", path: "/liquidations", indexable: true },
  { key: "loans", path: "/loans", indexable: true },
  { key: "loanDetail", path: "/loans/[loanId]", indexable: false },
  { key: "notifications", path: "/notifications", indexable: false },
  { key: "remittances", path: "/remittances", indexable: true },
  { key: "repay", path: "/repay/[loanId]", indexable: false },
  { key: "requestLoan", path: "/request-loan", indexable: true },
  { key: "sendRemittance", path: "/send-remittance", indexable: true },
  { key: "settings", path: "/settings", indexable: false },
  // A component showcase, reachable only by typing the URL. Indexing it would put a page of
  // sample data in front of someone searching for the product.
  { key: "uiDemo", path: "/ui-demo", indexable: false },
  { key: "wallet", path: "/wallet", indexable: false },
  { key: "adminDisputes", path: "/admin/disputes", indexable: false },
  { key: "adminDisputeDetail", path: "/admin/disputes/[id]", indexable: false },
  { key: "adminGovernance", path: "/admin/governance", indexable: false },
] as const;

const ROUTE_BY_KEY = new Map<RouteMetadataKey, DescribedRoute>(
  DESCRIBED_ROUTES.map((route) => [route.key, route]),
);

/** Look up a described route, throwing rather than silently emitting a default title. */
export function getDescribedRoute(key: RouteMetadataKey): DescribedRoute {
  const route = ROUTE_BY_KEY.get(key);
  if (!route) {
    throw new Error(`No described route for metadata key "${key}"`);
  }
  return route;
}
