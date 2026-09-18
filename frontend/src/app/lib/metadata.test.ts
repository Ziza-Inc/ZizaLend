import {
  buildPageMetadata,
  buildRootMetadata,
  buildRootViewport,
  getSiteUrl,
  SITE_TITLE,
} from "./metadata";

const ORIGINAL_APP_URL = process.env.NEXT_PUBLIC_APP_URL;

afterEach(() => {
  if (ORIGINAL_APP_URL === undefined) {
    delete process.env.NEXT_PUBLIC_APP_URL;
  } else {
    process.env.NEXT_PUBLIC_APP_URL = ORIGINAL_APP_URL;
  }
});

describe("getSiteUrl", () => {
  it("falls back to a lowercase default host when unset", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;

    expect(getSiteUrl().toString()).toBe("https://zizalend.com/");
  });

  it("falls back to the default when the configured value is not a URL", () => {
    process.env.NEXT_PUBLIC_APP_URL = "not-a-url";

    expect(getSiteUrl().hostname).toBe("zizalend.com");
  });

  it("uses the configured URL when valid", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://staging.zizalend.com";

    expect(getSiteUrl().hostname).toBe("staging.zizalend.com");
  });
});

describe("buildRootMetadata", () => {
  it("advertises the PWA manifest so the app is installable", () => {
    const metadata = buildRootMetadata();

    expect(metadata.manifest).toBe("/manifest.webmanifest");
  });

  it("declares browser and Apple touch icons that exist in public/", () => {
    const metadata = buildRootMetadata();
    const icons = metadata.icons as { icon?: unknown } | undefined;
    const rawIcon = icons?.icon;
    const iconList = Array.isArray(rawIcon) ? rawIcon : rawIcon ? [rawIcon] : [];

    expect(iconList.length).toBeGreaterThanOrEqual(4);
    expect(iconList.every((icon) => String((icon as { url: string }).url).endsWith(".png"))).toBe(
      true,
    );
    expect(metadata.appleWebApp).toMatchObject({ capable: true });
  });

  it("provides OpenGraph and Twitter defaults for the root route", () => {
    const metadata = buildRootMetadata();
    const ogImages = metadata.openGraph?.images;
    const images = Array.isArray(ogImages) ? ogImages : ogImages ? [ogImages] : [];

    expect(metadata.openGraph).toMatchObject({ siteName: "Zizalend", type: "website" });
    expect(images.length).toBeGreaterThan(0);
    expect(String((images[0] as { url: string }).url)).toMatch(/\.png$/);
    expect(metadata.twitter).toMatchObject({ card: "summary_large_image" });
  });

  it("keeps the marketing title as the default with a template for child pages", () => {
    const metadata = buildRootMetadata();

    expect(metadata.title).toEqual({ default: SITE_TITLE, template: "%s | Zizalend" });
  });
});

describe("buildRootViewport", () => {
  it("sets a responsive viewport with light and dark theme colours", () => {
    const viewport = buildRootViewport();
    const themeColors = viewport.themeColor;

    expect(viewport.width).toBe("device-width");
    expect(viewport.initialScale).toBe(1);
    expect(Array.isArray(themeColors)).toBe(true);
    expect(themeColors).toHaveLength(2);
  });
});

describe("buildPageMetadata", () => {
  it("uses a PNG social preview image because crawlers do not render SVG", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;

    const metadata = buildPageMetadata({
      locale: "en",
      path: "/loans",
      title: "Loans",
      description: "Your loans",
    });

    const ogImage = metadata.openGraph?.images;
    const images = Array.isArray(ogImage) ? ogImage : ogImage ? [ogImage] : [];

    expect(images.length).toBeGreaterThan(0);
    expect(String((images[0] as { url: string }).url)).toMatch(/\.png$/);
  });

  it("emits canonical, hreflang, and x-default alternates", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;

    const metadata = buildPageMetadata({
      locale: "es",
      path: "/loans",
      title: "Prestamos",
      description: "Tus prestamos",
    });

    expect(metadata.alternates?.canonical).toBe("/es/loans");
    expect(metadata.alternates?.languages).toMatchObject({
      en: expect.stringContaining("/en/loans"),
      es: expect.stringContaining("/es/loans"),
      tl: expect.stringContaining("/tl/loans"),
      "x-default": expect.stringContaining("/en/loans"),
    });
  });

  it("normalises a path that omits the leading slash", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;

    const metadata = buildPageMetadata({
      locale: "en",
      path: "lend",
      title: "Lend",
      description: "Provide liquidity",
    });

    expect(metadata.alternates?.canonical).toBe("/en/lend");
  });
});
