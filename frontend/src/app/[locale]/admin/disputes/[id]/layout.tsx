import type { Metadata } from "next";
import { buildRouteMetadata } from "@/app/lib/routeMetadata";

/**
 * Metadata for the admin dispute detail route.
 *
 * It lives in a layout rather than in `page.tsx` because that page is a client component, and
 * Next.js only reads `generateMetadata` from a server component. The layout renders its children
 * untouched — it exists to describe the segment.
 */
type LayoutProps = {
  children: React.ReactNode;
  params: Promise<{ locale: string; id: string }>;
};

export async function generateMetadata({ params }: LayoutProps): Promise<Metadata> {
  const { locale, id } = await params;

  return buildRouteMetadata({
    locale,
    key: "adminDisputeDetail",
    path: `/admin/disputes/${id}`,
  });
}

export default function AdminDisputeDetailLayout({ children }: LayoutProps) {
  return <>{children}</>;
}
