import type { Metadata } from "next";
import { buildRouteMetadata } from "@/app/lib/routeMetadata";
import { LoansPageClient } from "./LoansPageClient";

type PageProps = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;

  return buildRouteMetadata({ locale, key: "loans" });
}

export default function LoansPage() {
  return <LoansPageClient />;
}
