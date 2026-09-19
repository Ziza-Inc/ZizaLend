"use client";

import { LoanStatusBadge } from "./LoanStatusBadge";
import { formatCurrency } from "@/app/utils/amount";

interface RepaymentProgressProps {
  totalRepaid: number;
  totalOwed: number;
  status: "active" | "repaid" | "defaulted" | "pending" | "liquidated";
}

export function RepaymentProgress({ totalRepaid, totalOwed, status }: RepaymentProgressProps) {
  const total = totalRepaid + totalOwed;
  const progress = total > 0 ? Math.min((totalRepaid / total) * 100, 100) : 100;

  return (
    <div className="rounded-2xl border border-[var(--border-default)] p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm text-[var(--text-secondary)]">Repayment progress</p>
        <p className="text-sm font-semibold text-[var(--text-primary)]">{progress.toFixed(1)}%</p>
      </div>

      <div className="h-2 w-full rounded-full bg-[var(--bg-surface-elevated)]">
        <div
          className="h-2 rounded-full bg-violet-600 transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-muted)]">
        <span>
          Paid:{" "}
          <strong className="text-[var(--text-primary)]">{formatCurrency(totalRepaid)}</strong>
        </span>
        <span>
          Remaining:{" "}
          <strong className="text-[var(--text-primary)]">{formatCurrency(totalOwed)}</strong>
        </span>
        <LoanStatusBadge status={status} />
      </div>
    </div>
  );
}
