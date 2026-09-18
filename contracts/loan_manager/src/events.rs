use soroban_sdk::{symbol_short, Address, Env, String, Symbol};

pub fn loan_requested(env: &Env, loan_id: u32, borrower: Address, amount: i128) {
    let topics = (Symbol::new(env, "LoanRequested"), loan_id, borrower);
    env.events().publish(topics, amount);
}

pub fn loan_approved(
    env: &Env,
    loan_id: u32,
    borrower: Address,
    interest_rate_bps: u32,
    term_ledgers: u32,
) {
    let topics = (Symbol::new(env, "LoanApproved"), loan_id, borrower);
    env.events()
        .publish(topics, (interest_rate_bps, term_ledgers));
}

pub fn loan_refinanced(
    env: &Env,
    loan_id: u32,
    borrower: Address,
    new_amount: i128,
    new_term: u32,
) {
    let topics = (Symbol::new(env, "LoanRefinanced"), loan_id, borrower);
    env.events().publish(topics, (new_amount, new_term));
}

pub fn loan_extended(
    env: &Env,
    loan_id: u32,
    borrower: Address,
    new_due_ledger: u32,
    fee_amount: i128,
    extension_count: u32,
) {
    let topics = (Symbol::new(env, "LoanExtended"), loan_id, borrower);
    env.events()
        .publish(topics, (new_due_ledger, fee_amount, extension_count));
}

pub fn loan_repaid(env: &Env, borrower: Address, loan_id: u32, amount: i128) {
    let topics = (Symbol::new(env, "LoanRepaid"), borrower, loan_id);
    env.events().publish(topics, amount);
}

pub fn loan_cancelled(env: &Env, borrower: Address, loan_id: u32) {
    let topics = (Symbol::new(env, "LoanCancelled"), borrower);
    env.events().publish(topics, loan_id);
}

pub fn loan_rejected(env: &Env, loan_id: u32, reason: String) {
    let topics = (Symbol::new(env, "LoanRejected"), loan_id);
    env.events().publish(topics, reason);
}

pub fn late_fee_charged(env: &Env, loan_id: u32, fee_amount: i128) {
    let topics = (Symbol::new(env, "LateFeeCharged"), loan_id);
    env.events().publish(topics, fee_amount);
}

pub fn min_score_updated(env: &Env, admin: Address, old_score: u32, new_score: u32) {
    let topics = (Symbol::new(env, "MinScoreUpdated"), admin);
    env.events().publish(topics, (old_score, new_score));
}

pub fn paused(env: &Env, paused_at_ledger: u32) {
    let topics = (Symbol::new(env, "Paused"),);
    env.events().publish(topics, paused_at_ledger);
}

pub fn unpaused(env: &Env, unpaused_at_ledger: u32) {
    let topics = (Symbol::new(env, "Unpaused"),);
    env.events().publish(topics, unpaused_at_ledger);
}

// pub fn min_score_updated(env: &Env, old_score: u32, new_score: u32) {
//     let topics = (Symbol::new(env, "MinScoreUpdated"),);
//     env.events().publish(topics, (old_score, new_score));
// }

pub fn interest_rate_updated(env: &Env, old_rate: u32, new_rate: u32) {
    let topics = (Symbol::new(env, "InterestRateUpdated"),);
    env.events().publish(topics, (old_rate, new_rate));
}

pub fn default_term_updated(env: &Env, old_term: u32, new_term: u32) {
    let topics = (Symbol::new(env, "DefaultTermUpdated"),);
    env.events().publish(topics, (old_term, new_term));
}

pub fn loan_defaulted(env: &Env, loan_id: u32, borrower: Address) {
    let topics = (Symbol::new(env, "LoanDefaulted"), loan_id);
    env.events().publish(topics, borrower);
}

/// A default's credit-side consequences could not be applied on the NFT.
///
/// Scoring is deliberately best-effort (see `report_default_to_nft`): the alternative
/// is a misconfigured NFT making every overdue loan undefaultable, so collateral would
/// never be seized. The loan is still Defaulted and its collateral still liquidated;
/// only the borrower's score penalty and default record are missing, which is exactly
/// what an operator needs to be able to see and retry.
pub fn default_report_skipped(env: &Env, loan_id: u32, borrower: Address) {
    let topics = (Symbol::new(env, "DefaultReportSkipped"), loan_id);
    env.events().publish(topics, borrower);
}

