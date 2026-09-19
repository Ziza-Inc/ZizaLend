import { FlaskConical } from "lucide-react";

/**
 * Says so, on the page, when this instance is showing seeded data.
 *
 * `backend/src/seed` writes invented users, loans, remittances and notifications. On a local
 * development database that is expected and needs no announcement. On a deployed instance it does:
 * a visitor reading the loan list has no way to tell a seeded row from a real one, and the project's
 * claim is that the numbers shown are real.
 *
 * `NEXT_PUBLIC_DEMO_DATA=true` is the switch. It belongs in the environment of any deployment that
 * runs the seed script — the same deployment whose `indexer_state.last_indexed_cursor` reads
 * `seeded-dev-data` — and `docs/DEMO-DATA.md` covers the inventory and how to turn it off by
 * reseeding or by pointing the instance at a clean database.
 *
 * Rendered unconditionally rather than behind a dismiss button: a banner the reader can close is one
 * the next reader never sees, and this is a statement about what the data *is*.
 */

/**
 * Whether the demo banner should render for a given value.
 *
 * Read inside the component rather than at module scope so a test can set it, and accepting the
 * value as an argument so the parsing itself is testable without touching `process.env`.
 */
export function isDemoDataEnabled(
  value: string | undefined = process.env.NEXT_PUBLIC_DEMO_DATA,
): boolean {
  const normalised = (value ?? "").trim().toLowerCase();
  return normalised === "true" || normalised === "1";
}

export function DemoDataBanner() {
  if (!isDemoDataEnabled()) return null;

  return (
    <div
      className="border-b border-sky-200 bg-sky-50 dark:border-sky-900/50 dark:bg-sky-950/30"
      role="status"
      aria-live="polite"
      data-testid="demo-data-banner"
    >
      <div className="px-4 py-2 text-sky-900 dark:text-sky-200">
        <div className="mx-auto flex max-w-7xl items-start gap-2 text-sm">
          <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>
            <span className="font-semibold">Demo data.</span> This instance shows seeded sample
            activity — the accounts, loans and remittances here were created by the seed script and
            are not real transactions.
          </p>
        </div>
      </div>
    </div>
  );
}
