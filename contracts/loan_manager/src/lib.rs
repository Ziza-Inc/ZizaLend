#![no_std]
use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, contracttype, Address, BytesN, Env,
    String, Symbol, Vec,
};

#[contractclient(name = "NftClient")]
pub trait RemittanceNftInterface {
    fn get_score(env: Env, user: Address) -> u32;
    /// Credits a score from a repayment amount. Only the NFT's configured score
    /// recorder may call this, which is why the LoanManager must be registered via
    /// `set_score_recorder` at deploy time.
    fn update_score(env: Env, user: Address, repayment_amount: i128, minter: Option<Address>);
    /// Penalty half of the same recorder-gated path.
    fn decrease_score(env: Env, user: Address, penalty_points: u32, minter: Option<Address>);
    /// The NFT's configured minimum creditable repayment, so this contract can decide
    /// whether a credit is worthwhile before making a call that would otherwise fail
    /// the whole repayment transaction.
    fn get_min_repayment_amount(env: Env) -> i128;
    fn seize_collateral(env: Env, user: Address, minter: Option<Address>);
    fn is_seized(env: Env, user: Address) -> bool;
    fn record_default(env: Env, user: Address, minter: Option<Address>);
    fn is_authorized_minter(env: Env, minter: Address) -> bool;
    fn is_paused(env: Env) -> bool;
}

#[contractclient(name = "RateOracleClient")]
pub trait RateOracleInterface {
    fn get_rate(env: Env, borrower: Address, amount: i128, score: u32) -> u32;
}

#[contractclient(name = "PoolClient")]
pub trait LendingPoolInterface {
    fn is_paused(env: Env) -> bool;
    fn pool_balance(env: Env, token: Address) -> i128;
    fn get_total_outstanding(env: Env, token: Address) -> i128;
    /// Ask the pool to move principal to a borrower.
    ///
    /// Declared with a unit return: the pool's `disburse` returns
    /// `Result<(), PoolError>`, whose `Ok` payload is void, and whose `Err`
    /// surfaces as a host error that reverts this transaction. Naming the error
    /// type here would couple this crate to the pool crate for no benefit.
    ///
    /// This indirection is mandatory, not stylistic: a contract address can only
    /// authorise implicitly, so a transfer initiated *by this contract* out of
    /// the pool's balance can never be authorised.
    fn disburse(env: Env, token: Address, to: Address, amount: i128);
    /// Ask the pool to retire `amount` of principal from its outstanding
    /// balance when a loan is repaid, refinanced down, or defaulted.
    fn settle_outstanding(env: Env, token: Address, amount: i128);
}

mod events;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum LoanError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    LoanNotFound = 3,
    InsufficientScore = 4,
    LoanNotPending = 5,
    LoanNotActive = 6,
    InvalidAmount = 7,
    MaxLoansReached = 8,
    ContractPaused = 9,
    InsufficientPoolLiquidity = 10,
    LoanNotRepaid = 11,
    LoanNotPastDue = 12,
    RepaymentExceedsDebt = 13,
    BorrowerMismatch = 14,
    InvalidRate = 15,
    InvalidTerm = 16,
    LoanPastDue = 17,
    NoProposedAdmin = 18,
    PoolPaused = 19,
    NftPaused = 20,
    InvalidConfiguration = 21,
    SeizedBorrower = 22,
    AmountTooLarge = 23,
    MaxExtensionsReached = 24,
    InvalidExtension = 25,
    InsufficientCollateral = 26,
    LoanNotLiquidatable = 27,
    LoanNotPurgable = 28,
}

/// Why a loan was, or was not, transitioned to `Defaulted`.
///
/// Returned by the shared default pipeline so that the single-loan entry point can keep
/// reporting a specific reason, while the batch entry point skips the loan and moves on
/// to the next one instead of failing.
enum DefaultOutcome {
    Defaulted,
    NotFound,
    NotActive,
    NotPastDue,
    NotInitialized,
}

#[contracttype]
#[derive(Clone, PartialEq, Debug)]
pub enum LoanStatus {
    Pending,
    Approved,
    Repaid,
    Defaulted,
    Liquidated,
    Cancelled,
    Rejected,
}

#[contracttype]
#[derive(Clone)]
pub struct Loan {
    pub borrower: Address,
    pub amount: i128,
    pub collateral_amount: i128,
    pub principal_paid: i128,
    pub interest_paid: i128,
    pub accrued_interest: i128,
    pub late_fee_paid: i128,
    pub accrued_late_fee: i128,
    pub interest_rate_bps: u32,
    pub due_date: u32,
    pub last_interest_ledger: u32,
    pub last_late_fee_ledger: u32,
    pub status: LoanStatus,
    pub interest_residual: i128,
    // How many extensions have been granted for this loan.
    // Capped at MaxExtensions to prevent indefinite deferral.
    pub extension_count: u32,
    pub term_ledgers: u32,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    NftContract,
    LendingPool,
    Token,
    Admin,
    Loan(u32),
    LoanCounter,
    MinScore,
    MinRepaymentAmount,
    MaxLoanAmount,
    MaxLoansPerBorrower,
    BorrowerLoanCount(Address),
    BorrowerLoans(Address),
    Paused,
    PausedAtLedger,
    InterestRateBps,
    DefaultTermLedgers,
    Version,
    LateFeeRateBps,
    MinTermLedgers,
    MaxTermLedgers,
    Collateral(u32),
    GracePeriodLedgers,
    DefaultWindowLedgers,
    RateOracle,
    ProposedAdmin,
    LiquidationThresholdBps,
    LiquidationBonusBps,
    MinRateBps,
    MaxRateBps,
    MigratedVersion,
    /// Optional governance contract permitted to replace the admin once set.
    Governance,
}

#[contract]
pub struct LoanManager;

#[contractimpl]
impl LoanManager {
    const INSTANCE_TTL_THRESHOLD: u32 = 17280;
    const INSTANCE_TTL_BUMP: u32 = 518400;
    const PERSISTENT_TTL_THRESHOLD: u32 = 17280;
    const PERSISTENT_TTL_BUMP: u32 = 518400;
    const DEFAULT_INTEREST_RATE_BPS: u32 = 1200;
    const DEFAULT_TERM_LEDGERS: u32 = 17280;
    const CURRENT_VERSION: u32 = 4;
    const DEFAULT_LATE_FEE_RATE_BPS: u32 = 500;
    const MAX_LATE_FEE_CAP_BPS: u32 = 2500;
    const DEFAULT_MAX_LOAN_AMOUNT: i128 = 50_000;
    const DEFAULT_MAX_LOANS_PER_BORROWER: u32 = 3;
    const DEFAULT_GRACE_PERIOD_LEDGERS: u32 = 4_320;
    const DEFAULT_DEFAULT_WINDOW_LEDGERS: u32 = Self::DEFAULT_TERM_LEDGERS;
    const DEFAULT_LIQUIDATION_THRESHOLD_BPS: u32 = 15_000;
    const DEFAULT_LIQUIDATION_BONUS_BPS: u32 = 500;
    const MAX_LIQUIDATION_BONUS_BPS: u32 = 2000; // 20% cap on liquidation bonus
    const MIN_COLLATERAL_RATIO_BPS: i128 = 10_000;
    const MAX_RATIO_BPS: u32 = 10_000;
    const LATE_REPAYMENT_SCORE_PENALTY: i32 = 10;
    const DEFAULT_SCORE_PENALTY_POINTS: u32 = 50;
    const NFT_MAX_SCORE: u32 = 850;
    const DEFAULT_MIN_REPAYMENT_AMOUNT: i128 = 100;
    const MAX_EXTENSIONS: u32 = 3;
    const EXTENSION_FEE_BPS: u32 = 100; // 1% of remaining principal
    /// Default minimum interest rate (configurable via set_rate_bounds). #631
    const MIN_RATE_BPS: u32 = 1; // Minimum 0.01% interest rate
    /// Default maximum interest rate (configurable via set_rate_bounds). #631
    const MAX_RATE_BPS: u32 = 100_000; // Maximum 1000% interest rate
    const MAX_PENALTY_MULTIPLIER: i128 = 2; // Total debt cannot exceed 2x original principal

    fn bump_instance_ttl(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(Self::INSTANCE_TTL_THRESHOLD, Self::INSTANCE_TTL_BUMP);
    }

    fn bump_persistent_ttl(env: &Env, key: &DataKey) {
        env.storage().persistent().extend_ttl(
            key,
            Self::PERSISTENT_TTL_THRESHOLD,
            Self::PERSISTENT_TTL_BUMP,
        );
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    // fn get_admin(env: &Env) -> Address {
    //     env.storage()
    //         .instance()
    //         .get(&DataKey::Admin)
    //         .expect("not initialized")
    // }

    fn nft_contract(env: &Env) -> Address {
        Self::bump_instance_ttl(env);
        env.storage()
            .instance()
            .get(&DataKey::NftContract)
            .expect("not initialized")
    }

    fn admin(env: &Env) -> Address {
        Self::bump_instance_ttl(env);
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized")
    }

    fn lending_pool(env: &Env) -> Address {
        Self::bump_instance_ttl(env);
        env.storage()
            .instance()
            .get(&DataKey::LendingPool)
            .expect("not initialized")
    }

    fn loan_counter(env: &Env) -> u32 {
        Self::bump_instance_ttl(env);
        env.storage()
            .instance()
            .get(&DataKey::LoanCounter)
            .unwrap_or(0)
    }

    fn read_interest_rate(env: &Env) -> u32 {
        Self::bump_instance_ttl(env);
        let configured_rate = env
            .storage()
            .instance()
            .get(&DataKey::InterestRateBps)
            .unwrap_or(Self::DEFAULT_INTEREST_RATE_BPS);

        if configured_rate == 0 {
            Self::DEFAULT_INTEREST_RATE_BPS
        } else {
            configured_rate
        }
    }

    fn compute_interest_rate(env: &Env, borrower: &Address, amount: i128, score: u32) -> u32 {
        if let Some(oracle_addr) = env
            .storage()
            .instance()
            .get::<_, Address>(&DataKey::RateOracle)
        {
            let client = RateOracleClient::new(env, &oracle_addr);
            let oracle_rate = client.get_rate(borrower, &amount, &score);

            // Bounds-check the oracle response (#631): a compromised or stale oracle
            // cannot grant free loans (rate=0) or cause instant defaults (extreme rate).
            // Falls back to the configured default rate rather than reverting the tx.
            let min_rate = Self::min_rate_bps(env);
            let max_rate = Self::max_rate_bps(env);

            if oracle_rate < min_rate || oracle_rate > max_rate {
                Self::read_interest_rate(env)
            } else {
                oracle_rate
            }
        } else {
            Self::read_interest_rate(env)
        }
    }

    fn min_rate_bps(env: &Env) -> u32 {
        Self::bump_instance_ttl(env);
        env.storage()
            .instance()
            .get(&DataKey::MinRateBps)
            .unwrap_or(Self::MIN_RATE_BPS)
    }

    fn max_rate_bps(env: &Env) -> u32 {
        Self::bump_instance_ttl(env);
        env.storage()
            .instance()
            .get(&DataKey::MaxRateBps)
            .unwrap_or(Self::MAX_RATE_BPS)
    }

    fn read_default_term(env: &Env) -> u32 {
        Self::bump_instance_ttl(env);
        env.storage()
            .instance()
            .get(&DataKey::DefaultTermLedgers)
            .unwrap_or(Self::DEFAULT_TERM_LEDGERS)
    }

    /// Lower bound of the permitted loan-term window, in ledgers.
    ///
    /// Defaults to `0` (no floor) and `u32::MAX` (no ceiling) respectively, which is
    /// what `set_term_limits` and the individual setters already assume when they
    /// validate a partial update. The `get_*_term_ledgers` accessors previously
    /// reported `DEFAULT_TERM_LEDGERS` for an unset window, so the value the contract
    /// advertised disagreed with the value it enforced.
    fn min_term_ledgers(env: &Env) -> u32 {
        Self::bump_instance_ttl(env);
        env.storage()
            .instance()
            .get(&DataKey::MinTermLedgers)
            .unwrap_or(0)
    }

    /// Upper bound of the permitted loan-term window, in ledgers.
    fn max_term_ledgers(env: &Env) -> u32 {
        Self::bump_instance_ttl(env);
        env.storage()
            .instance()
            .get(&DataKey::MaxTermLedgers)
            .unwrap_or(u32::MAX)
    }

    fn require_not_paused(env: &Env) -> Result<(), LoanError> {
        Self::bump_instance_ttl(env);
        let paused: bool = env
            .storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false);
        if paused {
            return Err(LoanError::ContractPaused);
        }
        // Cascade: also check whether the LendingPool is paused.
        if let Some(pool_addr) = env
            .storage()
            .instance()
            .get::<_, Address>(&DataKey::LendingPool)
        {
            let pool_client = PoolClient::new(env, &pool_addr);
            if pool_client.is_paused() {
                return Err(LoanError::PoolPaused);
            }
        }
        // Cascade: also check whether the RemittanceNFT is paused.
        if let Some(nft_addr) = env
            .storage()
            .instance()
            .get::<_, Address>(&DataKey::NftContract)
        {
            let nft_client = NftClient::new(env, &nft_addr);
            if nft_client.is_paused() {
                return Err(LoanError::NftPaused);
            }
        }
        Ok(())
    }

