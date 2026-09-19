/** Shared formatting utilities for borrower loan components. */

// Re-exported rather than reimplemented. This module used to carry its own copy of the currency
// formatter, identical to the ten other copies in the app except for an explicit
// `minimumFractionDigits: 2` — the kind of near-duplicate that makes two screens show different
// figures for the same amount. `@/app/utils/amount` is the one implementation.
export { formatCurrency } from "@/app/utils/amount";

export function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function getDaysUntilDeadline(deadline: string): number {
  return Math.ceil((new Date(deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}
