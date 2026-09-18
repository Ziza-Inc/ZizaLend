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
    // Deposits are refused for unregistered tokens, so the fixture must open its
    // market before the pool will accept it.
    pool.allow_token(&token_id);
    pool.set_withdrawal_cooldown(&0);

    let manager_id = env.register(LoanManager, ());
    let manager = LoanManagerClient::new(&env, &manager_id);
    nft.authorize_minter(&manager_id);
    // The NFT moves a borrower's score only at the request of its single
    // configured recorder, so the manager must be registered as one.
    nft.set_score_recorder(&manager_id);
    manager.initialize(&nft_id, &pool_id, &token_id, &admin);

    // The pool must be told which contract may request disbursements.
    pool.set_loan_manager(&manager_id);

    if deposit > 0 {
        stellar.mint(&lender, &deposit);
        pool.deposit(&lender, &token_id, &deposit);
    }

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

    // The projection: interest is a function of elapsed ledgers, and this reads it
    // without writing it. `get_loan` still reports no accrual because nothing has
    // happened to the loan yet.
    let loan = manager.get_loan_accrued(&loan_id);
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

/// `TotalDeposits` is a principal cost basis, so yield must neither shrink it nor
/// make an idle pool look lent out, and the `MaxPoolSize` cap must bind against
/// real principal rather than against a drifted figure.
///
/// The bug this pins: `redeem_shares` reduced the basis by `assets_to_return`,
/// which includes accrued yield. Every redemption therefore wrote off yield from
/// tracked principal, permanently understating the basis and effectively raising
/// the cap.
#[test]
fn yield_does_not_shrink_the_principal_basis_or_breach_the_cap() {
    let f = setup(0);
    let pool = LendingPoolClient::new(&f.env, &f.pool_id);
    let stellar = StellarAssetClient::new(&f.env, &f.token_id);

    let a = Address::generate(&f.env);
    let b = Address::generate(&f.env);

    pool.set_max_pool_size(&f.token_id, &600);

    stellar.mint(&a, &300);
    stellar.mint(&b, &300);
    pool.deposit(&a, &f.token_id, &300);
    pool.deposit(&b, &f.token_id, &300);
    assert_eq!(pool.get_total_deposits(&f.token_id), 600);

    // 60 units of yield arrive. Utilisation must stay at zero -- nothing is lent
    // out, and yield sitting in the pool is not deployed capital.
    stellar.mint(&f.pool_id, &60);
    let stats = pool.get_pool_stats(&f.token_id);
    assert_eq!(
        stats.utilization_bps, 0,
        "idle yield must not read as borrowing"
    );
    assert_eq!(
        stats.total_deposits, 600,
        "yield must not alter the principal basis"
    );

    // A withdraws all 300 shares. The share price is 660/600 = 1.1, so they receive
    // 330 -- but the basis must fall by the 300 of principal they contributed, not
    // by the 330 of assets they were paid.
    f.env
        .ledger()
        .set_sequence_number(f.env.ledger().sequence() + 10);
    pool.withdraw(&a, &f.token_id, &300);
    assert_eq!(
        pool.get_total_deposits(&f.token_id),
        300,
        "the basis must fall by principal redeemed, not by assets paid out"
    );

    // The cap must still bind against real principal. The old behaviour would have
    // left the basis at 270 (600 - 330) and let a further 330 in, breaching the cap.
    let too_much = pool.try_deposit(&b, &f.token_id, &330);
    // A contract-level rejection surfaces as Err(Ok(PoolError)), not Err(_).
    assert!(
        matches!(too_much, Err(Ok(_))),
        "the cap must reject a deposit that would exceed it on a principal basis"
    );
}

/// The truncation remainder from a floored redemption stays in the pool and
/// accrues to the remaining holders. It is deliberately never extracted.
///
/// This replaces the removed `collect_dust` mechanism, which was wrong three
/// ways: it computed `expected_value - assets_to_return` where both operands were
/// the same expression, so it always recorded zero; it stored a single global
/// counter while `collect_dust(token)` paid out in a caller-chosen token, so dust
/// accrued in one market could be drained from another; and had the computation
/// been fixed it would have leaked LP value to the admin, breaking
/// `total_pool_assets = idle + outstanding` since assets would leave with no
/// shares burned.
#[test]
fn truncating_redemption_accrues_to_remaining_holders() {
    let f = setup(0);
    let pool = LendingPoolClient::new(&f.env, &f.pool_id);
    let token = TokenClient::new(&f.env, &f.token_id);
    let stellar = StellarAssetClient::new(&f.env, &f.token_id);

    let a = Address::generate(&f.env);
    let b = Address::generate(&f.env);

    // Equal deposits, so shares and assets start equal at 1:1. Amounts must clear
    // MIN_DEPOSIT_AMOUNT (100).
    stellar.mint(&a, &300);
    stellar.mint(&b, &300);
    pool.deposit(&a, &f.token_id, &300);
    pool.deposit(&b, &f.token_id, &300);
    assert_eq!(pool.get_share_price(&f.token_id), SHARE_PRICE_SCALE);

    // Simulate one unit of yield arriving in the pool. Assets (601) now exceed
    // shares (600), so redemption has to floor.
    stellar.mint(&f.pool_id, &1);
    let price_before = pool.get_share_price(&f.token_id);
    // (601 + 1) * SHARE_PRICE_SCALE / (600 + 1), on the virtual offset.
    assert_eq!(price_before, 1_001_663);

    // Advance past the minimum share hold time, then redeem one share.
    f.env
        .ledger()
        .set_sequence_number(f.env.ledger().sequence() + 10);
    pool.withdraw(&a, &f.token_id, &1);

    // The redeemer received floor(1 * 601 / 600) == 1, not 1.00166...
    assert_eq!(token.balance(&a), 1);
    // The truncated remainder stayed in the pool...
    assert_eq!(token.balance(&f.pool_id), 600);
    // ...so the remaining shares became worth more, not less.
    assert!(
        pool.get_share_price(&f.token_id) > price_before,
        "a floored redemption must raise, never lower, the share price"
    );
    // Nothing was extracted to the admin.
    assert_eq!(token.balance(&pool.get_admin()), 0);
    // The pool still covers every remaining holder's claim, with the remainder
    // sitting on top as unclaimed dust owned by the remaining shares.
    let a_claim = pool.get_deposit(&a, &f.token_id);
    let b_claim = pool.get_deposit(&b, &f.token_id);
    assert!(
        a_claim + b_claim <= token.balance(&f.pool_id),
        "the pool must hold at least the sum of all holders' claims"
    );
}

