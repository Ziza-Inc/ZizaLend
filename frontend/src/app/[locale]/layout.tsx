import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { buildRouteMetadata } from "@/app/lib/routeMetadata";

/**
 * The locale segment's own metadata, which is what the home route inherits.
 *
 * `[locale]/page.tsx` is a client component — it renders a wallet-aware dashboard — so it cannot
 * declare its own `generateMetadata`, and the segment that wraps it is the only place the landing
 * page's title and description can come from. Child routes describe themselves and override every
 * field returned here, so this is a default for the index and not a shared title for the app.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;

  return {
    manifest: "/manifest.webmanifest",
    ...(await buildRouteMetadata({ locale, key: "home" })),
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!["en", "es", "tl"].includes(locale)) {
    notFound();
  }

  const messages = await getMessages();

  return (
    <NextIntlClientProvider messages={messages} locale={locale}>
      {children}
    </NextIntlClientProvider>
  );
}