    fn remaining_principal(loan: &Loan) -> i128 {
        loan.amount
            .checked_sub(loan.principal_paid)
            .expect("principal paid exceeds amount")
    }

    /// The term, in ledgers, that this loan's interest and late-fee rates are
    /// quoted per.
    ///
    /// Both rates are *per-term* rates, so the accrual denominator has to be the
    /// term this particular loan was written on. Accrual previously divided by the
    /// compile-time `DEFAULT_TERM_LEDGERS` constant regardless of the loan's own
    /// term, which decoupled the rate the borrower agreed to from the rate they were
    /// charged: a loan written on a term twice the constant accrued interest at
    /// twice the agreed rate (and late fees likewise), while one written on a
    /// shorter term under-charged. The due date came from `loan.term_ledgers` while
    /// the charge came from the constant, so the two could not stay in step.
    ///
    /// `term_ledgers` is validated as non-zero at request and set at approval, so
    /// this invariant holds for every loan that can accrue.
    fn loan_term_ledgers(loan: &Loan) -> i128 {
        assert!(
            loan.term_ledgers > 0,
            "loan term must be set before accrual"
        );
        loan.term_ledgers as i128
    }

    fn accrue_interest(env: &Env, loan: &mut Loan) -> Result<(), LoanError> {
        if loan.status != LoanStatus::Approved {
            return Ok(());
        }

        let current_ledger = env.ledger().sequence();
        if loan.last_interest_ledger == 0 || current_ledger <= loan.last_interest_ledger {
            return Ok(());
        }

        let remaining_principal = Self::remaining_principal(loan);
        if remaining_principal <= 0 {
            loan.last_interest_ledger = current_ledger;
            return Ok(());
        }

        let elapsed_ledgers = current_ledger - loan.last_interest_ledger;
        const PRECISION: i128 = 1_000_000;

        // Calculate interest with high precision. Intermediate values are checked for overflow.
        let numerator = remaining_principal
            .checked_mul(loan.interest_rate_bps as i128)
            .and_then(|v| v.checked_mul(elapsed_ledgers as i128))
            .and_then(|v| v.checked_mul(PRECISION))
            .ok_or(LoanError::AmountTooLarge)?;

        let denominator = 10_000i128
            .checked_mul(Self::loan_term_ledgers(loan))
            .ok_or(LoanError::AmountTooLarge)?;

        let total_interest = numerator / denominator;
        let interest_delta = total_interest / PRECISION;
        let new_residual = total_interest % PRECISION;

        // Add the previous residual to the new calculation
        let combined_residual = loan.interest_residual + new_residual;
        let additional_interest = combined_residual / PRECISION;
        let final_residual = combined_residual % PRECISION;

        let total_accrued_delta = interest_delta
            .checked_add(additional_interest)
            .ok_or(LoanError::AmountTooLarge)?;

        loan.accrued_interest = loan
            .accrued_interest
            .checked_add(total_accrued_delta)
            .ok_or(LoanError::AmountTooLarge)?;
        loan.interest_residual = final_residual;
        loan.last_interest_ledger = current_ledger;

        Ok(())
    }

    fn late_fee_rate_bps(env: &Env) -> u32 {
        Self::bump_instance_ttl(env);
        env.storage()
            .instance()
            .get(&DataKey::LateFeeRateBps)
            .unwrap_or(Self::DEFAULT_LATE_FEE_RATE_BPS)
            .min(Self::MAX_LATE_FEE_CAP_BPS)
    }

    fn liquidation_threshold_bps(env: &Env) -> u32 {
        Self::bump_instance_ttl(env);
        env.storage()
            .instance()
            .get(&DataKey::LiquidationThresholdBps)
            .unwrap_or(Self::DEFAULT_LIQUIDATION_THRESHOLD_BPS)
    }

    fn liquidation_bonus_bps(env: &Env) -> u32 {
        Self::bump_instance_ttl(env);
        env.storage()
            .instance()
            .get(&DataKey::LiquidationBonusBps)
            .unwrap_or(Self::DEFAULT_LIQUIDATION_BONUS_BPS)
    }

    fn validate_late_fee_rate(rate_bps: u32) -> Result<(), LoanError> {
        if rate_bps > Self::MAX_LATE_FEE_CAP_BPS {
            return Err(LoanError::InvalidRate);
        }
        Ok(())
    }

    fn validate_liquidation_threshold(ratio_bps: u32) -> Result<(), LoanError> {
        if (ratio_bps as i128) < Self::MIN_COLLATERAL_RATIO_BPS {
            return Err(LoanError::InvalidConfiguration);
        }
        Ok(())
    }

    fn validate_liquidation_bonus_bps(bonus_bps: u32) -> Result<(), LoanError> {
        if bonus_bps > Self::MAX_LIQUIDATION_BONUS_BPS {
            return Err(LoanError::InvalidConfiguration);
        }
        Ok(())
    }

    fn is_collateral_ratio_below_threshold(
        collateral_amount: i128,
        total_debt: i128,
        threshold_bps: u32,
    ) -> bool {
        if total_debt <= 0 {
            return false;
        }

        if collateral_amount <= 0 {
            return true;
        }

        collateral_amount
            .checked_mul(Self::MAX_RATIO_BPS as i128)
            .expect("collateral ratio overflow")
            < total_debt
                .checked_mul(threshold_bps as i128)
                .expect("collateral ratio overflow")
    }

    fn current_ratio_bps(collateral_amount: i128, total_debt: i128) -> u32 {
        if total_debt <= 0 || collateral_amount <= 0 {
            return 0;
        }

        let ratio = collateral_amount
            .checked_mul(Self::MAX_RATIO_BPS as i128)
            .expect("collateral ratio overflow")
            / total_debt;

        ratio.min(u32::MAX as i128) as u32
    }

    fn token(env: &Env) -> Address {
        Self::bump_instance_ttl(env);
        env.storage()
            .instance()
            .get(&DataKey::Token)
            .expect("not initialized")
    }

    fn grace_period_ledgers(env: &Env) -> u32 {
        Self::bump_instance_ttl(env);
        env.storage()
            .instance()
            .get(&DataKey::GracePeriodLedgers)
            .unwrap_or(Self::DEFAULT_GRACE_PERIOD_LEDGERS)
    }

    fn default_window_ledgers(env: &Env) -> u32 {
        Self::bump_instance_ttl(env);
        env.storage()
            .instance()
            .get(&DataKey::DefaultWindowLedgers)
            .unwrap_or(Self::DEFAULT_DEFAULT_WINDOW_LEDGERS)
    }

    fn max_loan_amount(env: &Env) -> i128 {
        Self::bump_instance_ttl(env);
        env.storage()
            .instance()
            .get(&DataKey::MaxLoanAmount)
            .unwrap_or(Self::DEFAULT_MAX_LOAN_AMOUNT)
    }

    fn max_loans_per_borrower(env: &Env) -> u32 {
        Self::bump_instance_ttl(env);
        env.storage()
            .instance()
            .get(&DataKey::MaxLoansPerBorrower)
            .unwrap_or(Self::DEFAULT_MAX_LOANS_PER_BORROWER)
    }

    fn min_repayment_amount(env: &Env) -> i128 {
        Self::bump_instance_ttl(env);
        env.storage()
            .instance()
            .get(&DataKey::MinRepaymentAmount)
            .unwrap_or(Self::DEFAULT_MIN_REPAYMENT_AMOUNT)
    }

    /// Principal currently deployed, read from the LendingPool.
    ///
    /// The pool owns this counter: it is the contract that actually parts with
    /// the funds, and it updates the value inside `disburse` and
    /// `settle_outstanding`. This contract must not keep a second copy — two
    /// counters describing the same quantity drift apart, and a stale copy
    /// silently corrupts the liquidity check that depends on it.
    fn pool_outstanding(env: &Env, token: &Address) -> i128 {
        let pool = Self::lending_pool(env);
        PoolClient::new(env, &pool).get_total_outstanding(token)
    }

    fn borrower_loan_count(env: &Env, borrower: &Address) -> u32 {
        let key = DataKey::BorrowerLoanCount(borrower.clone());
        if env.storage().persistent().has(&key) {
            let count = env.storage().persistent().get(&key).unwrap_or(0u32);
            Self::bump_persistent_ttl(env, &key);
            count
        } else {
            0
        }
    }

    fn increment_borrower_loan_count(env: &Env, borrower: &Address) {
        let key = DataKey::BorrowerLoanCount(borrower.clone());
        let current_count = Self::borrower_loan_count(env, borrower);
        let next_count = current_count
            .checked_add(1)
            .expect("borrower loan count overflow");
        env.storage().persistent().set(&key, &next_count);
        Self::bump_persistent_ttl(env, &key);
    }

    fn decrement_borrower_loan_count(env: &Env, borrower: &Address) {
        let key = DataKey::BorrowerLoanCount(borrower.clone());
        let current_count = Self::borrower_loan_count(env, borrower);
        if current_count == 0 {
            return;
        }
        let next_count = current_count - 1;
        env.storage().persistent().set(&key, &next_count);
        Self::bump_persistent_ttl(env, &key);
    }

    fn accrue_late_fee(env: &Env, loan: &mut Loan) -> i128 {
        if loan.status != LoanStatus::Approved {
            return 0;
        }

        let current_ledger = env.ledger().sequence();
        if loan.due_date == 0 {
            return 0;
        }

        let grace_ends = loan
            .due_date
            .checked_add(Self::grace_period_ledgers(env))
            .expect("grace period overflow");
        if current_ledger <= grace_ends {
            return 0;
        }

        let late_fee_start = loan.last_late_fee_ledger.max(grace_ends);
        if current_ledger <= late_fee_start {
            return 0;
        }

        let remaining_principal = Self::remaining_principal(loan);

        // Stop accruing fees if principal is fully paid
        if remaining_principal <= 0 {
            loan.last_late_fee_ledger = current_ledger;
            return 0;
        }

        let overdue_ledgers = current_ledger - late_fee_start;
        // The late-fee rate is quoted per term, so it deflates over the same term the
        // loan was written on -- reading the same field interest accrual uses.
        let term_ledgers = Self::loan_term_ledgers(loan);
        // Late fee is calculated on original principal amount only, not remaining debt.
        // This ensures the 25% late fee cap is meaningful regardless of payment state.
        let incremental_fee = loan
            .amount
            .checked_mul(Self::late_fee_rate_bps(env) as i128)
            .and_then(|value| value.checked_mul(overdue_ledgers as i128))
            .and_then(|value| value.checked_div(10_000))
            .and_then(|value| value.checked_div(term_ledgers))
            .expect("late fee overflow");

        // Global debt cap: Total outstanding (principal + interest + late fees)
        // cannot exceed original_principal * MAX_PENALTY_MULTIPLIER.
        let max_total_debt = loan
            .amount
            .checked_mul(Self::MAX_PENALTY_MULTIPLIER)
            .expect("debt cap overflow");

        let current_total_debt = remaining_principal
            .checked_add(loan.accrued_interest)
            .expect("debt overflow")
            .checked_add(loan.accrued_late_fee)
            .expect("debt overflow");

        let remaining_fee_capacity = max_total_debt.checked_sub(current_total_debt).unwrap_or(0);

        let charged_fee = if remaining_fee_capacity <= 0 {
            0
        } else {
            incremental_fee.min(remaining_fee_capacity)
        };

        if charged_fee > 0 {
            loan.accrued_late_fee = loan
                .accrued_late_fee
                .checked_add(charged_fee)
                .expect("late fee overflow");
        }
        loan.last_late_fee_ledger = current_ledger;
        charged_fee
    }

    fn current_total_debt(env: &Env, loan: &mut Loan) -> Result<(i128, i128), LoanError> {
        Self::accrue_interest(env, loan)?;
        let late_fee_delta = Self::accrue_late_fee(env, loan);
        let total_debt = Self::remaining_principal(loan)
            .checked_add(loan.accrued_interest)
            .and_then(|value| value.checked_add(loan.accrued_late_fee))
            .expect("debt overflow");
        Ok((total_debt, late_fee_delta))
    }

