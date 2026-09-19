import type { Metadata } from "next";
import { buildRouteMetadata } from "@/app/lib/routeMetadata";
import LiquidationsClient from "./LiquidationsClient";

type PageProps = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;

  return buildRouteMetadata({ locale, key: "liquidations" });
}

export default function LiquidationsPage() {
  return <LiquidationsClient />;
}
