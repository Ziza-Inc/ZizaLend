import type { Metadata } from "next";
import { buildRouteMetadata } from "@/app/lib/routeMetadata";
import { LendPageClient } from "./LendPageClient";

type PageProps = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;

  return buildRouteMetadata({ locale, key: "lend" });
}

export default function LendPage() {
  return <LendPageClient />;
}