    /// Split a repayment across principal, interest, and late fees based on
    /// each component's share of the current total debt. This avoids a strict
    /// waterfall where a borrower can repeatedly clear one bucket first while
    /// delaying principal reduction.
    fn proportional_repayment_split(loan: &Loan, amount: i128) -> (i128, i128, i128) {
        let principal_due = Self::remaining_principal(loan);
        let total_debt = principal_due
            .checked_add(loan.accrued_interest)
            .and_then(|value| value.checked_add(loan.accrued_late_fee))
            .expect("debt overflow");

        if total_debt == 0 {
            return (0, 0, 0);
        }

        let dues = [principal_due, loan.accrued_interest, loan.accrued_late_fee];
        let mut payments = [0i128; 3];
        let mut remainders = [-1i128; 3];
        let mut allocated = 0i128;

        for idx in 0..3 {
            let due = dues[idx];
            if due <= 0 {
                continue;
            }

            let scaled = amount
                .checked_mul(due)
                .expect("repayment allocation overflow");
            let payment = scaled
                .checked_div(total_debt)
                .expect("repayment allocation underflow");

            payments[idx] = payment;
            remainders[idx] = scaled
                .checked_rem(total_debt)
                .expect("repayment allocation underflow");
            allocated = allocated
                .checked_add(payment)
                .expect("repayment allocation overflow");
        }

        let mut unallocated = amount
            .checked_sub(allocated)
            .expect("repayment allocation underflow");

        while unallocated > 0 {
            let mut selected: Option<usize> = None;

            for idx in 0..3 {
                if dues[idx] <= payments[idx] || remainders[idx] < 0 {
                    continue;
                }

                match selected {
                    None => selected = Some(idx),
                    Some(current) => {
                        if remainders[idx] > remainders[current] {
                            selected = Some(idx);
                        }
                    }
                }
            }

            let idx = selected.expect("repayment allocation exhausted");
            payments[idx] = payments[idx]
                .checked_add(1)
                .expect("repayment allocation overflow");
            remainders[idx] = -1;
            unallocated -= 1;
        }

        let principal_payment = payments[0];
        let interest_payment = payments[1];
        let late_fee_payment = payments[2];

        (principal_payment, interest_payment, late_fee_payment)
    }

    fn apply_debt_recovery(loan: &mut Loan, amount: i128) {
        if amount <= 0 {
            return;
        }

        let (principal_payment, interest_payment, late_fee_payment) =
            Self::proportional_repayment_split(loan, amount);

        loan.interest_paid = loan
            .interest_paid
            .checked_add(interest_payment)
            .expect("interest paid overflow");
        loan.accrued_interest = loan
            .accrued_interest
            .checked_sub(interest_payment)
            .expect("interest underflow");
        loan.late_fee_paid = loan
            .late_fee_paid
            .checked_add(late_fee_payment)
            .expect("late fee paid overflow");
        loan.accrued_late_fee = loan
            .accrued_late_fee
            .checked_sub(late_fee_payment)
            .expect("late fee underflow");
        loan.principal_paid = loan
            .principal_paid
            .checked_add(principal_payment)
            .expect("principal paid overflow");
    }

    fn collateral_amount(env: &Env, loan_id: u32) -> i128 {
        let loan_key = DataKey::Loan(loan_id);
        if let Some(loan) = env.storage().persistent().get::<DataKey, Loan>(&loan_key) {
            Self::bump_persistent_ttl(env, &loan_key);
            loan.collateral_amount
        } else {
            0
        }
    }

    fn release_collateral_internal(env: &Env, loan_id: u32, recipient: &Address) {
        use soroban_sdk::token::TokenClient;

        let loan_key = DataKey::Loan(loan_id);
        let mut loan: Loan = env
            .storage()
            .persistent()
            .get(&loan_key)
            .unwrap_or_else(|| panic!("loan not found"));

        let collateral = loan.collateral_amount;
        if collateral <= 0 {
            return;
        }

        loan.collateral_amount = 0;
        env.storage().persistent().set(&loan_key, &loan);
        Self::bump_persistent_ttl(env, &loan_key);

        let token: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .expect("token not set");
        let token_client = TokenClient::new(env, &token);
        token_client.transfer(&env.current_contract_address(), recipient, &collateral);

        // Emit collateral returned event
        events::collateral_returned(env, recipient.clone(), loan_id, collateral);
    }

    fn seize_collateral_internal(env: &Env, loan_id: u32) {
        use soroban_sdk::token::TokenClient;

        let loan_key = DataKey::Loan(loan_id);
        let mut loan: Loan = env
            .storage()
            .persistent()
            .get(&loan_key)
            .unwrap_or_else(|| panic!("loan not found"));

        let collateral = loan.collateral_amount;
        if collateral <= 0 {
            return;
        }

        loan.collateral_amount = 0;
        env.storage().persistent().set(&loan_key, &loan);
        Self::bump_persistent_ttl(env, &loan_key);

        let token: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .expect("token not set");
        let lending_pool: Address = env
            .storage()
            .instance()
            .get(&DataKey::LendingPool)
            .expect("lending pool not set");
        let token_client = TokenClient::new(env, &token);
        token_client.transfer(&env.current_contract_address(), &lending_pool, &collateral);

        events::collateral_liquidated(env, loan_id, collateral);
    }