/// The first-depositor inflation attack must cost the attacker more than it yields.
///
/// The attack: take the smallest allowed position, then send tokens straight to the
/// pool address. A direct transfer raises `total_assets` without minting shares, so a
/// later depositor's `floor(amount * shares / assets)` rounds down and the attacker
/// redeems at the inflated price, keeping the difference. Repeated against a fresh
/// pool it drains one victim at a time.
///
/// `calc_shares_to_mint`/`calc_assets_to_redeem` credit a virtual share and asset to
/// both sides of every conversion, so a donation is shared with that virtual position
/// instead of being captured by its sender. This sweeps several donation and victim
/// sizes. Against the pre-offset implementation every row below nets the attacker a
/// profit (the first row alone returns 9,117 for a 9,100 outlay); every row must now
/// return no more than was put in.
#[test]
fn donation_inflation_attack_is_unprofitable_for_the_attacker() {
    for (donation, victim_deposit) in [
        (9_000_i128, 200_i128),
        (9_000, 1_000),
        (100_000, 5_000),
        (1_000_000, 50_000),
    ] {
        let f = setup(0);
        let pool = LendingPoolClient::new(&f.env, &f.pool_id);
        let token = TokenClient::new(&f.env, &f.token_id);
        let stellar = StellarAssetClient::new(&f.env, &f.token_id);

        let attacker = Address::generate(&f.env);
        let victim = Address::generate(&f.env);

        // 1. The attacker takes the smallest allowed position: 100 tokens, 100 shares.
        stellar.mint(&attacker, &100);
        pool.deposit(&attacker, &f.token_id, &100);
        assert_eq!(pool.get_shares(&attacker, &f.token_id), 100);

        // 2. The attacker donates directly, minting no shares.
        stellar.mint(&f.pool_id, &donation);

        // 3. The victim deposits.
        stellar.mint(&victim, &victim_deposit);
        let victim_result = pool.try_deposit(&victim, &f.token_id, &victim_deposit);
        if matches!(victim_result, Err(Ok(_))) {
            // Refusing the deposit is a safe outcome: the victim keeps their tokens
            // instead of buying worthless shares.
            assert_eq!(
                token.balance(&victim),
                victim_deposit,
                "a refused deposit must leave the victim's funds untouched"
            );
            continue;
        }
        assert!(
            pool.get_shares(&victim, &f.token_id) >= 1,
            "an accepted deposit must not mint zero shares"
        );

        // 4. The attacker exits with everything they hold.
        f.env
            .ledger()
            .set_sequence_number(f.env.ledger().sequence() + 10);
        let attacker_shares = pool.get_shares(&attacker, &f.token_id);
        pool.withdraw(&attacker, &f.token_id, &attacker_shares);

        let attacker_in = 100 + donation;
        let attacker_out = token.balance(&attacker);
        assert!(
            attacker_out <= attacker_in,
            "attack must not be profitable: donated {donation} plus a 100 position = \
             {attacker_in} outlay, exited with {attacker_out}"
        );

        // 5. The victim exits too, and the attacker's loss must be at least the
        //    damage they did. A griefing attack that costs less than the harm it
        //    causes would still be worth mounting even without a profit.
        f.env
            .ledger()
            .set_sequence_number(f.env.ledger().sequence() + 10);
        let victim_shares = pool.get_shares(&victim, &f.token_id);
        pool.withdraw(&victim, &f.token_id, &victim_shares);

        let attacker_loss = attacker_in - attacker_out;
        let victim_out = token.balance(&victim);
        assert!(
            victim_out >= 0,
            "the victim must be able to exit with a non-negative balance"
        );
        assert!(
            victim_out >= victim_deposit || attacker_loss >= victim_deposit - victim_out,
            "griefing must cost the attacker at least the damage done: attacker lost \
             {attacker_loss}, victim deposited {victim_deposit} and recovered {victim_out}"
        );
    }
}
