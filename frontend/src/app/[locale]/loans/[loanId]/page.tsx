import type { Metadata } from "next";
import { buildRouteMetadata } from "@/app/lib/routeMetadata";
import { LoanDetailsPageClient } from "./LoanDetailsPageClient";

type PageProps = {
  params: Promise<{ locale: string; loanId: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, loanId } = await params;

  return buildRouteMetadata({
    locale,
    key: "loanDetail",
    path: `/loans/${loanId}`,
  });
}

export default function LoanDetailsPage() {
  return <LoanDetailsPageClient />;
}
