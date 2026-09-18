//! Accounting invariant tests for the LendingPool / LoanManager boundary.
//!
//! These pin the invariants that the outstanding-accounting fix depends on:
//!
//! 1. `total_pool_assets == idle_balance + total_outstanding`
//! 2. Disbursement converts idle liquidity into outstanding principal without
//!    changing the LP share price — the pool has swapped cash for a claim of
//!    equal size.
//! 3. Only interest changes the share price, and it moves it upward.
//! 4. The LendingPool is the single source of truth for outstanding principal.
//! 5. The liquidity check compares a requested loan against *idle* balance, not
//!    against idle minus outstanding (which double-counted deployed principal).

use lending_pool::{LendingPool, LendingPoolClient};
use loan_manager::{LoanManager, LoanManagerClient};
use remittance_nft::{RemittanceNFT, RemittanceNFTClient};
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::token::{Client as TokenClient, StellarAssetClient};
use soroban_sdk::{Address, BytesN, Env, String};

const SHARE_PRICE_SCALE: i128 = 1_000_000;
const DEFAULT_TERM: u32 = 17_280;

struct Fixture {
    env: Env,
    token_id: Address,
    pool_id: Address,
    manager_id: Address,
    nft_id: Address,
}

/// Deploys the protocol and funds the pool through a real deposit, so LP shares
/// exist and the share price is meaningful.
fn setup(deposit: i128) -> Fixture {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let admin = Address::generate(&env);
    let lender = Address::generate(&env);

    let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
    let token_id = token_contract.address();
    let stellar = StellarAssetClient::new(&env, &token_id);

    let nft_id = env.register(RemittanceNFT, ());
    let nft = RemittanceNFTClient::new(&env, &nft_id);
    nft.initialize(&admin);

    let pool_id = env.register(LendingPool, ());
    let pool = LendingPoolClient::new(&env, &pool_id);
    pool.initialize(&admin);
    pool.set_withdrawal_cooldown(&0);

    let manager_id = env.register(LoanManager, ());
    let manager = LoanManagerClient::new(&env, &manager_id);
    nft.authorize_minter(&manager_id);
    manager.initialize(&nft_id, &pool_id, &token_id, &admin);

    // The pool must be told which contract may request disbursements.
    pool.set_loan_manager(&manager_id);

    stellar.mint(&lender, &deposit);
    pool.deposit(&lender, &token_id, &deposit);

    // Interest accrual short-circuits at ledger 0, so fund at ledger 1.
    env.ledger().set_sequence_number(1);

    Fixture {
        env,
        token_id,
        pool_id,
        manager_id,
        nft_id,
    }
}

/// Mints an NFT so `borrower` clears the default minimum score gate.
fn eligible_borrower(f: &Fixture, seed: u8) -> Address {
    let borrower = Address::generate(&f.env);
    let nft = RemittanceNFTClient::new(&f.env, &f.nft_id);
    nft.mint(
        &borrower,
        &700,
        &BytesN::from_array(&f.env, &[seed; 32]),
        &String::from_str(&f.env, "ipfs://accounting"),
        &None,
    );
    borrower
}

/// Invariant 1 + 2: disbursement swaps idle cash for an equal claim, leaving
/// total pool assets and the share price untouched.
#[test]
fn disbursement_preserves_total_assets_and_share_price() {
    let f = setup(10_000);
    let pool = LendingPoolClient::new(&f.env, &f.pool_id);
    let manager = LoanManagerClient::new(&f.env, &f.manager_id);
    let token = TokenClient::new(&f.env, &f.token_id);

    let price_before = pool.get_share_price(&f.token_id);
    assert_eq!(price_before, SHARE_PRICE_SCALE);
    assert_eq!(pool.get_total_outstanding(&f.token_id), 0);

    let borrower = eligible_borrower(&f, 1);
    let loan_id = manager.request_loan(&borrower, &5_000, &DEFAULT_TERM);
    manager.approve_loan(&loan_id);

    let stats = pool.get_pool_stats(&f.token_id);
    assert_eq!(stats.pool_token_balance, 5_000, "idle balance halves");
    assert_eq!(pool.get_total_outstanding(&f.token_id), 5_000);

    // Invariant 1
    assert_eq!(
        stats.pool_token_balance + pool.get_total_outstanding(&f.token_id),
        10_000,
        "idle + outstanding must equal total pool assets"
    );
    // Invariant 2
    assert_eq!(
        pool.get_share_price(&f.token_id),
        price_before,
        "disbursement must not move the share price"
    );
    assert_eq!(token.balance(&borrower), 5_000);
}

