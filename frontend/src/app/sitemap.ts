import type { MetadataRoute } from "next";
import { getSiteUrl } from "./lib/metadata";
import { DESCRIBED_ROUTES } from "./lib/describedRoutes";

/**
 * The site's origin, without a trailing slash.
 *
 * `getSiteUrl().toString()` ends in `/` — `URL` normalises an origin-only URL that way — so
 * interpolating it produced `https://zizalend.com//en/lend`. The sitemap is a machine-readable
 * file that crawlers fetch; a doubled path separator is not a canonical URL, and the alternates
 * that `getAlternates` builds were doubled the same way.
 */
const BASE_URL = getSiteUrl().origin;

const locales = ["en", "es", "tl"] as const;

function getAlternates(path: string) {
  return {
    languages: Object.fromEntries(
      locales.map((locale) => [locale, `${BASE_URL}/${locale}${path}`]),
    ),
  };
}

/**
 * Crawl hints for the routes worth stating them for.
 *
 * Anything absent gets the conservative default below rather than being left out: a route that
 * is indexable and missing from the sitemap is a route nobody finds.
 */
const CRAWL_HINTS: Record<
  string,
  { changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"]; priority: number }
> = {
  home: { changeFrequency: "weekly", priority: 1 },
  lend: { changeFrequency: "daily", priority: 0.8 },
  liquidations: { changeFrequency: "daily", priority: 0.7 },
  kingdom: { changeFrequency: "weekly", priority: 0.6 },
  loans: { changeFrequency: "weekly", priority: 0.6 },
  remittances: { changeFrequency: "weekly", priority: 0.6 },
  activity: { changeFrequency: "weekly", priority: 0.5 },
  analytics: { changeFrequency: "weekly", priority: 0.5 },
  requestLoan: { changeFrequency: "weekly", priority: 0.5 },
  sendRemittance: { changeFrequency: "weekly", priority: 0.5 },
};

const DEFAULT_HINT: { changeFrequency: "weekly"; priority: number } = {
  changeFrequency: "weekly",
  priority: 0.5,
};

export default function sitemap(): MetadataRoute.Sitemap {
  // Derived from the same table the routes describe themselves with, so the sitemap cannot list a
  // page that does not exist or omit one that has been made public. Dynamic segments and the
  // routes marked `indexable: false` (account, admin, demo) are left out deliberately: a sitemap
  // entry for `/loans/[loanId]` would advertise a template, and one for `/settings` would invite
  // a crawler into a signed-in surface.
  return DESCRIBED_ROUTES.filter((route) => route.indexable && !route.path.includes("[")).map(
    (route) => ({
      url: `${BASE_URL}/en${route.path}`,
      lastModified: new Date(),
      ...(CRAWL_HINTS[route.key] ?? DEFAULT_HINT),
      alternates: getAlternates(route.path),
    }),
  );
}