    pub fn initialize(
        env: Env,
        nft_contract: Address,
        lending_pool: Address,
        token: Address,
        admin: Address,
    ) -> Result<(), LoanError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(LoanError::AlreadyInitialized);
        }
        Self::validate_late_fee_rate(Self::DEFAULT_LATE_FEE_RATE_BPS)?;
        Self::validate_liquidation_threshold(Self::DEFAULT_LIQUIDATION_THRESHOLD_BPS)?;
        Self::validate_liquidation_bonus_bps(Self::DEFAULT_LIQUIDATION_BONUS_BPS)?;
        env.storage()
            .instance()
            .set(&DataKey::NftContract, &nft_contract);
        env.storage()
            .instance()
            .set(&DataKey::LendingPool, &lending_pool);
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::LoanCounter, &0u32);
        env.storage().instance().set(&DataKey::Paused, &false);

        let nft_client = NftClient::new(&env, &nft_contract);
        if !nft_client.is_authorized_minter(&env.current_contract_address()) {
            panic!("LoanManager must be authorized minter on NFT contract");
        }
        env.storage()
            .instance()
            .set(&DataKey::Version, &Self::CURRENT_VERSION);
        env.storage()
            .instance()
            .set(&DataKey::MaxLoanAmount, &Self::DEFAULT_MAX_LOAN_AMOUNT);
        env.storage().instance().set(
            &DataKey::MaxLoansPerBorrower,
            &Self::DEFAULT_MAX_LOANS_PER_BORROWER,
        );
        env.storage()
            .instance()
            .set(&DataKey::LateFeeRateBps, &Self::DEFAULT_LATE_FEE_RATE_BPS);
        env.storage().instance().set(
            &DataKey::GracePeriodLedgers,
            &Self::DEFAULT_GRACE_PERIOD_LEDGERS,
        );
        env.storage().instance().set(
            &DataKey::DefaultWindowLedgers,
            &Self::DEFAULT_DEFAULT_WINDOW_LEDGERS,
        );
        env.storage().instance().set(
            &DataKey::LiquidationThresholdBps,
            &Self::DEFAULT_LIQUIDATION_THRESHOLD_BPS,
        );
        env.storage().instance().set(
            &DataKey::LiquidationBonusBps,
            &Self::DEFAULT_LIQUIDATION_BONUS_BPS,
        );
        env.storage()
            .instance()
            .set(&DataKey::MinRateBps, &Self::MIN_RATE_BPS);
        env.storage()
            .instance()
            .set(&DataKey::MaxRateBps, &Self::MAX_RATE_BPS);
        Self::bump_instance_ttl(&env);
        Ok(())
    }

    pub fn version(env: Env) -> u32 {
        Self::bump_instance_ttl(&env);
        env.storage().instance().get(&DataKey::Version).unwrap_or(0)
    }

    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        Self::admin(&env).require_auth();
        let old_version = Self::version(env.clone());
        let new_version = old_version.saturating_add(1);
        env.storage()
            .instance()
            .set(&DataKey::Version, &new_version);
        env.events().publish(
            (Symbol::new(&env, "ContractUpgraded"),),
            (old_version, new_version),
        );
        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }

    pub fn migrate(env: Env) {
        Self::admin(&env).require_auth();

        // Migration guard: prevent double-execution for the same version
        let last_migrated_version: u32 = env
            .storage()
            .instance()
            .get(&DataKey::MigratedVersion)
            .unwrap_or(0);

        // If already migrated to this version or later, skip
        if last_migrated_version >= Self::CURRENT_VERSION {
            return;
        }

        // Initialize new storage keys with defaults if they don't exist
        if !env.storage().instance().has(&DataKey::LateFeeRateBps) {
            env.storage()
                .instance()
                .set(&DataKey::LateFeeRateBps, &Self::DEFAULT_LATE_FEE_RATE_BPS);
        }
        if !env
            .storage()
            .instance()
            .has(&DataKey::LiquidationThresholdBps)
        {
            env.storage().instance().set(
                &DataKey::LiquidationThresholdBps,
                &Self::DEFAULT_LIQUIDATION_THRESHOLD_BPS,
            );
        }
        if !env.storage().instance().has(&DataKey::LiquidationBonusBps) {
            env.storage().instance().set(
                &DataKey::LiquidationBonusBps,
                &Self::DEFAULT_LIQUIDATION_BONUS_BPS,
            );
        }

        // Initialize rate bounds if they don't exist
        if !env.storage().instance().has(&DataKey::MinRateBps) {
            env.storage()
                .instance()
                .set(&DataKey::MinRateBps, &Self::MIN_RATE_BPS);
        }
        if !env.storage().instance().has(&DataKey::MaxRateBps) {
            env.storage()
                .instance()
                .set(&DataKey::MaxRateBps, &Self::MAX_RATE_BPS);
        }

        let late_fee_rate = Self::late_fee_rate_bps(&env);
        env.storage()
            .instance()
            .set(&DataKey::LateFeeRateBps, &late_fee_rate);

        // Update contract version and mark migration as complete.
        //
        // `Version` is only moved forwards: `upgrade` advances it independently of
        // migration, so a contract upgraded twice without migrating in between holds a
        // version above `CURRENT_VERSION`, and stamping `CURRENT_VERSION` unconditionally
        // would move that backwards and misreport the deployed bytecode as older than it
        // is. `MigratedVersion` records what this migration applied, so it is set to the
        // version being migrated *to*.
        let stored_version = Self::version(env.clone());
        env.storage().instance().set(
            &DataKey::Version,
            &stored_version.max(Self::CURRENT_VERSION),
        );
        env.storage()
            .instance()
            .set(&DataKey::MigratedVersion, &Self::CURRENT_VERSION);
        Self::bump_instance_ttl(&env);
    }

    /// Request a new loan for `borrower`.
    ///
    /// Requires `borrower` authorization and the loan manager, lending pool,
    /// and NFT contract to be unpaused. The request starts in
    /// [`LoanStatus::Pending`] and counts toward the borrower's active-loan cap.
    /// Returns the new loan id.
    ///
    /// Returns [`LoanError::ContractPaused`], [`LoanError::PoolPaused`], or
    /// [`LoanError::NftPaused`] when pause checks fail; [`LoanError::InvalidAmount`]
    /// for non-positive amounts or amounts over the configured maximum;
    /// [`LoanError::InvalidTerm`] for a zero term or one outside the configured
    /// window; [`LoanError::NotInitialized`]
    /// when the NFT contract is missing; [`LoanError::InsufficientScore`] when
    /// the borrower's NFT score is too low; [`LoanError::SeizedBorrower`] when
    /// the borrower is flagged as seized; and [`LoanError::MaxLoansReached`]
    /// when the borrower is already at the loan limit.
    pub fn request_loan(
        env: Env,
        borrower: Address,
        amount: i128,
        term: u32,
    ) -> Result<u32, LoanError> {
        borrower.require_auth();
        Self::require_not_paused(&env)?;

        if amount <= 0 {
            return Err(LoanError::InvalidAmount);
        }

        let max_loan_amount = Self::max_loan_amount(&env);
        if amount > max_loan_amount {
            return Err(LoanError::InvalidAmount);
        }

        // The requested term is the one the borrower signs for, and approval honours
        // it, so it has to be validated here -- not merely checked for zero. A term
        // outside the configured window would otherwise become a loan outside it.
        if term == 0 {
            return Err(LoanError::InvalidTerm);
        }
        if term < Self::min_term_ledgers(&env) || term > Self::max_term_ledgers(&env) {
            return Err(LoanError::InvalidTerm);
        }

        let nft_contract: Address = env
            .storage()
            .instance()
            .get(&DataKey::NftContract)
            .ok_or(LoanError::NotInitialized)?;
        let nft_client = NftClient::new(&env, &nft_contract);

        let score = nft_client.get_score(&borrower);
        let min_score: u32 = env
            .storage()
            .instance()
            .get(&DataKey::MinScore)
            .unwrap_or(500);
        if score < min_score {
            return Err(LoanError::InsufficientScore);
        }
        if nft_client.is_seized(&borrower) {
            return Err(LoanError::SeizedBorrower);
        }

        let active_loan_count = Self::borrower_loan_count(&env, &borrower);
        let max_loans_per_borrower = Self::max_loans_per_borrower(&env);
        if active_loan_count >= max_loans_per_borrower {
            return Err(LoanError::MaxLoansReached);
        }

        let mut loan_counter: u32 = env
            .storage()
            .instance()
            .get(&DataKey::LoanCounter)
            .unwrap_or(0);
        loan_counter += 1;

        let loan = Loan {
            borrower: borrower.clone(),
            amount,
            collateral_amount: 0,
            principal_paid: 0,
            interest_paid: 0,
            accrued_interest: 0,
            late_fee_paid: 0,
            accrued_late_fee: 0,
            interest_rate_bps: Self::compute_interest_rate(&env, &borrower, amount, score),
            due_date: 0,
            last_interest_ledger: 0,
            last_late_fee_ledger: 0,
            status: LoanStatus::Pending,
            interest_residual: 0,
            extension_count: 0,
            term_ledgers: term,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Loan(loan_counter), &loan);

        env.storage()
            .instance()
            .set(&DataKey::LoanCounter, &loan_counter);

        // Count pending loans against the borrower cap immediately.
        Self::increment_borrower_loan_count(&env, &borrower);

        Self::bump_instance_ttl(&env);
        Self::bump_persistent_ttl(&env, &DataKey::Loan(loan_counter));

        // Add loan ID to borrower's loan list
        let borrower_loans_key = DataKey::BorrowerLoans(borrower.clone());
        let mut borrower_loans: Vec<u32> = env
            .storage()
            .instance()
            .get(&borrower_loans_key)
            .unwrap_or(Vec::new(&env));
        borrower_loans.push_back(loan_counter);
        env.storage()
            .instance()
            .set(&borrower_loans_key, &borrower_loans);
        Self::bump_instance_ttl(&env);

        events::loan_requested(&env, loan_counter, borrower.clone(), amount);
        Ok(loan_counter)
    }

    /// Approve a pending loan and transfer principal to the borrower.
    ///
    /// Requires admin authorization and the loan manager, lending pool, and NFT
    /// contract to be unpaused. The target loan must be [`LoanStatus::Pending`];
    /// approval records the term the borrower requested, the due date derived from
    /// it, the interest/late-fee ledgers, and the total outstanding balance before
    /// transferring funds from the lending pool to the borrower.
    ///
    /// Returns [`LoanError::ContractPaused`], [`LoanError::PoolPaused`], or
    /// [`LoanError::NftPaused`] when pause checks fail; [`LoanError::LoanNotFound`]
    /// when `loan_id` is unknown; [`LoanError::LoanNotPending`] when the loan is
    /// not pending; and [`LoanError::InsufficientPoolLiquidity`] when available
    /// pool liquidity is below the loan amount.
    pub fn approve_loan(env: Env, loan_id: u32) -> Result<(), LoanError> {
        // ── CHECKS ──────────────────────────────────────────────────────────
        let admin = Self::admin(&env);
        admin.require_auth();
        Self::require_not_paused(&env)?;

        let loan_key = DataKey::Loan(loan_id);
        let mut loan: Loan = env
            .storage()
            .persistent()
            .get(&loan_key)
            .ok_or(LoanError::LoanNotFound)?;
        Self::bump_persistent_ttl(&env, &loan_key);

        if loan.status != LoanStatus::Pending {
            return Err(LoanError::LoanNotPending);
        }

        // Read all instance-level config before any state mutations.
        let lending_pool: Address = env
            .storage()
            .instance()
            .get(&DataKey::LendingPool)
            .expect("lending pool not set");
        let token: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .expect("token not set");

        // Cross-contract READ for liquidity check — still in the CHECKS phase.
        //
        // `pool_balance` is the pool's *idle* token balance: disbursed principal
        // has already left the pool's account, so the outstanding balance is not
        // subtracted here. Doing so double-counted deployed principal, and a test
        // asserting the old behaviour is what locked the bug in.
        let pool_client = PoolClient::new(&env, &lending_pool);
        let idle_liquidity = pool_client.pool_balance(&token);
        if idle_liquidity < loan.amount {
            return Err(LoanError::InsufficientPoolLiquidity);
        }

        // ── EFFECTS (all state mutations before any external calls) ─────────
        // Capture values used in the transfer before mutating loan fields.
        let borrower = loan.borrower.clone();
        let transfer_amount = loan.amount;

        // Honour the term the borrower requested and signed for. This previously
        // overwrote `loan.term_ledgers` with the mutable global default, silently
        // substituting a different loan than the one requested: the wizard offers
        // 30/60/90-day terms and shows that term back to the borrower before they
        // sign, while approval forced the default (one term) instead. Because
        // interest and late fees are quoted per term, the substitution also repriced
        // the loan away from the rate shown at request time.
        if loan.term_ledgers == 0 {
            // Defensive: `request_loan` rejects a zero term, so this is unreachable
            // for any loan created through the normal path. A zero here would make
            // the loan instantly overdue.
            return Err(LoanError::InvalidTerm);
        }
        loan.status = LoanStatus::Approved;
        loan.due_date = env
            .ledger()
            .sequence()
            .checked_add(loan.term_ledgers)
            .expect("due date overflow");
        loan.last_interest_ledger = env.ledger().sequence();
        loan.last_late_fee_ledger = loan
            .due_date
            .checked_add(Self::grace_period_ledgers(&env))
            .expect("grace period overflow");
        // Commit state before any cross-contract call (CEI pattern).
        env.storage().persistent().set(&loan_key, &loan);
        Self::bump_persistent_ttl(&env, &loan_key);

        // ── INTERACTIONS (external calls last) ──────────────────────────────
        // The pool moves its own principal. This previously read
        // `token.transfer(&lending_pool, &borrower, ..)`, which can never be
        // authorised on-chain: the pool is not in this call stack, and a contract
        // address authorises only implicitly. `disburse` makes the pool the
        // executing contract, so its implicit authorisation applies.
        pool_client.disburse(&token, &borrower, &transfer_amount);

        events::loan_approved(
            &env,
            loan_id,
            borrower.clone(),
            loan.interest_rate_bps,
            loan.term_ledgers,
        );
        events::loan_approved_by_admin(&env, admin, loan_id, borrower);

        Ok(())
    }

    /// The loan exactly as it is stored.
    ///
    /// A pure read. The interest and late-fee figures are those as of the last
    /// state-changing call that touched this loan, together with the ledger markers
    /// recording when that was -- so a caller can always tell stored state from a
    /// projection. Use [`Self::get_loan_accrued`] for what the debt would be now.
    ///
    /// This previously accrued interest into a local copy and returned that copy without
    /// persisting it. The value it returned therefore described a state that did not
    /// exist -- `last_interest_ledger` advanced in the returned struct but not in storage
    /// -- and it could fail with `AmountTooLarge` for a loan that reads perfectly well.
    pub fn get_loan(env: Env, loan_id: u32) -> Result<Loan, LoanError> {
        let loan_key = DataKey::Loan(loan_id);
        let loan: Loan = env
            .storage()
            .persistent()
            .get(&loan_key)
            .ok_or(LoanError::LoanNotFound)?;
        Self::bump_persistent_ttl(&env, &loan_key);
        Ok(loan)
    }

    /// The loan with interest and late fees accrued up to the current ledger.
    ///
    /// The accrual runs over a copy and is deliberately *not* persisted: this is a view,
    /// and a view must not be able to mutate someone else's loan -- nor should reading a
    /// loan be a way to change it. Nothing is lost by not persisting, because accrual is
    /// a deterministic function of the stored ledger markers and the loan's own rate and
    /// term, so the next state-changing call derives exactly these figures again.
    pub fn get_loan_accrued(env: Env, loan_id: u32) -> Result<Loan, LoanError> {
        let loan_key = DataKey::Loan(loan_id);
        let mut loan: Loan = env
            .storage()
            .persistent()
            .get(&loan_key)
            .ok_or(LoanError::LoanNotFound)?;
        Self::bump_persistent_ttl(&env, &loan_key);
        Self::current_total_debt(&env, &mut loan)?;
        Ok(loan)
    }

    /// Repay part or all of an approved loan.
    ///
    /// Requires `borrower` authorization and the loan manager, lending pool,
    /// and NFT contract to be unpaused. The loan must be [`LoanStatus::Approved`]
    /// and owned by `borrower`. The repayment is split proportionally across
    /// principal, accrued interest, and accrued late fees; if the remaining debt
    /// is at or below the configured minimum repayment amount, the final payment
    /// may forgive rounding dust and mark the loan [`LoanStatus::Repaid`].
    ///
    /// Returns [`LoanError::ContractPaused`], [`LoanError::PoolPaused`], or
    /// [`LoanError::NftPaused`] when pause checks fail; [`LoanError::InvalidAmount`]
    /// for non-positive amounts; [`LoanError::LoanNotFound`] when `loan_id` is
    /// unknown; [`LoanError::BorrowerMismatch`] when `borrower` does not own the
    /// loan; [`LoanError::LoanNotActive`] when the loan is not approved;
    /// [`LoanError::LoanPastDue`] after the default window; [`LoanError::AmountTooLarge`]
    /// if interest accrual overflows; and [`LoanError::RepaymentExceedsDebt`]
    /// when `amount` exceeds current debt.
    pub fn repay(env: Env, borrower: Address, loan_id: u32, amount: i128) -> Result<(), LoanError> {
        use soroban_sdk::token::TokenClient;

        borrower.require_auth();
        Self::require_not_paused(&env)?;
        Self::bump_instance_ttl(&env);

        if amount <= 0 {
            return Err(LoanError::InvalidAmount);
        }

        let loan_key = DataKey::Loan(loan_id);
        let mut loan: Loan = env
            .storage()
            .persistent()
            .get(&loan_key)
            .ok_or(LoanError::LoanNotFound)?;
        Self::bump_persistent_ttl(&env, &loan_key);

        if loan.borrower != borrower {
            return Err(LoanError::BorrowerMismatch);
        }

        if loan.status != LoanStatus::Approved {
            return Err(LoanError::LoanNotActive);
        }

        // Allow repayment until end of default window
        let current_ledger = env.ledger().sequence();
        let default_ends = loan
            .due_date
            .checked_add(Self::default_window_ledgers(&env))
            .expect("default window overflow");
        if current_ledger > default_ends {
            return Err(LoanError::LoanPastDue);
        }

        let (total_debt, late_fee_delta) = Self::current_total_debt(&env, &mut loan)?;
        if amount > total_debt {
            return Err(LoanError::RepaymentExceedsDebt);
        }

        let min_repayment_amount = Self::min_repayment_amount(&env);

        // Allow below-minimum repayment only when it fully clears the remaining debt
        // or when the remaining debt itself is just small rounding dust.
        let is_rounding_dust_forgiveness = total_debt <= min_repayment_amount;

        if amount < total_debt && amount < min_repayment_amount && !is_rounding_dust_forgiveness {
            panic!("repayment amount below minimum");
        }

        let token: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .expect("token not set");
        let lending_pool: Address = env
            .storage()
            .instance()
            .get(&DataKey::LendingPool)
            .expect("lending pool not set");

        let (principal_payment, interest_payment, late_fee_payment) =
            Self::proportional_repayment_split(&loan, amount);

        loan.interest_paid = loan
            .interest_paid
            .checked_add(interest_payment)
            .expect("interest paid overflow");
        loan.accrued_interest = loan
            .accrued_interest
            .checked_sub(interest_payment)
            .expect("interest underflow");
        loan.late_fee_paid = loan
            .late_fee_paid
            .checked_add(late_fee_payment)
            .expect("late fee paid overflow");
        loan.accrued_late_fee = loan
            .accrued_late_fee
            .checked_sub(late_fee_payment)
            .expect("late fee underflow");
        loan.principal_paid = loan
            .principal_paid
            .checked_add(principal_payment)
            .expect("principal paid overflow");

        let was_late = env.ledger().sequence()
            > loan
                .due_date
                .checked_add(Self::grace_period_ledgers(&env))
                .expect("grace period overflow");

        let mut completed = false;

        let is_fully_repaid = loan.principal_paid == loan.amount
            && loan.accrued_interest == 0
            && loan.accrued_late_fee == 0;

        if is_rounding_dust_forgiveness && !is_fully_repaid {
            loan.accrued_interest = 0;
            loan.accrued_late_fee = 0;

            if loan.principal_paid < loan.amount {
                loan.principal_paid = loan.amount;
            }

            completed = true;
        } else if is_fully_repaid {
            completed = true;
        }

        if completed {
            // CEI: mark the loan as Repaid in state before any cross-contract call (#630).
            // A reentrant repay() on the same loan_id will now hit LoanNotActive and
            // revert, preventing double withdrawal of collateral.
            loan.status = LoanStatus::Repaid;
            Self::decrement_borrower_loan_count(&env, &loan.borrower);
        }

        // ── EFFECTS committed to storage before any cross-contract call ─────────
        env.storage().persistent().set(&loan_key, &loan);
        Self::bump_persistent_ttl(&env, &loan_key);

        // ── INTERACTIONS: external calls after state is durable (#630) ───────────
        let token_client = TokenClient::new(&env, &token);
        token_client.transfer(&borrower, &lending_pool, &amount);

        if completed {
            // Principal is back in the pool, so retire it from the pool's
            // outstanding balance. This is what makes LP share price rise by the
            // interest portion of the repayment and nothing else.
            let pool_client = PoolClient::new(&env, &lending_pool);
            pool_client.settle_outstanding(&token, &loan.amount);

            // release_collateral_internal reads collateral from storage and performs
            // its own CEI, so it is safe to call after the loan state is committed.
            Self::release_collateral_internal(&env, loan_id, &loan.borrower);
            // Emit terminal repayment event for completed loans.
            events::loan_repaid(&env, borrower.clone(), loan_id, amount);
        }

        if amount >= 100 {
            let nft_contract = Self::nft_contract(&env);
            let nft_client = NftClient::new(&env, &nft_contract);
            let borrower_score = nft_client.get_score(&borrower);
            if borrower_score > 0 {
                // get_score returns 0 for burned/non-existent NFTs
                //
                // Both writes are best-effort, and both happen after the borrower's money
                // has already moved. Letting one of them fail would revert a payment the
                // borrower made in good faith: a score recorder that is unset, or points
                // at a different contract, would make repaying impossible. A refusal
                // leaves the NFT's own state untouched and is reported below rather than
                // being silent.
                let manager = env.current_contract_address();
                let applied = if completed && was_late {
                    matches!(
                        nft_client.try_decrease_score(
                            &borrower,
                            &Self::LATE_REPAYMENT_SCORE_PENALTY.unsigned_abs(),
                            &Some(manager),
                        ),
                        Ok(Ok(()))
                    )
                } else if amount >= nft_client.get_min_repayment_amount() {
                    // Credit through `update_score`, the recorder-gated path that derives
                    // points from the repayment amount itself. This previously used
                    // `apply_score_delta`, which let the caller choose the number and was
                    // therefore open to any authorised minter; that path is now admin-only
                    // and unavailable here.
                    //
                    // The floor is checked explicitly rather than left to fail, because a
                    // configured minimum above the repayment amount would make repaying
                    // impossible. Below the floor no credit is due, which is not a refusal.
                    matches!(
                        nft_client.try_update_score(&borrower, &amount, &Some(manager)),
                        Ok(Ok(()))
                    )
                } else {
                    true
                };

                if !applied {
                    events::score_report_skipped(&env, borrower.clone(), amount);
                }
            }
        }

        if late_fee_delta > 0 {
            events::late_fee_charged(&env, loan_id, late_fee_delta);
        }

        // Emit repayment event only if loan is not completed (completed loans emit in the block above)
        if !completed {
            events::loan_repaid(&env, borrower, loan_id, amount);
        }

        Ok(())
    }

    /// Deposit collateral for an approved loan.
    ///
    /// Requires the borrower recorded on the loan to authorize, and requires the
    /// loan manager, lending pool, and NFT contract to be unpaused. The target
    /// loan must be [`LoanStatus::Approved`]. The collateral token transfer is
    /// made from the borrower to this contract, then the loan's collateral
    /// balance is increased.
    ///
    /// Returns [`LoanError::ContractPaused`], [`LoanError::PoolPaused`], or
    /// [`LoanError::NftPaused`] when pause checks fail; [`LoanError::InvalidAmount`]
    /// for non-positive amounts; [`LoanError::LoanNotFound`] when `loan_id` is
    /// unknown; [`LoanError::LoanNotActive`] when the loan is not approved;
    /// [`LoanError::NotInitialized`] when the NFT contract is missing; and
    /// [`LoanError::SeizedBorrower`] when the borrower is flagged as seized.
    pub fn deposit_collateral(env: Env, loan_id: u32, amount: i128) -> Result<(), LoanError> {
        use soroban_sdk::token::TokenClient;

        Self::require_not_paused(&env)?;

        if amount <= 0 {
            return Err(LoanError::InvalidAmount);
        }

        let loan_key = DataKey::Loan(loan_id);
        let loan: Loan = env
            .storage()
            .persistent()
            .get(&loan_key)
            .ok_or(LoanError::LoanNotFound)?;
        Self::bump_persistent_ttl(&env, &loan_key);

        if loan.status != LoanStatus::Approved {
            return Err(LoanError::LoanNotActive);
        }

        loan.borrower.require_auth();

        let nft_contract: Address = env
            .storage()
            .instance()
            .get(&DataKey::NftContract)
            .ok_or(LoanError::NotInitialized)?;
        let nft_client = NftClient::new(&env, &nft_contract);
        if nft_client.is_seized(&loan.borrower) {
            return Err(LoanError::SeizedBorrower);
        }

        let token: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .expect("token not set");
        let token_client = TokenClient::new(&env, &token);
        token_client.transfer(&loan.borrower, &env.current_contract_address(), &amount);

        let loan_key = DataKey::Loan(loan_id);
        let mut loan: Loan = env
            .storage()
            .persistent()
            .get(&loan_key)
            .expect("loan not found");

        let updated_collateral = loan
            .collateral_amount
            .checked_add(amount)
            .expect("collateral overflow");
        loan.collateral_amount = updated_collateral;
        env.storage().persistent().set(&loan_key, &loan);
        Self::bump_persistent_ttl(&env, &loan_key);

        events::collateral_deposited(&env, loan.borrower.clone(), loan_id, updated_collateral);

        Ok(())
    }

    pub fn release_collateral(env: Env, loan_id: u32) -> Result<(), LoanError> {
        let loan_key = DataKey::Loan(loan_id);
        let loan: Loan = env
            .storage()
            .persistent()
            .get(&loan_key)
            .ok_or(LoanError::LoanNotFound)?;
        Self::bump_persistent_ttl(&env, &loan_key);

        if loan.status != LoanStatus::Repaid {
            return Err(LoanError::LoanNotRepaid);
        }

        Self::release_collateral_internal(&env, loan_id, &loan.borrower);
        events::collateral_released(&env, loan.borrower, loan_id);

        Ok(())
    }

    pub fn get_collateral(env: Env, loan_id: u32) -> i128 {
        Self::collateral_amount(&env, loan_id)
    }

    /// Returns whether `loan_id` is currently eligible for liquidation.
    /// Non-`Approved` loans always return `false`.
    pub fn is_liquidatable(env: Env, loan_id: u32) -> Result<bool, LoanError> {
        let loan_key = DataKey::Loan(loan_id);
        let mut loan: Loan = env
            .storage()
            .persistent()
            .get(&loan_key)
            .ok_or(LoanError::LoanNotFound)?;
        Self::bump_persistent_ttl(&env, &loan_key);

        if loan.status != LoanStatus::Approved {
            return Ok(false);
        }

        let (total_debt, _) = Self::current_total_debt(&env, &mut loan)?;
        let threshold_bps = Self::liquidation_threshold_bps(&env);
        Ok(Self::is_collateral_ratio_below_threshold(
            loan.collateral_amount,
            total_debt,
            threshold_bps,
        ))
    }

    /// Returns `(collateral, total_debt, current_ratio_bps)` for `loan_id`.
    /// Non-`Approved` loans return `(collateral, 0, 0)` without accruing debt.
    pub fn get_loan_health(env: Env, loan_id: u32) -> Result<(i128, i128, u32), LoanError> {
        let loan_key = DataKey::Loan(loan_id);
        let mut loan: Loan = env
            .storage()
            .persistent()
            .get(&loan_key)
            .ok_or(LoanError::LoanNotFound)?;
        Self::bump_persistent_ttl(&env, &loan_key);

        if loan.status != LoanStatus::Approved {
            return Ok((loan.collateral_amount, 0, 0));
        }

        let (total_debt, _) = Self::current_total_debt(&env, &mut loan)?;
        let ratio_bps = Self::current_ratio_bps(loan.collateral_amount, total_debt);
        Ok((loan.collateral_amount, total_debt, ratio_bps))
    }

    /// Liquidate an under-collateralized approved loan.
    ///
    /// Requires `liquidator` authorization and the loan manager, lending pool,
    /// and NFT contract to be unpaused. The target loan must be
    /// [`LoanStatus::Approved`] and its collateral ratio must be below the
    /// configured liquidation threshold. Collateral first repays debt to the
    /// lending pool. When collateral exceeds debt, the liquidator receives the
    /// configured bonus capped by the surplus, and any remaining surplus is
    /// refunded to the borrower; otherwise all collateral goes to debt recovery.
    ///
    /// Returns [`LoanError::ContractPaused`], [`LoanError::PoolPaused`], or
    /// [`LoanError::NftPaused`] when pause checks fail; [`LoanError::LoanNotFound`]
    /// when `loan_id` is unknown; [`LoanError::LoanNotActive`] when the loan is
    /// not approved; [`LoanError::AmountTooLarge`] if debt accrual overflows;
    /// and [`LoanError::LoanNotLiquidatable`] when the collateral ratio is still
    /// at or above the liquidation threshold.
    pub fn liquidate(env: Env, liquidator: Address, loan_id: u32) -> Result<(), LoanError> {
        use soroban_sdk::token::TokenClient;

        liquidator.require_auth();
        Self::require_not_paused(&env)?;

        let loan_key = DataKey::Loan(loan_id);
        let mut loan: Loan = env
            .storage()
            .persistent()
            .get(&loan_key)
            .ok_or(LoanError::LoanNotFound)?;
        Self::bump_persistent_ttl(&env, &loan_key);

        if loan.status != LoanStatus::Approved {
            return Err(LoanError::LoanNotActive);
        }

        let total_debt = {
            let (current_total_debt, _) = Self::current_total_debt(&env, &mut loan)?;
            current_total_debt
        };
        let threshold_bps = Self::liquidation_threshold_bps(&env);
        if !Self::is_collateral_ratio_below_threshold(
            loan.collateral_amount,
            total_debt,
            threshold_bps,
        ) {
            return Err(LoanError::LoanNotLiquidatable);
        }

        let collateral_amount = loan.collateral_amount;
        let configured_bonus = collateral_amount
            .checked_mul(Self::liquidation_bonus_bps(&env) as i128)
            .and_then(|value| value.checked_div(Self::MAX_RATIO_BPS as i128))
            .expect("liquidation bonus overflow");

        // Ensure bonus cap is enforced - bonus BPS should never exceed MAX_LIQUIDATION_BONUS_BPS
        debug_assert!(
            Self::liquidation_bonus_bps(&env) <= Self::MAX_LIQUIDATION_BONUS_BPS,
            "Liquidation bonus BPS exceeds maximum cap"
        );

        let (debt_repaid, liquidator_bonus, borrower_refund) = if collateral_amount >= total_debt {
            let collateral_surplus = collateral_amount
                .checked_sub(total_debt)
                .expect("collateral surplus underflow");
            let liquidator_bonus = configured_bonus.min(collateral_surplus);

            // Additional safety check: ensure bonus never exceeds remaining collateral
            debug_assert!(
                liquidator_bonus <= collateral_amount,
                "Liquidation bonus exceeds collateral amount"
            );

            let borrower_refund = collateral_surplus
                .checked_sub(liquidator_bonus)
                .expect("borrower refund underflow");
            (total_debt, liquidator_bonus, borrower_refund)
        } else {
            (collateral_amount, 0, 0)
        };

        Self::apply_debt_recovery(&mut loan, debt_repaid);
        loan.status = LoanStatus::Liquidated;
        loan.collateral_amount = 0;
        env.storage().persistent().set(&loan_key, &loan);
        Self::bump_persistent_ttl(&env, &loan_key);
        Self::decrement_borrower_loan_count(&env, &loan.borrower);

        let token: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .expect("token not set");
        let lending_pool: Address = env
            .storage()
            .instance()
            .get(&DataKey::LendingPool)
            .expect("lending pool not set");
        let token_client = TokenClient::new(&env, &token);

        if debt_repaid > 0 {
            token_client.transfer(&env.current_contract_address(), &lending_pool, &debt_repaid);
        }
        if liquidator_bonus > 0 {
            token_client.transfer(
                &env.current_contract_address(),
                &liquidator,
                &liquidator_bonus,
            );
        }
        if borrower_refund > 0 {
            token_client.transfer(
                &env.current_contract_address(),
                &loan.borrower,
                &borrower_refund,
            );
        }

        events::loan_liquidated(
            &env,
            loan_id,
            loan.borrower,
            liquidator,
            debt_repaid,
            liquidator_bonus,
            borrower_refund,
        );

        Ok(())
    }

    /// Cancel a pending loan request.
    ///
    /// Requires `borrower` authorization. The loan must belong to `borrower` and
    /// be [`LoanStatus::Pending`]. Cancellation marks the loan
    /// [`LoanStatus::Cancelled`], clears recorded collateral, and returns any
    /// collateral already held by the contract to the borrower.
    ///
    /// Returns [`LoanError::LoanNotFound`] when `loan_id` is unknown,
    /// [`LoanError::BorrowerMismatch`] when `borrower` does not own the loan,
    /// and [`LoanError::LoanNotPending`] when the loan is no longer pending.
    pub fn cancel_loan(env: Env, borrower: Address, loan_id: u32) -> Result<(), LoanError> {
        borrower.require_auth();

        let loan_key = DataKey::Loan(loan_id);
        let mut loan: Loan = env
            .storage()
            .persistent()
            .get(&loan_key)
            .ok_or(LoanError::LoanNotFound)?;
        Self::bump_persistent_ttl(&env, &loan_key);

        if loan.borrower != borrower {
            return Err(LoanError::BorrowerMismatch);
        }
        if loan.status != LoanStatus::Pending {
            return Err(LoanError::LoanNotPending);
        }

        // Return collateral if any was posted
        let collateral_to_release = loan.collateral_amount;
        loan.status = LoanStatus::Cancelled;
        loan.collateral_amount = 0;
        env.storage().persistent().set(&loan_key, &loan);
        Self::bump_persistent_ttl(&env, &loan_key);

        if collateral_to_release > 0 {
            use soroban_sdk::token::TokenClient;
            let token: Address = env
                .storage()
                .instance()
                .get(&DataKey::Token)
                .expect("token not set");
            let token_client = TokenClient::new(&env, &token);
            token_client.transfer(
                &env.current_contract_address(),
                &borrower,
                &collateral_to_release,
            );
            events::collateral_returned(&env, borrower.clone(), loan_id, collateral_to_release);
        }
        events::loan_cancelled(&env, borrower, loan_id);

        Ok(())
    }

    pub fn reject_loan(env: Env, loan_id: u32, reason: String) -> Result<(), LoanError> {
        Self::admin(&env).require_auth();

        let loan_key = DataKey::Loan(loan_id);
        let mut loan: Loan = env
            .storage()
            .persistent()
            .get(&loan_key)
            .ok_or(LoanError::LoanNotFound)?;
        Self::bump_persistent_ttl(&env, &loan_key);

        if loan.status != LoanStatus::Pending {
            return Err(LoanError::LoanNotPending);
        }

        // Return collateral if any was posted
        let collateral_to_release = loan.collateral_amount;
        loan.status = LoanStatus::Rejected;
        loan.collateral_amount = 0;
        env.storage().persistent().set(&loan_key, &loan);
        Self::bump_persistent_ttl(&env, &loan_key);

        if collateral_to_release > 0 {
            use soroban_sdk::token::TokenClient;
            let token: Address = env
                .storage()
                .instance()
                .get(&DataKey::Token)
                .expect("token not set");
            let token_client = TokenClient::new(&env, &token);
            token_client.transfer(
                &env.current_contract_address(),
                &loan.borrower,
                &collateral_to_release,
            );
            events::collateral_returned(
                &env,
                loan.borrower.clone(),
                loan_id,
                collateral_to_release,
            );
        }
        events::loan_rejected(&env, loan_id, reason);

        Ok(())
    }

    /// Purge a loan in a terminal state (Repaid, Cancelled, Rejected) from
    /// on-chain storage. Admin-only. Removes the loan record and any
    /// residual collateral entry, then emits a `LoanPurged` event.
    pub fn purge_loan(env: Env, loan_id: u32) -> Result<(), LoanError> {
        Self::admin(&env).require_auth();

        let loan_key = DataKey::Loan(loan_id);
        let loan: Loan = env
            .storage()
            .persistent()
            .get(&loan_key)
            .ok_or(LoanError::LoanNotFound)?;
        Self::bump_persistent_ttl(&env, &loan_key);

        match loan.status {
            LoanStatus::Repaid | LoanStatus::Cancelled | LoanStatus::Rejected => {}
            _ => return Err(LoanError::LoanNotPurgable),
        }

        // Return any residual collateral before deleting the record.
        if loan.collateral_amount > 0 {
            Self::release_collateral_internal(&env, loan_id, &loan.borrower);
        }

        env.storage().persistent().remove(&loan_key);
        let collateral_key = DataKey::Collateral(loan_id);
        env.storage().persistent().remove(&collateral_key);

        // Cancelled and Rejected loans still hold a borrower loan count
        // (they are never decremented by cancel_loan / reject_loan), so
        // clean it up here.
        if matches!(loan.status, LoanStatus::Cancelled | LoanStatus::Rejected) {
            Self::decrement_borrower_loan_count(&env, &loan.borrower);
        }

        events::loan_purged(&env, loan_id);
        Ok(())
    }

    /// Refinance an active loan in good standing (not past due).
    /// Settles all accrued interest and late fees, adjusts the principal to
    /// new_amount (drawing from or returning funds to the pool), and resets
    /// the due date to current_ledger + new_term.
    /// Requires both borrower auth and admin auth.
    pub fn refinance_loan(
        env: Env,
        loan_id: u32,
        new_amount: i128,
        new_term: u32,
    ) -> Result<(), LoanError> {
        use soroban_sdk::token::TokenClient;

        Self::require_not_paused(&env)?;

        // Both borrower and admin must authorise.
        let admin = Self::admin(&env);
        admin.require_auth();

        let loan_key = DataKey::Loan(loan_id);
        let mut loan: Loan = env
            .storage()
            .persistent()
            .get(&loan_key)
            .ok_or(LoanError::LoanNotFound)?;
        Self::bump_persistent_ttl(&env, &loan_key);

        // Borrower must also sign.
        loan.borrower.require_auth();

        if loan.status != LoanStatus::Approved {
            return Err(LoanError::LoanNotActive);
        }

        // Allow refinance until end of default window
        let current_ledger = env.ledger().sequence();
        let default_ends = loan
            .due_date
            .checked_add(Self::default_window_ledgers(&env))
            .expect("default window overflow");
        if current_ledger > default_ends {
            return Err(LoanError::LoanPastDue);
        }

        if new_amount <= 0 {
            return Err(LoanError::InvalidAmount);
        }
        if new_amount > Self::max_loan_amount(&env) {
            return Err(LoanError::InvalidAmount);
        }

        let min_term: u32 = env
            .storage()
            .instance()
            .get(&DataKey::MinTermLedgers)
            .unwrap_or(0);
        let max_term: u32 = env
            .storage()
            .instance()
            .get(&DataKey::MaxTermLedgers)
            .unwrap_or(u32::MAX);
        if new_term < min_term || new_term > max_term {
            return Err(LoanError::InvalidTerm);
        }

        // Re-validate credit score (treat refinance like new loan application)
        let nft_contract: Address = env
            .storage()
            .instance()
            .get(&DataKey::NftContract)
            .ok_or(LoanError::NotInitialized)?;
        let nft_client = NftClient::new(&env, &nft_contract);

        let current_score = nft_client.get_score(&loan.borrower);
        let min_score: u32 = env
            .storage()
            .instance()
            .get(&DataKey::MinScore)
            .unwrap_or(500);
        if current_score < min_score {
            return Err(LoanError::InsufficientScore);
        }

        // Validate collateral covers new amount (collateral must be >= loan amount)
        if loan.collateral_amount < new_amount {
            return Err(LoanError::InsufficientScore);
        }

        // Settle all accrued interest and late fees up to now.
        Self::accrue_interest(&env, &mut loan)?;
        let _ = Self::accrue_late_fee(&env, &mut loan);

        loan.interest_paid = loan
            .interest_paid
            .checked_add(loan.accrued_interest)
            .expect("overflow");
        loan.accrued_interest = 0;

        loan.late_fee_paid = loan
            .late_fee_paid
            .checked_add(loan.accrued_late_fee)
            .expect("overflow");
        loan.accrued_late_fee = 0;

        // Adjust principal to new_amount.
        let remaining_principal = Self::remaining_principal(&loan);

        let token: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .expect("token not set");
        let lending_pool: Address = env
            .storage()
            .instance()
            .get(&DataKey::LendingPool)
            .expect("lending pool not set");
        let token_client = TokenClient::new(&env, &token);

        match new_amount.cmp(&remaining_principal) {
            core::cmp::Ordering::Greater => {
                // Pool disburses the additional amount to the borrower.
                let additional = new_amount
                    .checked_sub(remaining_principal)
                    .expect("underflow");
                // Idle balance only: disbursed principal has already left the
                // pool's account, so subtracting outstanding would double-count it.
                let idle_liquidity = token_client.balance(&lending_pool);
                if idle_liquidity < additional {
                    return Err(LoanError::InsufficientPoolLiquidity);
                }
                // Route through the pool: only the pool can authorise a transfer
                // out of its own balance.
                PoolClient::new(&env, &lending_pool).disburse(&token, &loan.borrower, &additional);
            }
            core::cmp::Ordering::Less => {
                // Borrower returns the excess principal to the pool.
                let excess_principal = remaining_principal
                    .checked_sub(new_amount)
                    .expect("underflow");
                token_client.transfer(&loan.borrower, &lending_pool, &excess_principal);
                // The excess principal is back in the pool; retire it so the
                // pool's share price does not treat it as still lent out.
                PoolClient::new(&env, &lending_pool).settle_outstanding(&token, &excess_principal);

                // Return excess collateral proportionally if new amount is smaller
                if new_amount < remaining_principal {
                    let collateral_to_return = loan
                        .collateral_amount
                        .checked_mul(excess_principal)
                        .expect("multiplication overflow")
                        .checked_div(remaining_principal)
                        .expect("division by zero");
                    if collateral_to_return > 0 {
                        token_client.transfer(
                            &env.current_contract_address(),
                            &loan.borrower,
                            &collateral_to_return,
                        );
                        loan.collateral_amount = loan
                            .collateral_amount
                            .checked_sub(collateral_to_return)
                            .expect("underflow");
                    }
                }
            }
            core::cmp::Ordering::Equal => {}
        }

        // Reset loan terms with new amount and rate.
        loan.amount = new_amount;
        loan.principal_paid = 0;
        loan.interest_rate_bps =
            Self::compute_interest_rate(&env, &loan.borrower, new_amount, current_score);
        loan.last_interest_ledger = current_ledger;
        loan.due_date = current_ledger + new_term;
        loan.last_late_fee_ledger = loan.due_date;

        env.storage().persistent().set(&loan_key, &loan);
        Self::bump_persistent_ttl(&env, &loan_key);

        events::loan_refinanced(&env, loan_id, loan.borrower.clone(), new_amount, new_term);

        Ok(())
    }

    pub fn set_late_fee_rate(env: Env, rate_bps: u32) -> Result<(), LoanError> {
        Self::validate_late_fee_rate(rate_bps)?;
        let admin = Self::admin(&env);
        admin.require_auth();

        let old_rate = Self::late_fee_rate_bps(&env);
        env.storage()
            .instance()
            .set(&DataKey::LateFeeRateBps, &rate_bps);
        Self::bump_instance_ttl(&env);
        events::late_fee_rate_updated(&env, admin, old_rate, rate_bps);

        Ok(())
    }

    pub fn get_late_fee_rate(env: Env) -> u32 {
        Self::late_fee_rate_bps(&env)
    }

    pub fn set_liquidation_threshold(env: Env, ratio_bps: u32) -> Result<(), LoanError> {
        Self::validate_liquidation_threshold(ratio_bps)?;
        Self::admin(&env).require_auth();
        env.storage()
            .instance()
            .set(&DataKey::LiquidationThresholdBps, &ratio_bps);
        Self::bump_instance_ttl(&env);
        Ok(())
    }

    pub fn get_liquidation_threshold(env: Env) -> u32 {
        Self::liquidation_threshold_bps(&env)
    }

    pub fn set_liquidation_bonus_bps(env: Env, bonus_bps: u32) -> Result<(), LoanError> {
        Self::validate_liquidation_bonus_bps(bonus_bps)?;
        Self::admin(&env).require_auth();
        env.storage()
            .instance()
            .set(&DataKey::LiquidationBonusBps, &bonus_bps);
        Self::bump_instance_ttl(&env);
        Ok(())
    }

    pub fn get_liquidation_bonus_bps(env: Env) -> u32 {
        Self::liquidation_bonus_bps(&env)
    }

    pub fn set_grace_period_ledgers(env: Env, ledgers: u32) -> Result<(), LoanError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();

        // Enforce invariant: default_window must be >= grace_period
        let default_window = Self::default_window_ledgers(&env);
        if default_window < ledgers {
            return Err(LoanError::InvalidConfiguration);
        }

        let old_ledgers = Self::grace_period_ledgers(&env);
        env.storage()
            .instance()
            .set(&DataKey::GracePeriodLedgers, &ledgers);
        Self::bump_instance_ttl(&env);
        events::grace_period_updated(&env, admin, old_ledgers, ledgers);
        Ok(())
    }

    pub fn get_grace_period_ledgers(env: Env) -> u32 {
        Self::grace_period_ledgers(&env)
    }

    pub fn set_default_window_ledgers(env: Env, ledgers: u32) -> Result<(), LoanError> {
        const MIN_DEFAULT_WINDOW: u32 = 100;
        if ledgers < MIN_DEFAULT_WINDOW {
            return Err(LoanError::InvalidConfiguration);
        }

        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(LoanError::NotInitialized)?;
        admin.require_auth();

        // Enforce invariant: default_window must be >= grace_period
        let grace_period = Self::grace_period_ledgers(&env);
        if ledgers < grace_period {
            return Err(LoanError::InvalidConfiguration);
        }

        let old_ledgers = Self::default_window_ledgers(&env);
        env.storage()
            .instance()
            .set(&DataKey::DefaultWindowLedgers, &ledgers);
        Self::bump_instance_ttl(&env);
        events::default_window_updated(&env, admin, old_ledgers, ledgers);
        Ok(())
    }

    pub fn get_default_window_ledgers(env: Env) -> u32 {
        Self::default_window_ledgers(&env)
    }

    pub fn set_min_score(env: Env, min_score: u32) -> Result<(), LoanError> {
        if min_score > Self::NFT_MAX_SCORE {
            return Err(LoanError::InvalidConfiguration);
        }

        let admin = Self::admin(&env);
        admin.require_auth();

        let old_score: u32 = env
            .storage()
            .instance()
            .get(&DataKey::MinScore)
            .unwrap_or(500);
        env.storage().instance().set(&DataKey::MinScore, &min_score);
        Self::bump_instance_ttl(&env);
        events::min_score_updated(&env, admin, old_score, min_score);
        Ok(())
    }

    pub fn set_max_loan_amount(env: Env, amount: i128) -> Result<(), LoanError> {
        if amount <= 0 {
            return Err(LoanError::InvalidAmount);
        }

        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(LoanError::NotInitialized)?;
        admin.require_auth();

        let old_amount = Self::max_loan_amount(&env);
        env.storage()
            .instance()
            .set(&DataKey::MaxLoanAmount, &amount);
        Self::bump_instance_ttl(&env);
        events::max_loan_amount_updated(&env, admin, old_amount, amount);

        Ok(())
    }

    pub fn get_max_loan_amount(env: Env) -> i128 {
        Self::max_loan_amount(&env)
    }

    pub fn set_min_repayment_amount(env: Env, amount: i128) {
        if amount < 0 {
            panic!("min repayment amount cannot be negative");
        }

        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();

        let old_amount = Self::min_repayment_amount(&env);
        env.storage()
            .instance()
            .set(&DataKey::MinRepaymentAmount, &amount);
        Self::bump_instance_ttl(&env);
        events::min_repayment_updated(&env, admin, old_amount, amount);
    }

    pub fn get_min_repayment_amount(env: Env) -> i128 {
        Self::min_repayment_amount(&env)
    }

    pub fn set_max_loans_per_borrower(env: Env, max_loans: u32) -> Result<(), LoanError> {
        if max_loans == 0 {
            return Err(LoanError::InvalidAmount);
        }

        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(LoanError::NotInitialized)?;
        admin.require_auth();

        let old_max = Self::max_loans_per_borrower(&env);
        env.storage()
            .instance()
            .set(&DataKey::MaxLoansPerBorrower, &max_loans);
        Self::bump_instance_ttl(&env);
        events::max_loans_per_borrower_updated(&env, admin, old_max, max_loans);

        Ok(())
    }

    pub fn get_max_loans_per_borrower(env: Env) -> u32 {
        Self::max_loans_per_borrower(&env)
    }

    pub fn get_borrower_loan_count(env: Env, borrower: Address) -> u32 {
        Self::borrower_loan_count(&env, &borrower)
    }

    pub fn get_admin(env: Env) -> Address {
        Self::admin(&env)
    }

    pub fn get_proposed_admin(env: Env) -> Option<Address> {
        Self::bump_instance_ttl(&env);
        env.storage().instance().get(&DataKey::ProposedAdmin)
    }

    pub fn get_total_loans(env: Env) -> u32 {
        Self::loan_counter(&env)
    }

    pub fn get_lending_pool(env: Env) -> Address {
        Self::lending_pool(&env)
    }

    pub fn get_nft_contract(env: Env) -> Address {
        Self::nft_contract(&env)
    }

    pub fn get_token(env: Env) -> Address {
        Self::token(&env)
    }

    /// Principal currently deployed, as tracked by the LendingPool.
    ///
    /// Delegates to the pool rather than reading a local copy, so this view and
    /// the pool's own accounting can never disagree.
    pub fn get_total_outstanding(env: Env, token: Address) -> i128 {
        Self::pool_outstanding(&env, &token)
    }

    pub fn get_borrower_loans(env: Env, borrower: Address) -> Vec<u32> {
        Self::bump_instance_ttl(&env);
        env.storage()
            .instance()
            .get(&DataKey::BorrowerLoans(borrower))
            .unwrap_or(Vec::new(&env))
    }

    pub fn get_min_score(env: Env) -> u32 {
        Self::bump_instance_ttl(&env);
        env.storage()
            .instance()
            .get(&DataKey::MinScore)
            .unwrap_or(500)
    }

    pub fn set_interest_rate(env: Env, rate_bps: u32) -> Result<(), LoanError> {
        Self::admin(&env).require_auth();
        if rate_bps == 0 {
            return Err(LoanError::InvalidRate);
        }

        let old_rate = Self::read_interest_rate(&env);
        env.storage()
            .instance()
            .set(&DataKey::InterestRateBps, &rate_bps);
        Self::bump_instance_ttl(&env);
        events::interest_rate_updated(&env, old_rate, rate_bps);

        Ok(())
    }

    pub fn get_interest_rate(env: Env) -> u32 {
        Self::read_interest_rate(&env)
    }

    pub fn set_rate_oracle(env: Env, rate_oracle: Address) {
        Self::admin(&env).require_auth();

        let old_oracle = env.storage().instance().get(&DataKey::RateOracle);
        env.storage()
            .instance()
            .set(&DataKey::RateOracle, &rate_oracle);
        Self::bump_instance_ttl(&env);
        events::rate_oracle_updated(&env, old_oracle, rate_oracle);
    }

    pub fn get_rate_oracle(env: Env) -> Option<Address> {
        Self::bump_instance_ttl(&env);
        env.storage().instance().get(&DataKey::RateOracle)
    }

    pub fn set_min_rate_bps(env: Env, min_rate: u32) -> Result<(), LoanError> {
        Self::admin(&env).require_auth();

        // Validate min_rate is not zero and doesn't exceed max_rate
        if min_rate == 0 {
            return Err(LoanError::InvalidRate);
        }

        let max_rate = Self::max_rate_bps(&env);
        if min_rate > max_rate {
            return Err(LoanError::InvalidConfiguration);
        }

        let old_min = Self::min_rate_bps(&env);
        env.storage()
            .instance()
            .set(&DataKey::MinRateBps, &min_rate);
        Self::bump_instance_ttl(&env);
        events::min_rate_bps_updated(&env, Self::admin(&env), old_min, min_rate);

        Ok(())
    }

    pub fn get_min_rate_bps(env: Env) -> u32 {
        Self::min_rate_bps(&env)
    }

    pub fn set_max_rate_bps(env: Env, max_rate: u32) -> Result<(), LoanError> {
        Self::admin(&env).require_auth();

        // Validate max_rate is not zero and is >= min_rate
        if max_rate == 0 {
            return Err(LoanError::InvalidRate);
        }

        let min_rate = Self::min_rate_bps(&env);
        if max_rate < min_rate {
            return Err(LoanError::InvalidConfiguration);
        }

        let old_max = Self::max_rate_bps(&env);
        env.storage()
            .instance()
            .set(&DataKey::MaxRateBps, &max_rate);
        Self::bump_instance_ttl(&env);
        events::max_rate_bps_updated(&env, Self::admin(&env), old_max, max_rate);

        Ok(())
    }

    pub fn get_max_rate_bps(env: Env) -> u32 {
        Self::max_rate_bps(&env)
    }

    pub fn set_default_term(env: Env, ledgers: u32) -> Result<(), LoanError> {
        Self::admin(&env).require_auth();
        if ledgers == 0 {
            return Err(LoanError::InvalidTerm);
        }

        let old_term = Self::read_default_term(&env);
        env.storage()
            .instance()
            .set(&DataKey::DefaultTermLedgers, &ledgers);
        Self::bump_instance_ttl(&env);
        events::default_term_updated(&env, old_term, ledgers);

        Ok(())
    }

    pub fn get_default_term(env: Env) -> u32 {
        Self::read_default_term(&env)
    }

    pub fn set_min_term_ledgers(env: Env, min_term: u32) -> Result<(), LoanError> {
        if min_term == 0 {
            return Err(LoanError::InvalidTerm);
        }
        let max_term: u32 = env
            .storage()
            .instance()
            .get(&DataKey::MaxTermLedgers)
            .unwrap_or(u32::MAX);
        if min_term > max_term {
            return Err(LoanError::InvalidTerm);
        }
        Self::admin(&env).require_auth();
        env.storage()
            .instance()
            .set(&DataKey::MinTermLedgers, &min_term);
        Self::bump_instance_ttl(&env);
        events::term_limits_updated(&env, min_term, max_term);

        Ok(())
    }

    pub fn get_min_term_ledgers(env: Env) -> u32 {
        Self::min_term_ledgers(&env)
    }

    pub fn set_max_term_ledgers(env: Env, max_term: u32) -> Result<(), LoanError> {
        if max_term == 0 {
            return Err(LoanError::InvalidTerm);
        }
        let min_term: u32 = env
            .storage()
            .instance()
            .get(&DataKey::MinTermLedgers)
            .unwrap_or(0);
        if max_term < min_term {
            return Err(LoanError::InvalidTerm);
        }
        Self::admin(&env).require_auth();
        env.storage()
            .instance()
            .set(&DataKey::MaxTermLedgers, &max_term);
        Self::bump_instance_ttl(&env);
        events::term_limits_updated(&env, min_term, max_term);

        Ok(())
    }

    pub fn get_max_term_ledgers(env: Env) -> u32 {
        Self::max_term_ledgers(&env)
    }

    pub fn propose_admin(env: Env, new_admin: Address) {
        let current_admin = Self::admin(&env);
        current_admin.require_auth();

        env.storage()
            .instance()
            .set(&DataKey::ProposedAdmin, &new_admin);
        Self::bump_instance_ttl(&env);
        env.events().publish(
            (Symbol::new(&env, "AdminProposed"), current_admin),
            new_admin,
        );
    }

    pub fn accept_admin(env: Env) -> Result<(), LoanError> {
        let proposed_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::ProposedAdmin)
            .ok_or(LoanError::NotInitialized)?;
        proposed_admin.require_auth();

        env.storage()
            .instance()
            .set(&DataKey::Admin, &proposed_admin);
        env.storage().instance().remove(&DataKey::ProposedAdmin);
        Self::bump_instance_ttl(&env);
        env.events()
            .publish((Symbol::new(&env, "AdminTransferred"),), proposed_admin);
        Ok(())
    }

    /// Set the governance contract permitted to replace this contract's admin.
    ///
    /// Once configured, [`Self::set_admin`] accepts authorisation from this
    /// contract only, so a single admin key cannot bypass the timelock and
    /// quorum that governance enforces.
    ///
    /// Requires admin authorization.
    pub fn set_governance(env: Env, governance: Address) -> Result<(), LoanError> {
        Self::admin(&env).require_auth();

        env.storage()
            .instance()
            .set(&DataKey::Governance, &governance);
        Self::bump_instance_ttl(&env);

        env.events()
            .publish((Symbol::new(&env, "GovernanceSet"),), governance);
        Ok(())
    }

    /// Address of the configured governance contract, if any.
    pub fn get_governance(env: Env) -> Option<Address> {
        Self::bump_instance_ttl(&env);
        env.storage().instance().get(&DataKey::Governance)
    }

    /// Replace the admin.
    ///
    /// Authorised by the configured governance contract when one is set, and by
    /// the current admin otherwise.
    ///
    /// This mirrors `LendingPool::set_admin` so that
    /// `MultisigGovernance::finalize_admin_transfer` can retarget either
    /// contract. Previously only the pool exposed `set_admin`, so governance
    /// could not change this contract's admin at all despite the governance
    /// contract documenting `set_admin` as its target interface.
    ///
    /// # Errors
    ///
    /// [`LoanError::NotInitialized`] when the contract has no admin.
    pub fn set_admin(env: Env, new_admin: Address) -> Result<(), LoanError> {
        let current_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(LoanError::NotInitialized)?;

        let via = match env
            .storage()
            .instance()
            .get::<DataKey, Address>(&DataKey::Governance)
        {
            Some(governance) => {
                governance.require_auth();
                Symbol::new(&env, "governance")
            }
            None => {
                current_admin.require_auth();
                Symbol::new(&env, "admin")
            }
        };

        env.storage().instance().set(&DataKey::Admin, &new_admin);
        env.storage().instance().remove(&DataKey::ProposedAdmin);
        Self::bump_instance_ttl(&env);

        env.events().publish(
            (Symbol::new(&env, "AdminTransferred"), via),
            (current_admin, new_admin),
        );
        Ok(())
    }

    pub fn pause(env: Env) {
        Self::admin(&env).require_auth();
        let paused_at_ledger = env.ledger().sequence();
        env.storage().instance().set(&DataKey::Paused, &true);
        env.storage()
            .instance()
            .set(&DataKey::PausedAtLedger, &paused_at_ledger);
        Self::bump_instance_ttl(&env);
        events::paused(&env, paused_at_ledger);
        env.events()
            .publish((Symbol::new(&env, "ContractPaused"),), paused_at_ledger);
    }

    pub fn unpause(env: Env) {
        Self::admin(&env).require_auth();
        let unpaused_at_ledger = env.ledger().sequence();
        env.storage().instance().set(&DataKey::Paused, &false);
        env.storage().instance().remove(&DataKey::PausedAtLedger);
        Self::bump_instance_ttl(&env);
        events::unpaused(&env, unpaused_at_ledger);
        env.events()
            .publish((Symbol::new(&env, "ContractUnpaused"),), unpaused_at_ledger);
    }

    pub fn is_paused(env: Env) -> bool {
        Self::bump_instance_ttl(&env);
        env.storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
    }

    pub fn get_paused_at_ledger(env: Env) -> u32 {
        Self::bump_instance_ttl(&env);
        env.storage()
            .instance()
            .get(&DataKey::PausedAtLedger)
            .unwrap_or(0)
    }

    /// Immediately default a single loan, reporting why it could not be defaulted.
    ///
    /// A thin wrapper over `apply_default`, the same pipeline `check_defaults` uses, so
    /// the two entry points cannot drift apart.
    pub fn check_default(env: Env, loan_id: u32) -> Result<(), LoanError> {
        Self::admin(&env).require_auth();
        Self::require_not_paused(&env)?;

        match Self::apply_default(&env, loan_id) {
            DefaultOutcome::Defaulted => Ok(()),
            DefaultOutcome::NotFound => Err(LoanError::LoanNotFound),
            DefaultOutcome::NotInitialized => Err(LoanError::NotInitialized),
            DefaultOutcome::NotActive => Err(LoanError::LoanNotActive),
            DefaultOutcome::NotPastDue => Err(LoanError::LoanNotPastDue),
        }
    }

    /// The single-loan default pipeline shared by `check_default` and `check_defaults`.
    ///
    /// Every precondition is evaluated before any state is written, and every
    /// precondition that a *batch* must survive is reported through the return value
    /// rather than by panicking. The previous implementation of the batch used
    /// `expect` for both the eligibility arithmetic and the token lookup, so a single
    /// loan could abort the whole batch with a panic that told the operator nothing
    /// about which loan was at fault.
    ///
    /// The steps that move funds -- seizing collateral and retiring the principal from
    /// the pool -- are deliberately still fatal. A `loan` marked `Defaulted` whose
    /// collateral stayed in this contract, or that the pool still counted as
    /// outstanding, would corrupt the accounting that LP share price depends on, so
    /// letting the whole call revert is the safe outcome. The caller can then re-run
    /// the batch without the offending loan, or target it individually.
    fn apply_default(env: &Env, loan_id: u32) -> DefaultOutcome {
        let loan_key = DataKey::Loan(loan_id);
        let mut loan: Loan = match env.storage().persistent().get(&loan_key) {
            Some(loan) => loan,
            None => return DefaultOutcome::NotFound,
        };
        Self::bump_persistent_ttl(env, &loan_key);

        if loan.status != LoanStatus::Approved {
            return DefaultOutcome::NotActive;
        }

        // A due date far enough out that adding the default window overflows is not
        // eligible for default. Both operands are configurable -- the window by the
        // admin, the due date through the loan's term -- so this is reachable, and it
        // is a property of this one loan rather than a reason to fail the batch.
        let default_eligible_after =
            match loan.due_date.checked_add(Self::default_window_ledgers(env)) {
                Some(ledger) => ledger,
                None => return DefaultOutcome::NotPastDue,
            };
        if env.ledger().sequence() <= default_eligible_after {
            return DefaultOutcome::NotPastDue;
        }

        // Configuration is read once, before anything is mutated, and reported as a
        // typed error instead of a panic part-way through the update.
        let token: Address = match env.storage().instance().get(&DataKey::Token) {
            Some(token) => token,
            None => return DefaultOutcome::NotInitialized,
        };

        loan.status = LoanStatus::Defaulted;
        env.storage().persistent().set(&loan_key, &loan);
        Self::bump_persistent_ttl(env, &loan_key);
        Self::decrement_borrower_loan_count(env, &loan.borrower);
        Self::seize_collateral_internal(env, loan_id);
        // Retire the principal from the pool's outstanding balance, so share price
        // stops counting a loan that will never be repaid.
        PoolClient::new(env, &Self::lending_pool(env)).settle_outstanding(&token, &loan.amount);

        Self::report_default_to_nft(env, loan_id, &loan.borrower);
        events::loan_defaulted(env, loan_id, loan.borrower.clone());
        DefaultOutcome::Defaulted
    }

    /// Apply a default's credit consequences on the NFT, as a best-effort step.
    ///
    /// Unlike the collateral seizure and the pool settlement above, these calls move no
    /// funds -- they only record the missed payment on the borrower's NFT. They cross a
    /// contract boundary, so they can be refused for reasons that have nothing to do
    /// with this loan: no score recorder configured on the NFT, the NFT paused, or the
    /// borrower holding no NFT. Letting such a refusal abort the caller would mean a
    /// misconfigured NFT stops *every* overdue loan from ever being defaulted, so no
    /// collateral would be seized on any of them. A refusal is therefore reported as an
    /// event rather than being allowed to block the funds-critical path.
    fn report_default_to_nft(env: &Env, loan_id: u32, borrower: &Address) {
        let nft_client = NftClient::new(env, &Self::nft_contract(env));
        let manager = env.current_contract_address();

        let penalised = matches!(
            nft_client.try_decrease_score(
                borrower,
                &Self::DEFAULT_SCORE_PENALTY_POINTS,
                &Some(manager.clone()),
            ),
            Ok(Ok(()))
        );
        let recorded = matches!(
            nft_client.try_record_default(borrower, &Some(manager)),
            Ok(Ok(()))
        );

        if !penalised || !recorded {
            events::default_report_skipped(env, loan_id, borrower.clone());
        }
    }

    /// Extend a loan's due date by the specified number of ledgers.
    /// Only callable by the borrower while the loan is in Approved status.
    /// Rejects extension if loan is defaulted, repaid, or has exceeded max extensions.
    /// Optionally charges an extension fee (1% of remaining principal).
    pub fn extend_loan(
        env: Env,
        borrower: Address,
        loan_id: u32,
        extra_ledgers: u32,
    ) -> Result<(), LoanError> {
        use soroban_sdk::token::TokenClient;

        borrower.require_auth();
        Self::require_not_paused(&env)?;

        if extra_ledgers == 0 {
            return Err(LoanError::InvalidTerm);
        }

        // Bound a single extension by the configured maximum term. `extra_ledgers`
        // was previously unbounded, so a borrower could pass `u32::MAX` and push
        // the due date ~680 years out for one 1% extension fee — the loan could
        // never become overdue, so the default path (and the collateral seizure
        // that protects lenders) was unreachable. MAX_EXTENSIONS alone did not
        // help because three such calls are more than enough.
        let max_extension_ledgers: u32 = env
            .storage()
            .instance()
            .get(&DataKey::MaxTermLedgers)
            .unwrap_or(Self::DEFAULT_TERM_LEDGERS);
        if extra_ledgers > max_extension_ledgers {
            return Err(LoanError::InvalidTerm);
        }

        let loan_key = DataKey::Loan(loan_id);
        let mut loan: Loan = env
            .storage()
            .persistent()
            .get(&loan_key)
            .ok_or(LoanError::LoanNotFound)?;
        Self::bump_persistent_ttl(&env, &loan_key);

        // Verify borrower matches
        if loan.borrower != borrower {
            return Err(LoanError::BorrowerMismatch);
        }

        // Only Approved loans can be extended
        if loan.status != LoanStatus::Approved {
            return Err(LoanError::LoanNotActive);
        }

        // Check if loan is past due (in default window)
        let current_ledger = env.ledger().sequence();
        let default_ends = loan
            .due_date
            .checked_add(Self::default_window_ledgers(&env))
            .expect("default window overflow");
        if current_ledger > default_ends {
            return Err(LoanError::LoanPastDue);
        }

        // Check extension limit
        if loan.extension_count >= Self::MAX_EXTENSIONS {
            return Err(LoanError::InvalidConfiguration);
        }

        // Calculate extension fee (1% of remaining principal)
        let remaining_principal = Self::remaining_principal(&loan);
        let extension_fee = remaining_principal
            .checked_mul(Self::EXTENSION_FEE_BPS as i128)
            .and_then(|v| v.checked_div(10_000))
            .expect("extension fee overflow");

        // Collect extension fee from borrower if any
        if extension_fee > 0 {
            let token: Address = env
                .storage()
                .instance()
                .get(&DataKey::Token)
                .expect("token not set");
            let lending_pool: Address = env
                .storage()
                .instance()
                .get(&DataKey::LendingPool)
                .expect("lending pool not set");
            let token_client = TokenClient::new(&env, &token);
            token_client.transfer(&borrower, &lending_pool, &extension_fee);
        }

        // Extend the due date
        let new_due_date = loan
            .due_date
            .checked_add(extra_ledgers)
            .expect("due date overflow");
        loan.due_date = new_due_date;

        // Increment extension count
        loan.extension_count = loan
            .extension_count
            .checked_add(1)
            .expect("extension count overflow");

        // Persist updated loan
        env.storage().persistent().set(&loan_key, &loan);
        Self::bump_persistent_ttl(&env, &loan_key);

        // Emit extension event
        events::loan_extended(
            &env,
            loan_id,
            borrower,
            new_due_date,
            extension_fee,
            loan.extension_count,
        );

        Ok(())
    }

    /// Process a batch of loans that may have passed their default window.
    ///
    /// Returns how many loans were transitioned to `Defaulted`. Each loan is evaluated
    /// independently and a loan that is missing, already terminal, or whose eligibility
    /// cannot be computed is skipped rather than failing the batch, so no single odd
    /// loan can block the defaults of every other loan in the list.
    pub fn check_defaults(env: Env, loan_ids: Vec<u32>) -> Result<u32, LoanError> {
        Self::admin(&env).require_auth();
        Self::require_not_paused(&env)?;

        let mut defaulted_count = 0u32;
        for loan_id in loan_ids.iter() {
            if let DefaultOutcome::Defaulted = Self::apply_default(&env, loan_id) {
                defaulted_count = defaulted_count.saturating_add(1);
            }
        }

        Ok(defaulted_count)
    }
}

#[cfg(test)]
mod test;
