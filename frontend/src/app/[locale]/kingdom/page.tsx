import type { Metadata } from "next";
import { buildRouteMetadata } from "@/app/lib/routeMetadata";
import KingdomClient from "./KingdomClient";

type PageProps = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;

  return buildRouteMetadata({ locale, key: "kingdom" });
}

export default function KingdomPage() {
  return <KingdomClient />;
}
