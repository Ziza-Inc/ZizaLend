import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
// Imported from `describedRoutes` rather than `routeMetadata`: the latter pulls in
// `next-intl/server`, which resolves to an ESM build Jest cannot transform, and the table itself
// needs no request context to be read.
import { DESCRIBED_ROUTES, getDescribedRoute } from "./describedRoutes";

const APP_DIR = join(__dirname, "..");
const LOCALE_DIR = join(APP_DIR, "[locale]");
const LOCALES = ["en", "es", "tl"] as const;

type Messages = Record<string, Record<string, { title: string; description: string }>>;

function readMessages(locale: string): Messages {
  return JSON.parse(
    readFileSync(join(APP_DIR, "..", "..", "messages", `${locale}.json`), "utf8"),
  ) as Messages;
}

/**
 * Every segment under `[locale]` that has a page, relative to the locale segment.
 *
 * The locale segment itself counts — the home route is `[locale]/page.tsx` — so it is listed as
 * the empty path rather than being missed by a walk that only descends.
 */
function routeDirectories(): string[] {
  const found: string[] = readdirSync(LOCALE_DIR).includes("page.tsx") ? [""] : [];

  const descend = (directory: string, prefix: string): string[] => {
    const nested: string[] = [];

    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      if (!statSync(path).isDirectory()) continue;

      const relative = prefix ? `${prefix}/${entry}` : entry;
      if (readdirSync(path).includes("page.tsx")) nested.push(relative);
      nested.push(...descend(path, relative));
    }

    return nested;
  };

  return [...found, ...descend(LOCALE_DIR, "")];
}

describe("route metadata", () => {
  it("finds the routes it is supposed to be checking", () => {
    // Guards the test itself: a broken walk would otherwise pass by finding nothing.
    const directories = routeDirectories();
    expect(directories.length).toBeGreaterThanOrEqual(19);
    // The home route is the empty path, and it is the one that is easiest to miss.
    expect(directories).toContain("");
    expect(directories).toContain("activity");
    expect(directories).toContain("loans/[loanId]");
    expect(directories).toContain("admin/disputes/[id]");
  });

  it("has no route that renders without describing itself", () => {
    // Fourteen of these pages are client components, and Next.js only reads `generateMetadata`
    // from a server component — so for those the metadata belongs in the directory's `layout.tsx`.
    // Whichever way it is done, the directory has to do it somewhere: a route that declares
    // neither inherits the landing page's title, and every shared link then reads the same.
    const undescribed = routeDirectories().filter((route) => {
      const page = readFileSync(join(LOCALE_DIR, route, "page.tsx"), "utf8");
      if (page.includes("generateMetadata") || /\bexport const metadata\b/.test(page)) return false;

      const layoutPath = join(LOCALE_DIR, route, "layout.tsx");
      try {
        const layout = readFileSync(layoutPath, "utf8");
        return !layout.includes("generateMetadata");
      } catch {
        return true;
      }
    });

    expect(undescribed).toEqual([]);
  });

  it("gives the locale segment metadata for the home route", () => {
    // `[locale]/page.tsx` is a client component, so the index inherits from the locale layout.
    const layout = readFileSync(join(LOCALE_DIR, "layout.tsx"), "utf8");
    expect(layout).toContain("generateMetadata");
    expect(layout).toContain('key: "home"');
  });

  it("describes a route for every key in its own table", () => {
    for (const route of DESCRIBED_ROUTES) {
      expect(getDescribedRoute(route.key)).toBe(route);
    }
  });

  it("has a distinct key and path per route", () => {
    const keys = DESCRIBED_ROUTES.map((route) => route.key);
    const paths = DESCRIBED_ROUTES.map((route) => route.path);

    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe.each(LOCALES)("messages for %s", (locale) => {
  const messages = readMessages(locale);

  it("defines a title and description for every described route", () => {
    for (const route of DESCRIBED_ROUTES) {
      const entry = messages.Metadata?.[route.key];

      expect(entry).toBeDefined();
      expect(typeof entry.title).toBe("string");
      expect(entry.title.length).toBeGreaterThan(1);
      expect(typeof entry.description).toBe("string");
      expect(entry.description.length).toBeGreaterThan(10);
    }
  });

  it("says something different about each route", () => {
    const titles = DESCRIBED_ROUTES.map((route) => messages.Metadata[route.key]!.title);
    const descriptions = DESCRIBED_ROUTES.map((route) => messages.Metadata[route.key]!.description);

    // "Each route has a distinct title and description" is the requirement; a copy-paste that
    // left two routes identical is the way it fails in practice, and it is invisible on screen.
    expect(new Set(titles).size).toBe(titles.length);
    expect(new Set(descriptions).size).toBe(descriptions.length);
  });

  it("does not repeat the site name, which the title template appends", () => {
    for (const route of DESCRIBED_ROUTES) {
      expect(messages.Metadata[route.key]!.title).not.toMatch(/\|\s*Zizalend\s*$/i);
      expect(messages.Metadata[route.key]!.title).not.toMatch(/\|\s*Zizalend/i);
    }
  });
});
