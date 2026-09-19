"use client";

import { useMemo, useState } from "react";
import { formatCurrency } from "@/app/utils/amount";
import Link from "next/link";
import { ArrowRight, CalendarRange, CircleDollarSign, HandCoins, ShieldCheck } from "lucide-react";
import { ErrorBoundary } from "../../components/global_ui/ErrorBoundary";
import { LoansListSkeleton } from "../../components/skeletons/LoansListSkeleton";
import { useBorrowerLoansPage } from "../../hooks/useApi";
import { LoanStatusBadge } from "../../components/ui/LoanStatusBadge";
import { PaginationControls } from "../../components/ui/PaginationControls";
import { useWalletStore, selectWalletAddress } from "../../stores/useWalletStore";
import { useTranslations, useLocale } from "next-intl";
import { EmptyState } from "../../components/ui/EmptyState";

const PAGE_SIZE = 20;

function getLoanDisplayStatus(status: string, nextPaymentDeadline: string, now: number) {
  if (status !== "active") {
    return status;
  }

  return new Date(nextPaymentDeadline).getTime() < now ? "defaulted" : "active";
}

export function LoansPageClient() {
  const t = useTranslations("Loans");
  const locale = useLocale();
  const [activeTab, setActiveTab] = useState<"all" | "active" | "repaid" | "defaulted">("all");
  const [page, setPage] = useState(1);
  const [pageCursors, setPageCursors] = useState<Record<number, string | null>>({ 1: null });
  const [now] = useState(() => Date.now());
  const address = useWalletStore(selectWalletAddress);

  const {
    data: loansPage,
    isLoading,
    isError,
  } = useBorrowerLoansPage(address ?? undefined, {
    limit: PAGE_SIZE,
    cursor: pageCursors[page] ?? null,
    status: activeTab === "all" ? undefined : activeTab,
  });

  const displayedLoans = useMemo(() => {
    return (loansPage?.items ?? []).map((loan) => ({
      ...loan,
      displayStatus: getLoanDisplayStatus(loan.status, loan.nextPaymentDeadline, now),
    }));
  }, [loansPage?.items, now]);

  const totalPages = Math.max(
    page,
    loansPage?.pageInfo.hasNext
      ? Object.keys(pageCursors).length + 1
      : Object.keys(pageCursors).length,
  );

  const dueThisWeek = displayedLoans.filter((loan) => {
    const dueAt = new Date(loan.nextPaymentDeadline).getTime();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    return dueAt >= now && dueAt <= now + sevenDays;
  }).length;

  const totalOwed = displayedLoans.reduce((sum, loan) => sum + loan.totalOwed, 0);
  const overdueCount = displayedLoans.filter((loan) => loan.displayStatus === "defaulted").length;
  const portfolioHealth =
    overdueCount === 0
      ? t("health.strong")
      : overdueCount <= 2
        ? t("health.watch")
        : t("health.atRisk");

  if (isLoading) {
    return <LoansListSkeleton />;
  }

  if (isError) {
    return (
      <section className="rounded-3xl border border-red-200 bg-red-50 p-6 text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
        Failed to load loans. Please reconnect your wallet and try again.
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-violet-400">
            {t("borrowerPortal")}
          </p>
          <h1 className="text-3xl font-bold text-[var(--text-primary)]">{t("title")}</h1>
          <p className="mt-2 max-w-2xl text-sm text-[var(--text-secondary)]">{t("description")}</p>
        </div>
      </header>

      <ErrorBoundary scope="loan summary cards" variant="section">
        <div className="grid gap-4 md:grid-cols-3">
          {[
            {
              label: t("outstanding"),
              value: formatCurrency(totalOwed),
              icon: CircleDollarSign,
            },
            {
              label: t("dueThisWeek"),
              value: `${dueThisWeek} loan${dueThisWeek === 1 ? "" : "s"}`,
              icon: CalendarRange,
            },
            { label: t("portfolioHealth"), value: portfolioHealth, icon: ShieldCheck },
          ].map((item) => (
            <article
              key={item.label}
              className="rounded-3xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-5"
            >
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-violet-500/10 p-3 text-violet-400">
                  <item.icon className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm text-[var(--text-secondary)]">{item.label}</p>
                  <p className="text-xl font-semibold text-[var(--text-primary)]">{item.value}</p>
                </div>
              </div>
            </article>
          ))}
        </div>
      </ErrorBoundary>

      <ErrorBoundary scope="loan list" variant="section">
        <div className="space-y-4 rounded-3xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-4">
          <div className="flex flex-wrap gap-2">
            {[
              { key: "all", label: t("tabs.all") },
              { key: "active", label: t("tabs.active") },
              { key: "repaid", label: t("tabs.repaid") },
              { key: "defaulted", label: t("tabs.defaulted") },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => {
                  setActiveTab(tab.key as typeof activeTab);
                  setPage(1);
                  setPageCursors({ 1: null });
                }}
                className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                  activeTab === tab.key
                    ? "bg-violet-600 text-white"
                    : "bg-[var(--bg-surface-elevated)] text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)]"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {displayedLoans.length === 0 ? (
            <EmptyState
              icon={HandCoins}
              title={t("empty.title")}
              description={t("empty.description")}
              actionLabel={t("empty.action")}
              actionHref={`/${locale}/request-loan`}
              actionIcon={<ArrowRight className="h-4 w-4" />}
            />
          ) : (
            <div className="space-y-3">
              {displayedLoans.map((loan) => (
                <article
                  key={loan.id}
                  className="flex flex-col gap-4 rounded-2xl border border-[var(--border-default)] p-4 md:flex-row md:items-center md:justify-between"
                >
                  <div>
                    <p className="text-lg font-semibold text-[var(--text-primary)]">
                      {t("loanNumber", { id: loan.id })}
                    </p>
                    <p className="text-sm text-[var(--text-secondary)]">{loan.borrower}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    <LoanStatusBadge status={loan.displayStatus} />
                    <span className="text-zinc-600 dark:text-zinc-400">
                      {formatCurrency(loan.totalOwed)}
                    </span>
                    <span className="text-zinc-600 dark:text-zinc-400">
                      {t("due", { date: new Date(loan.nextPaymentDeadline).toLocaleDateString() })}
                    </span>
                  </div>
                  <Link
                    href={`/${locale}/loans/${loan.id}`}
                    className="inline-flex items-center gap-2 rounded-full bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-500"
                  >
                    {t("viewDetails")}
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </article>
              ))}
            </div>
          )}

          {displayedLoans.length > 0 && (
            <PaginationControls
              currentPage={page}
              totalPages={totalPages}
              hasPrevious={page > 1}
              hasNext={Boolean(loansPage?.pageInfo.hasNext)}
              onPageChange={(nextPage) => {
                if (pageCursors[nextPage] !== undefined) {
                  setPage(nextPage);
                  return;
                }

                if (nextPage === page + 1 && loansPage?.pageInfo.nextCursor) {
                  setPageCursors((current) => ({
                    ...current,
                    [nextPage]: loansPage.pageInfo.nextCursor,
                  }));
                  setPage(nextPage);
                }
              }}
              onPrevious={() => setPage((previous) => Math.max(1, previous - 1))}
              onNext={() => {
                if (loansPage?.pageInfo.nextCursor) {
                  setPageCursors((current) => ({
                    ...current,
                    [page + 1]: loansPage.pageInfo.nextCursor,
                  }));
                  setPage(page + 1);
                }
              }}
              summary={`Showing ${displayedLoans.length} loans on page ${page}`}
            />
          )}
        </div>
      </ErrorBoundary>
    </section>
  );
}