/// Invariant 3: repayment returns principal plus interest, so outstanding drops
/// to zero and the share price rises by exactly the interest.
#[test]
fn repayment_returns_principal_and_interest_to_idle() {
    let f = setup(10_000);
    let pool = LendingPoolClient::new(&f.env, &f.pool_id);
    let manager = LoanManagerClient::new(&f.env, &f.manager_id);
    let stellar = StellarAssetClient::new(&f.env, &f.token_id);

    let price_before = pool.get_share_price(&f.token_id);

    let borrower = eligible_borrower(&f, 2);
    let loan_id = manager.request_loan(&borrower, &5_000, &DEFAULT_TERM);
    manager.approve_loan(&loan_id);

    // Accrue some interest.
    f.env
        .ledger()
        .set_sequence_number(f.env.ledger().sequence() + 5_000);

    let loan = manager.get_loan(&loan_id);
    let interest = loan.accrued_interest;
    assert!(interest > 0, "interest should have accrued");

    let total_debt = loan.amount + interest + loan.accrued_late_fee;
    stellar.mint(&borrower, &total_debt);
    manager.repay(&borrower, &loan_id, &total_debt);

    assert_eq!(
        pool.get_total_outstanding(&f.token_id),
        0,
        "settlement must retire the principal"
    );
    assert_eq!(
        pool.get_pool_stats(&f.token_id).pool_token_balance,
        10_000 + interest,
        "principal plus interest must be back in the pool"
    );
    assert!(
        pool.get_share_price(&f.token_id) > price_before,
        "the share price must rise by the interest earned"
    );
}

/// Invariant 4: the LoanManager must not hold a second, drifting copy of the
/// outstanding counter.
#[test]
fn loan_manager_outstanding_matches_pool_outstanding() {
    let f = setup(10_000);
    let pool = LendingPoolClient::new(&f.env, &f.pool_id);
    let manager = LoanManagerClient::new(&f.env, &f.manager_id);

    let borrower = eligible_borrower(&f, 3);
    let loan_id = manager.request_loan(&borrower, &4_000, &DEFAULT_TERM);
    manager.approve_loan(&loan_id);

    assert_eq!(
        manager.get_total_outstanding(&f.token_id),
        pool.get_total_outstanding(&f.token_id),
        "the manager's view must be the pool's value, not a local copy"
    );
    assert_eq!(manager.get_total_outstanding(&f.token_id), 4_000);
}

/// Invariant 5 / double-count regression: a second loan is affordable whenever
/// idle balance covers it, even when outstanding already exceeds idle.
///
/// The previous check was `pool_balance - outstanding`, but `pool_balance`
/// already excludes disbursed funds, so deployed principal was subtracted twice.
/// With 6,000 of 10,000 out on loan, a further 4,000 was rejected as
/// unaffordable even though the pool held exactly 4,000 idle.
#[test]
fn liquidity_check_compares_against_idle_balance_only() {
    let f = setup(10_000);
    let pool = LendingPoolClient::new(&f.env, &f.pool_id);
    let manager = LoanManagerClient::new(&f.env, &f.manager_id);

    let first = eligible_borrower(&f, 4);
    let first_id = manager.request_loan(&first, &6_000, &DEFAULT_TERM);
    manager.approve_loan(&first_id);

    let idle = pool.get_pool_stats(&f.token_id).pool_token_balance;
    let outstanding = pool.get_total_outstanding(&f.token_id);
    assert_eq!(idle, 4_000);
    assert_eq!(outstanding, 6_000);
    assert!(
        outstanding > idle,
        "regression only bites once outstanding exceeds idle"
    );

    // This is the call the old double-counting check rejected.
    let second = eligible_borrower(&f, 5);
    let second_id = manager.request_loan(&second, &4_000, &DEFAULT_TERM);
    manager.approve_loan(&second_id);

    assert_eq!(
        pool.get_pool_stats(&f.token_id).pool_token_balance,
        0,
        "the second loan should have consumed the remaining idle balance"
    );
    assert_eq!(pool.get_total_outstanding(&f.token_id), 10_000);

    // And a third loan must now be refused, because there is nothing idle left.
    let third = eligible_borrower(&f, 6);
    let third_id = manager.request_loan(&third, &1, &DEFAULT_TERM);
    let result = manager.try_approve_loan(&third_id);
    assert!(
        result.is_err(),
        "with no idle liquidity left, approval must be refused"
    );
}
