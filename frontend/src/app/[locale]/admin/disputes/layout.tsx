import type { Metadata } from "next";
import { buildRouteMetadata } from "@/app/lib/routeMetadata";

/**
 * Metadata for the admin disputes route.
 *
 * It lives in a layout rather than in `page.tsx` because that page is a client component, and
 * Next.js only reads `generateMetadata` from a server component. The layout renders its children
 * untouched — it exists to describe the segment.
 */
type LayoutProps = {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: LayoutProps): Promise<Metadata> {
  const { locale } = await params;

  return buildRouteMetadata({ locale, key: "adminDisputes" });
}

export default function AdminDisputesLayout({ children }: LayoutProps) {
  return <>{children}</>;
}
