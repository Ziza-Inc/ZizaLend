/**
 * Loans module.
 *
 * Covers the full loan lifecycle: request, approve, repay, cancel,
 * refinance, extend, liquidate, collateral management, and queries.
 */

import { Client } from "./client.js";
import {
  collectPages,
  iteratePages,
  type PaginatorOptions,
} from "./pagination.js";

export interface BorrowerLoan {
  loanId: number;
  principal: number;
  accruedInterest: number;
  totalRepaid: number;
  totalOwed: number;
  nextPaymentDeadline: string;
  status: "active" | "repaid" | "defaulted";
  borrower: string;
  approvedAt?: string | null;
}

export interface BorrowerLoansResponse {
  success: boolean;
  borrower: string;
  loans: BorrowerLoan[];
}

export interface LoanSummaryEvent {
  type: string;
  amount?: string | null;
  timestamp?: string | null;
  tx?: string | null;
}

export interface LoanDetailsSummary {
  principal: number;
  accruedInterest: number;
  totalRepaid: number;
  totalOwed: number;
  interestRate: number;
  termLedgers: number;
  elapsedLedgers: number;
  status: "active" | "repaid" | "defaulted";
  requestedAt?: string | null;
  approvedAt?: string | null;
  events: LoanSummaryEvent[];
}

export interface LoanDetailsResponse {
  success: boolean;
  loanId: string;
  summary: LoanDetailsSummary;
}

export interface UnsignedTransactionResponse {
  success: boolean;
  unsignedTxXdr: string;
  networkPassphrase: string;
}

export interface RepayTransactionResponse {
  success: boolean;
  loanId: number;
  unsignedTxXdr: string;
  networkPassphrase: string;
}

export interface SubmittedTransactionResponse {
  success: boolean;
  txHash: string;
  status: string;
  resultXdr?: string;
}

export interface LoanConfig {
  minAmount?: string;
  maxAmount?: string;
  minDuration?: number;
  maxDuration?: number;
  interestRateBps?: number;
  [key: string]: unknown;
}

export interface BuildRepayTxParams {
  borrowerPublicKey: string;
  amount: string;
}

export interface BuildLoanRequestTxParams {
  borrowerPublicKey: string;
  amount: string;
  collateralToken?: string;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  page_info?: {
    limit: number;
    next_cursor?: string | null;
    has_next?: boolean;
  };
}

/**
 * The envelope `GET /loans` actually returns.
 *
 * The controller builds it with `createCursorPaginatedResponse`, which nests the payload under
 * `data` and puts the cursor in `page_info`. That is a different shape from
 * `BorrowerLoansResponse` — which describes the loans at the top level and no cursor at all —
 * so this is what `iterate` reads. `BorrowerLoansResponse` stays as it is, because changing it
 * would change what `list` declares.
 */
export interface BorrowerLoansPage {
  success: boolean;
  data: {
    borrower?: string;
    loans: BorrowerLoan[];
  };
  total_count?: number | null;
  page_info?: {
    limit: number;
    count?: number;
    next_cursor?: string | null;
    has_previous?: boolean;
    has_next?: boolean;
  };
}

export class Loans {
  constructor(private client: Client) {}

  /**
   * Get all loans for the authenticated user.
   */
  async list(params?: {
    status?: "active" | "repaid" | "defaulted" | "pending";
    limit?: number;
    cursor?: string;
    from?: string;
    to?: string;
  }): Promise<BorrowerLoansResponse> {
    return this.client.get<BorrowerLoansResponse>("/loans", params);
  }

  /**
   * Iterate every loan for the authenticated user, page by page.
   *
   *     for await (const loan of client.loans.iterate({ status: 'active' })) { ... }
   *
   * Reads the endpoint through `BorrowerLoansPage` rather than `BorrowerLoansResponse`,
   * because the endpoint wraps its payload the way `createCursorPaginatedResponse` does — the
   * loans arrive under `data`, with the cursor under `page_info`. `BorrowerLoansResponse`
   * describes the pre-envelope shape and is left as it is: correcting it changes what `list`
   * declares, which is a separate change from adding an iterator.
   */
  async *iterate(
    params?: {
      status?: "active" | "repaid" | "defaulted" | "pending";
      limit?: number;
      from?: string;
      to?: string;
    } & PaginatorOptions,
  ): AsyncGenerator<BorrowerLoan, void, undefined> {
    const { maxPages, startCursor, ...filters } = params ?? {};
    const pageOptions: PaginatorOptions = { maxPages, startCursor };

    yield* iteratePages<BorrowerLoan>(async (cursor) => {
      const page = await this.client.get<BorrowerLoansPage>("/loans", {
        ...filters,
        cursor,
      });

      return {
        items: page.data?.loans ?? [],
        nextCursor: page.page_info?.next_cursor ?? undefined,
      };
    }, pageOptions);
  }

