import type { Metadata } from "next";

type PageMetadataInput = {
  locale: string;
  path: string;
  title: string;
  description: string;
};

const LOCALES = ["en", "es", "tl"] as const;
const DEFAULT_SITE_URL = "https://zizalend.com";
export const SITE_NAME = "Zizalend";
// Social crawlers (Facebook, LinkedIn, Slack, X) do not render SVG preview
// cards, so an SVG here silently produced no image on every share. Ship the
// PNG that already lives in public/.
const OG_IMAGE_PATH = "/og-image.png";

export const SITE_TITLE = "Zizalend — Borderless P2P Lending & Remittance";

export const SITE_DESCRIPTION =
  "The premium DeFi lending protocol on Stellar. Turn remittance history into credit history with blockchain-powered micro-loans and instant cross-border transfers.";

export function getSiteUrl() {
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL ?? DEFAULT_SITE_URL;

  try {
    return new URL(configuredUrl);
  } catch {
    return new URL(DEFAULT_SITE_URL);
  }
}

/**
 * Root-layout metadata.
 *
 * Kept here rather than inline in layout.tsx so it is a plain, importable
 * value that unit tests can assert on without booting the Next.js runtime
 * (layout.tsx pulls in next/font and the next-intl server context).
 *
 * The PWA manifest lives in public/manifest.webmanifest; it was never
 * referenced from metadata, so browsers had no install prompt, no standalone
 * display, and no theme colour even though the manifest already existed.
 */
export function buildRootMetadata(): Metadata {
  return {
    metadataBase: getSiteUrl(),
    title: {
      default: SITE_TITLE,
      template: `%s | ${SITE_NAME}`,
    },
    description: SITE_DESCRIPTION,
    applicationName: SITE_NAME,
    manifest: "/manifest.webmanifest",
    icons: {
      icon: [
        { url: "/images/favicon-16x16.png", sizes: "16x16", type: "image/png" },
        { url: "/images/favicon-32x32.png", sizes: "32x32", type: "image/png" },
        { url: "/images/android-chrome-192x192.png", sizes: "192x192", type: "image/png" },
        { url: "/images/android-chrome-512x512.png", sizes: "512x512", type: "image/png" },
      ],
      shortcut: ["/images/favicon-32x32.png"],
      apple: [{ url: "/images/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
    },
    appleWebApp: {
      capable: true,
      title: SITE_NAME,
      statusBarStyle: "default",
    },
  };
}

export function buildPageMetadata({
  locale,
  path,
  title,
  description,
}: PageMetadataInput): Metadata {
  const siteUrl = getSiteUrl();
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const pathname = `/${locale}${normalizedPath}`;
  const url = new URL(pathname, siteUrl).toString();
  const ogImage = new URL(OG_IMAGE_PATH, siteUrl).toString();

  const languages = Object.fromEntries(
    LOCALES.map((loc) => [loc, new URL(`/${loc}${normalizedPath}`, siteUrl).toString()]),
  );
  languages["x-default"] = new URL(`/en${normalizedPath}`, siteUrl).toString();

  return {
    title,
    description,
    alternates: {
      canonical: pathname,
      languages,
    },
    openGraph: {
      title,
      description,
      url,
      siteName: SITE_NAME,
      type: "website",
      images: [
        {
          url: ogImage,
          width: 1200,
          height: 630,
          alt: `${title} social preview`,
        },
      ],
      locale,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage],
    },
  };
}
