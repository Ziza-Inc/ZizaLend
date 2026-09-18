//! Acceptance tests for the disbursement-authorization fix.
//!
//! These exercise the loan lifecycle under *realistic* Soroban authorization —
//! only the authorizations a real transaction would carry — rather than under
//! `mock_all_auths*`, which is what the rest of the suite relies on.
//!
//! Before the fix, `approve_loan` moved principal with
//! `token.transfer(&lending_pool, &borrower, ..)`. A contract address authorises
//! only implicitly, so that transfer was permanently unauthorized and the loan
//! could never be funded. `approve_loan` now asks the pool to disburse, which
//! makes the pool the executing contract.

use lending_pool::{LendingPool, LendingPoolClient};
use loan_manager::{LoanError, LoanManager, LoanManagerClient};
use remittance_nft::{RemittanceNFT, RemittanceNFTClient};
use soroban_sdk::testutils::{Address as _, Ledger as _, MockAuth, MockAuthInvoke};
use soroban_sdk::token::{Client as TokenClient, StellarAssetClient};
use soroban_sdk::{Address, BytesN, Env, IntoVal, String, Symbol};

const LENDER_DEPOSIT: i128 = 100_000;
const LOAN_AMOUNT: i128 = 5_000;

struct Fixture {
    env: Env,
    admin: Address,
    borrower: Address,
    lender: Address,
    manager_id: Address,
    pool_id: Address,
    token_id: Address,
    loan_id: u32,
}

/// Deploys the full protocol, funds the pool through a real `deposit` so the
/// share price is meaningful, and creates one pending loan.
fn setup() -> Fixture {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let admin = Address::generate(&env);
    let borrower = Address::generate(&env);
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

    nft.mint(
        &borrower,
        &700,
        &BytesN::from_array(&env, &[1u8; 32]),
        &String::from_str(&env, "ipfs://review"),
        &None,
    );

    // Fund the pool through a genuine deposit so LP shares exist.
    stellar.mint(&lender, &LENDER_DEPOSIT);
    pool.deposit(&lender, &token_id, &LENDER_DEPOSIT);

    // Interest accrual short-circuits at ledger 0, so approve at ledger 1.
    env.ledger().set_sequence_number(1);

    let loan_id = manager.request_loan(&borrower, &LOAN_AMOUNT, &17_280);

    Fixture {
        env,
        admin,
        borrower,
        lender,
        manager_id,
        pool_id,
        token_id,
        loan_id,
    }
}

/// The core regression test: with only the admin's authorization — exactly what
/// `buildApproveLoanTx` produces — the borrower must actually receive principal.
#[test]
fn approve_loan_disburses_principal_under_realistic_auth() {
    let f = setup();
    let env = &f.env;
    let manager = LoanManagerClient::new(env, &f.manager_id);
    let pool = LendingPoolClient::new(env, &f.pool_id);
    let token = TokenClient::new(env, &f.token_id);

    let share_price_before = pool.get_share_price(&f.token_id);

    // Realistic authorization: the admin authorizes `approve_loan` and nothing
    // else. The pool's and the LoanManager's authorizations must come from the
    // call stack, not from a signature.
    env.mock_auths(&[MockAuth {
        address: &f.admin,
        invoke: &MockAuthInvoke {
            contract: &f.manager_id,
            fn_name: "approve_loan",
            args: (f.loan_id,).into_val(env),
            sub_invokes: &[],
        },
    }]);

    let outcome = env.try_invoke_contract::<(), LoanError>(
        &f.manager_id,
        &Symbol::new(env, "approve_loan"),
        (f.loan_id,).into_val(env),
    );

    assert!(
        outcome.is_ok(),
        "approve_loan must succeed under realistic auth; got {outcome:?}"
    );

    // Principal actually reached the borrower.
    assert_eq!(
        token.balance(&f.borrower),
        LOAN_AMOUNT,
        "borrower must receive the loan principal"
    );

    // The loan is funded out of idle liquidity...
    assert_eq!(token.balance(&f.pool_id), LENDER_DEPOSIT - LOAN_AMOUNT);
    assert_eq!(pool.get_total_outstanding(&f.token_id), LOAN_AMOUNT);

    // ...and is recorded as outstanding, so the pool's total assets and the LP
    // share price are unchanged by disbursement. That is the invariant that makes
    // LP shares represent a claim on deployed capital rather than only idle cash.
    let stats = pool.get_pool_stats(&f.token_id);
    assert_eq!(stats.pool_token_balance, LENDER_DEPOSIT - LOAN_AMOUNT);
    assert_eq!(
        stats.pool_token_balance + LOAN_AMOUNT,
        LENDER_DEPOSIT,
        "idle balance plus outstanding must still equal total pool assets"
    );
    assert_eq!(
        pool.get_share_price(&f.token_id),
        share_price_before,
        "disbursement must not change the LP share price"
    );

    // The loan itself is Approved and the lender still holds their shares.
    let loan = manager.get_loan(&f.loan_id);
    assert_eq!(loan.status, loan_manager::LoanStatus::Approved);
    assert_eq!(pool.get_shares(&f.lender, &f.token_id), LENDER_DEPOSIT);
}

/// The pool's disbursement entry point must reject anyone who is not the
/// configured LoanManager — in particular a caller that is not in the pool's
/// call stack and carries no authorization at all.
#[test]
fn disburse_rejects_callers_that_are_not_the_loan_manager() {
    let f = setup();
    let env = &f.env;
    let attacker = Address::generate(env);

    // No authorizations at all.
    env.mock_auths(&[]);

    let outcome = env.try_invoke_contract::<(), lending_pool::PoolError>(
        &f.pool_id,
        &Symbol::new(env, "disburse"),
        (f.token_id.clone(), attacker.clone(), 1_000i128).into_val(env),
    );

    assert!(
        outcome.is_err(),
        "an arbitrary caller must not be able to disburse pool funds; got {outcome:?}"
    );

    let token = TokenClient::new(env, &f.token_id);
    assert_eq!(token.balance(&attacker), 0);
    assert_eq!(token.balance(&f.pool_id), LENDER_DEPOSIT);
}

/// Control: the pool *can* move its own tokens when it is the executing
/// contract, which is precisely why routing disbursement through the pool works.
#[test]
fn pool_moves_its_own_tokens_on_withdraw() {
    let f = setup();
    let env = &f.env;
    let token = TokenClient::new(env, &f.token_id);

    // Advance past the minimum share hold time.
    env.ledger()
        .set_sequence_number(env.ledger().sequence() + 10);

    env.mock_auths(&[MockAuth {
        address: &f.lender,
        invoke: &MockAuthInvoke {
            contract: &f.pool_id,
            fn_name: "withdraw",
            args: (f.lender.clone(), f.token_id.clone(), LENDER_DEPOSIT).into_val(env),
            sub_invokes: &[],
        },
    }]);

    let outcome = env.try_invoke_contract::<(), lending_pool::PoolError>(
        &f.pool_id,
        &Symbol::new(env, "withdraw"),
        (f.lender.clone(), f.token_id.clone(), LENDER_DEPOSIT).into_val(env),
    );

    assert!(
        outcome.is_ok(),
        "the pool must be able to move its own tokens; got {outcome:?}"
    );
    assert_eq!(token.balance(&f.lender), LENDER_DEPOSIT);
}