  /**
   * Fetch every page and return the loans as one array.
   *
   * `maxPages` still applies: a collector cannot stop early, so the ceiling is the only thing
   * that bounds it.
   */
  async collect(
    params?: {
      status?: "active" | "repaid" | "defaulted" | "pending";
      limit?: number;
      from?: string;
      to?: string;
    } & PaginatorOptions,
  ): Promise<BorrowerLoan[]> {
    const { maxPages, startCursor, ...filters } = params ?? {};

    return collectPages<BorrowerLoan>(
      async (cursor) => {
        const page = await this.client.get<BorrowerLoansPage>("/loans", {
          ...filters,
          cursor,
        });

        return {
          items: page.data?.loans ?? [],
          nextCursor: page.page_info?.next_cursor ?? undefined,
        };
      },
      { maxPages, startCursor },
    );
  }

  /**
   * Get details for a specific loan.
   */
  async get(loanId: number): Promise<LoanDetailsResponse> {
    return this.client.get<LoanDetailsResponse>(`/loans/${loanId}`);
  }

  /**
   * Get loan configuration parameters.
   */
  async getConfig(): Promise<LoanConfig> {
    return this.client.get<{ success: boolean; [key: string]: unknown }>(
      "/loans/config",
    ) as unknown as Promise<LoanConfig>;
  }

  /**
   * Build an unsigned loan request transaction.
   * The borrower must sign this with their Stellar wallet and submit.
   */
  async buildRequestTx(
    params: BuildLoanRequestTxParams,
  ): Promise<UnsignedTransactionResponse> {
    return this.client.post<UnsignedTransactionResponse>(
      "/loans/request",
      params,
    );
  }

  /**
   * Build an unsigned repayment transaction.
   */
  async buildRepayTx(
    loanId: number,
    params: BuildRepayTxParams,
  ): Promise<RepayTransactionResponse> {
    return this.client.post<RepayTransactionResponse>(
      `/loans/${loanId}/repay`,
      params,
    );
  }

  /**
   * Submit a signed transaction to the chain via the API.
   */
  async submitTransaction(
    loanId: number,
    signedTxXdr: string,
  ): Promise<SubmittedTransactionResponse> {
    return this.client.post<SubmittedTransactionResponse>(
      `/loans/${loanId}/submit`,
      {
        signedTxXdr,
      },
    );
  }

  /**
   * Build a cancel loan transaction.
   */
  async buildCancelTx(loanId: number): Promise<UnsignedTransactionResponse> {
    return this.client.post<UnsignedTransactionResponse>(
      `/loans/${loanId}/cancel`,
    );
  }

  /**
   * Build a reject loan transaction (admin).
   */
  async buildRejectTx(loanId: number): Promise<UnsignedTransactionResponse> {
    return this.client.post<UnsignedTransactionResponse>(
      `/loans/${loanId}/reject`,
    );
  }

  /**
   * Build a refinance loan transaction.
   */
  async buildRefinanceTx(
    loanId: number,
    params: { newAmount?: string; newTermLedgers?: number },
  ): Promise<UnsignedTransactionResponse> {
    return this.client.post<UnsignedTransactionResponse>(
      `/loans/${loanId}/refinance`,
      params,
    );
  }

  /**
   * Build an extend loan transaction.
   */
  async buildExtendTx(loanId: number): Promise<UnsignedTransactionResponse> {
    return this.client.post<UnsignedTransactionResponse>(
      `/loans/${loanId}/extend`,
    );
  }

  /**
   * Get amortization schedule for a loan.
   */
  async getAmortizationSchedule(loanId: number): Promise<unknown> {
    return this.client.get(`/loans/${loanId}/amortization`);
  }

  /**
   * Build a deposit collateral transaction.
   */
  async buildDepositCollateralTx(
    loanId: number,
  ): Promise<UnsignedTransactionResponse> {
    return this.client.post<UnsignedTransactionResponse>(
      `/loans/${loanId}/collateral/deposit`,
    );
  }

  /**
   * Build a release collateral transaction.
   */
  async buildReleaseCollateralTx(
    loanId: number,
  ): Promise<UnsignedTransactionResponse> {
    return this.client.post<UnsignedTransactionResponse>(
      `/loans/${loanId}/collateral/release`,
    );
  }

  /**
   * Build a liquidate loan transaction.
   */
  async buildLiquidateTx(loanId: number): Promise<UnsignedTransactionResponse> {
    return this.client.post<UnsignedTransactionResponse>(
      `/loans/${loanId}/liquidate`,
    );
  }

  /**
   * Contest a default notification.
   */
  async contestDefault(loanId: number, reason?: string): Promise<void> {
    await this.client.post(`/loans/${loanId}/contest-default`, { reason });
  }
}