/// A repayment's credit-score consequence could not be applied on the NFT.
///
/// The score writes are best-effort by design (see `repay`): they run after the
/// borrower's payment has already moved, so failing the transaction there would mean a
/// misconfigured score recorder makes repaying impossible. A refusal is not an error,
/// but it must not be invisible either.
pub fn score_report_skipped(env: &Env, borrower: Address, amount: i128) {
    let topics = (Symbol::new(env, "ScoreReportSkipped"), borrower);
    env.events().publish(topics, amount);
}

pub fn term_limits_updated(env: &Env, min_term: u32, max_term: u32) {
    let topics = (Symbol::new(env, "TermLimitsUpdated"),);
    env.events().publish(topics, (min_term, max_term));
}

pub fn rate_oracle_updated(env: &Env, old_oracle: Option<Address>, new_oracle: Address) {
    let topics = (Symbol::new(env, "RateOracleUpdated"),);
    env.events().publish(topics, (old_oracle, new_oracle));
}

pub fn collateral_returned(env: &Env, borrower: Address, loan_id: u32, amount: i128) {
    let topics = (Symbol::new(env, "CollateralReturned"), borrower, loan_id);
    env.events().publish(topics, amount);
}

pub fn collateral_deposited(env: &Env, borrower: Address, loan_id: u32, amount: i128) {
    let topics = (Symbol::new(env, "CollateralDeposited"), borrower, loan_id);
    env.events().publish(topics, amount);
}

pub fn collateral_released(env: &Env, borrower: Address, loan_id: u32) {
    let topics = (Symbol::new(env, "CollateralReleased"), borrower, loan_id);
    env.events().publish(topics, ());
}

pub fn late_fee_rate_updated(env: &Env, admin: Address, old_rate: u32, new_rate: u32) {
    let topics = (Symbol::new(env, "LateFeeRateUpdated"), admin);
    env.events().publish(topics, (old_rate, new_rate));
}

pub fn grace_period_updated(env: &Env, admin: Address, old_ledgers: u32, new_ledgers: u32) {
    let topics = (Symbol::new(env, "GracePeriodUpdated"), admin);
    env.events().publish(topics, (old_ledgers, new_ledgers));
}

pub fn default_window_updated(env: &Env, admin: Address, old_ledgers: u32, new_ledgers: u32) {
    let topics = (Symbol::new(env, "DefaultWindowUpdated"), admin);
    env.events().publish(topics, (old_ledgers, new_ledgers));
}

pub fn max_loan_amount_updated(env: &Env, admin: Address, old_amount: i128, new_amount: i128) {
    let topics = (Symbol::new(env, "MaxLoanAmountUpdated"), admin);
    env.events().publish(topics, (old_amount, new_amount));
}

pub fn min_repayment_updated(env: &Env, admin: Address, old_amount: i128, new_amount: i128) {
    let topics = (Symbol::new(env, "MinRepaymentUpdated"), admin);
    env.events().publish(topics, (old_amount, new_amount));
}

pub fn max_loans_per_borrower_updated(env: &Env, admin: Address, old_max: u32, new_max: u32) {
    let topics = (Symbol::new(env, "MaxLoansPerBorrower"), admin);
    env.events().publish(topics, (old_max, new_max));
}

pub fn loan_approved_by_admin(env: &Env, admin: Address, loan_id: u32, borrower: Address) {
    let topics = (symbol_short!("LoanApprv"), admin);
    env.events().publish(topics, (loan_id, borrower));
}

pub fn collateral_liquidated(env: &Env, loan_id: u32, amount: i128) {
    let topics = (Symbol::new(env, "CollateralLiquidated"), loan_id);
    env.events().publish(topics, amount);
}

pub fn loan_liquidated(
    env: &Env,
    loan_id: u32,
    borrower: Address,
    liquidator: Address,
    debt_repaid: i128,
    liquidator_bonus: i128,
    borrower_refund: i128,
) {
    let topics = (
        Symbol::new(env, "LoanLiquidated"),
        loan_id,
        borrower,
        liquidator,
    );
    env.events()
        .publish(topics, (debt_repaid, liquidator_bonus, borrower_refund));
}

pub fn min_rate_bps_updated(env: &Env, admin: Address, old_rate: u32, new_rate: u32) {
    let topics = (Symbol::new(env, "MinRateBpsUpdated"), admin);
    env.events().publish(topics, (old_rate, new_rate));
}

pub fn max_rate_bps_updated(env: &Env, admin: Address, old_rate: u32, new_rate: u32) {
    let topics = (Symbol::new(env, "MaxRateBpsUpdated"), admin);
    env.events().publish(topics, (old_rate, new_rate));
}

pub fn loan_purged(env: &Env, loan_id: u32) {
    let topics = (Symbol::new(env, "LoanPurged"),);
    env.events().publish(topics, loan_id);
}
