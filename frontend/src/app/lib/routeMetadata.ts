import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { buildPageMetadata } from "./metadata";
import { getDescribedRoute, type RouteMetadataKey } from "./describedRoutes";

export {
  DESCRIBED_ROUTES,
  getDescribedRoute,
  type DescribedRoute,
  type RouteMetadataKey,
} from "./describedRoutes";

/**
 * Build a route's `Metadata` from the `Metadata` namespace in the locale's messages.
 *
 * Fourteen of the route pages are client components, and a client component cannot export
 * `generateMetadata` — Next.js requires it from a server component. So those routes declare it in
 * a `layout.tsx` beside the page, which is also where the description of *this* segment belongs.
 *
 * `path` is only needed for a dynamic route, where the resolved segment replaces the template in
 * the table; everything else comes from the table so a route cannot describe itself differently
 * from how the sitemap lists it.
 */
export async function buildRouteMetadata({
  locale,
  key,
  path,
  indexable,
}: {
  locale: string;
  key: RouteMetadataKey;
  path?: string;
  indexable?: boolean;
}): Promise<Metadata> {
  const route = getDescribedRoute(key);
  const t = await getTranslations({ locale, namespace: "Metadata" });

  return buildPageMetadata({
    locale,
    path: path ?? route.path,
    title: t(`${key}.title`),
    description: t(`${key}.description`),
    indexable: indexable ?? route.indexable,
  });
}
