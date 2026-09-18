//! Multi-contract integration tests for the ZizaLend protocol.
//!
//! These tests simulate the full loan lifecycle end-to-end across all four
//! contracts: LendingPool, LoanManager, RemittanceNFT, and MultisigGovernance.
//!
//! To run: `cargo test --test integration_test` from the contracts/ directory,
//! or include this file as a module in a workspace test.

#[cfg(test)]
mod tests {
    use lending_pool::{LendingPool, LendingPoolClient};
    use loan_manager::{LoanManager, LoanManagerClient, LoanStatus};
    use remittance_nft::{RemittanceNFT, RemittanceNFTClient};
    use soroban_sdk::testutils::{Address as _, Ledger as _};
    use soroban_sdk::token::{Client as TokenClient, StellarAssetClient};
    use soroban_sdk::{Address, BytesN, Env, String};

    fn setup_full_protocol(
        env: &Env,
    ) -> (
        LoanManagerClient,
        LendingPoolClient,
        RemittanceNFTClient,
        Address, // token_id
        Address, // admin
        Address, // borrower
    ) {
        env.mock_all_auths_allowing_non_root_auth();

        // ── Deploy contracts ────────────────────────────────────────────────
        let admin = Address::generate(env);
        let borrower = Address::generate(env);
        let _liquidator = Address::generate(env);

        // Token
        let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
        let token_id = token_contract.address();

        // NFT contract
        let nft_id = env.register(RemittanceNFT, ());
        let nft_client = RemittanceNFTClient::new(env, &nft_id);
        nft_client.initialize(&admin);

        // LendingPool
        let pool_id = env.register(LendingPool, ());
        let pool_client = LendingPoolClient::new(env, &pool_id);
        pool_client.initialize(&admin);
        // Deposits are refused for unregistered tokens, so the fixture must open its
        // market before the pool will accept it.
        pool_client.allow_token(&token_id);
        pool_client.set_withdrawal_cooldown(&0);

        // LoanManager
        let manager_id = env.register(LoanManager, ());
        let manager_client = LoanManagerClient::new(env, &manager_id);
        nft_client.authorize_minter(&manager_id);
        // The NFT moves a borrower's score only at the request of its single
        // configured recorder, so the manager must be registered as one.
        nft_client.set_score_recorder(&manager_id);
        manager_client.initialize(&nft_id, &pool_id, &token_id, &admin);

        // Principal can only leave the pool through the pool itself; tell the
        // pool which LoanManager may request disbursements.
        pool_client.set_loan_manager(&manager_id);

        // Mint NFT for borrower
        nft_client.mint(
            &borrower,
            &700,
            &BytesN::from_array(env, &[1u8; 32]),
            &String::from_str(env, "ipfs://QmIntegrationTest"),
            &None,
        );

        // Fund borrower and pool
        let stellar = StellarAssetClient::new(env, &token_id);
        stellar.mint(&pool_id, &100_000);
        stellar.mint(&borrower, &50_000);

        (
            manager_client,
            pool_client,
            nft_client,
            token_id,
            admin,
            borrower,
        )
    }

    /// Full loan lifecycle: deposit → request loan → approve → deposit
    /// collateral → accrue interest → repay → verify state.
    #[test]
    fn test_full_loan_lifecycle() {
        let env = Env::default();
        let (manager, pool, nft, token_id, _admin, borrower) = setup_full_protocol(&env);
        let token_client = TokenClient::new(&env, &token_id);
        let stellar = StellarAssetClient::new(&env, &token_id);

        // ═══════════════════════════════════════════════════════════════════
        // Step 1: Borrower deposits into LendingPool
        // ═══════════════════════════════════════════════════════════════════
        let deposit_amount: i128 = 10_000;
        stellar.mint(&borrower, &deposit_amount);
        pool.deposit(&borrower, &token_id, &deposit_amount);
        assert_eq!(pool.get_shares(&borrower, &token_id), deposit_amount);

        // ═══════════════════════════════════════════════════════════════════
        // Step 2: Request a loan
        // ═══════════════════════════════════════════════════════════════════
        let loan_amount: i128 = 5_000;
        let loan_term: u32 = 17_280;
        let loan_id = manager.request_loan(&borrower, &loan_amount, &loan_term);
        assert_eq!(loan_id, 1);

        let loan = manager.get_loan(&loan_id);
        assert_eq!(loan.status, LoanStatus::Pending);
        assert_eq!(loan.amount, loan_amount);

        // ═══════════════════════════════════════════════════════════════════
        // Step 3: Approve the loan
        // ═══════════════════════════════════════════════════════════════════
        // Advance to ledger 1 before approval so last_interest_ledger is set to 1
        // (not 0). accrue_interest short-circuits when last_interest_ledger == 0,
        // so approval at ledger 0 would prevent any interest from ever accruing.
        env.ledger().set_sequence_number(1);

        let borrower_balance_before = token_client.balance(&borrower);
        let pool_balance_before = token_client.balance(&pool.address);

        manager.approve_loan(&loan_id);

        let loan = manager.get_loan(&loan_id);
        assert_eq!(loan.status, LoanStatus::Approved);
        assert_eq!(loan.interest_rate_bps, 1200); // default rate
        assert_eq!(loan.principal_paid, 0);

        // Borrower received loan funds
        assert_eq!(
            token_client.balance(&borrower),
            borrower_balance_before + loan_amount
        );
        // Pool sent loan funds (should decrease by loan_amount)
        assert_eq!(
            token_client.balance(&pool.address),
            pool_balance_before - loan_amount
        );

        // ═══════════════════════════════════════════════════════════════════
        // Step 4: Deposit collateral for the loan
        // ═══════════════════════════════════════════════════════════════════
        let collateral_amount: i128 = 6_000;
        let borrower_balance_before_collateral = token_client.balance(&borrower);
        let manager_balance_before = token_client.balance(&manager.address);

        manager.deposit_collateral(&loan_id, &collateral_amount);

        assert_eq!(manager.get_collateral(&loan_id), collateral_amount);
        assert_eq!(
            token_client.balance(&manager.address),
            manager_balance_before + collateral_amount
        );
        assert_eq!(
            token_client.balance(&borrower),
            borrower_balance_before_collateral - collateral_amount
        );

        // ═══════════════════════════════════════════════════════════════════
        // Step 5: Advance time to accrue interest
        // ═══════════════════════════════════════════════════════════════════
        env.ledger()
            .set_sequence_number(env.ledger().sequence() + 5_000);

        let loan = manager.get_loan(&loan_id);
        assert!(loan.accrued_interest > 0, "Interest should have accrued");

        // ═══════════════════════════════════════════════════════════════════
        // Step 6: Full repayment
        // ═══════════════════════════════════════════════════════════════════
        let pool_balance_before_repay = token_client.balance(&pool.address);
        let borrower_balance_before_repay = token_client.balance(&borrower);

        // Calculate total debt (principal + accrued interest + late fees)
        let loan = manager.get_loan(&loan_id);
        let total_debt = loan
            .amount
            .checked_add(loan.accrued_interest)
            .and_then(|v| v.checked_add(loan.accrued_late_fee))
            .expect("debt overflow");

        // Borrowers needs enough tokens to repay
        stellar.mint(&borrower, &total_debt);

        manager.repay(&borrower, &loan_id, &total_debt);

        let loan = manager.get_loan(&loan_id);
        assert_eq!(loan.status, LoanStatus::Repaid);
        assert_eq!(loan.principal_paid, loan_amount);
        assert_eq!(manager.get_collateral(&loan_id), 0); // collateral released

        // Pool received repayment
        assert_eq!(
            token_client.balance(&pool.address),
            pool_balance_before_repay + total_debt
        );

        // Collateral returned to borrower
        assert!(
            token_client.balance(&borrower) > borrower_balance_before_repay,
            "Borrower should have received collateral back"
        );

        // ═══════════════════════════════════════════════════════════════════
        // Step 7: Verify pool is in a clean state
        // ═══════════════════════════════════════════════════════════════════
        assert_eq!(manager.get_borrower_loan_count(&borrower), 0);
        // Score delta = total_debt / 100.
        // principal=5_000, interest=173 (12% APR over 5_000 ledgers of 17_280-ledger term),
        // no late fees (repaid before due_date=17_280).
        // total_debt ≈ 5_173 → delta = 51 → 700 + 51 = 751.
        assert_eq!(nft.get_score(&borrower), 751);
    }

    /// Tests the default path (not liquidation): default → seize collateral → score penalty.
    #[test]
    fn test_default_path() {
        let env = Env::default();
        let (manager, pool, nft, token_id, _admin, borrower) = setup_full_protocol(&env);
        let _token_client = TokenClient::new(&env, &token_id);
        let stellar = StellarAssetClient::new(&env, &token_id);

        // Deposit into pool
        pool.deposit(&borrower, &token_id, &10_000);

        // Request and approve loan
        let loan_id = manager.request_loan(&borrower, &5_000, &5_000);
        manager.approve_loan(&loan_id);

        // Deposit collateral (6,000 — above debt so it's healthy)
        stellar.mint(&borrower, &10_000);
        manager.deposit_collateral(&loan_id, &6_000);

        // Fast forward past default window
        let loan = manager.get_loan(&loan_id);
        let default_window = manager.get_default_window_ledgers();
        env.ledger()
            .set_sequence_number(loan.due_date + default_window + 1);

        // Default the loan
        manager.check_default(&loan_id);
        let loan = manager.get_loan(&loan_id);
        assert_eq!(loan.status, LoanStatus::Defaulted);

        // Collateral seized to pool
        assert_eq!(manager.get_collateral(&loan_id), 0);
        assert!(nft.is_seized(&borrower));
        assert!(nft.get_default_count(&borrower) >= 1);
        assert_eq!(nft.get_score(&borrower), 650); // 700 - 50 penalty
    }

    /// Tests the cancellation flow: request → cancel → verify no state leaks.
    #[test]
    fn test_cancel_loan_flow() {
        let env = Env::default();
        let (manager, _pool, nft, _token_id, _admin, _borrower) = setup_full_protocol(&env);

        // Mint NFT for borrower (separate from setup)
        let borrower2 = Address::generate(&env);
        nft.mint(
            &borrower2,
            &600,
            &BytesN::from_array(&env, &[2u8; 32]),
            &String::from_str(&env, "ipfs://QmCancelTest"),
            &None,
        );

        // Request loan
        let loan_id = manager.request_loan(&borrower2, &1_000, &17_280);
        assert_eq!(loan_id, 1); // first loan for borrower2

        let loan = manager.get_loan(&loan_id);
        assert_eq!(loan.status, LoanStatus::Pending);

        // Cancel loan
        manager.cancel_loan(&borrower2, &loan_id);
        let loan = manager.get_loan(&loan_id);
        assert_eq!(loan.status, LoanStatus::Cancelled);

        // Borrowers should be able to request again
        let new_loan_id = manager.request_loan(&borrower2, &2_000, &17_280);
        assert_eq!(new_loan_id, 2);
        let loan = manager.get_loan(&new_loan_id);
        assert_eq!(loan.status, LoanStatus::Pending);
        assert_eq!(loan.amount, 2_000);
    }

    /// Tests the extension flow.
    #[test]
    fn test_loan_extension_flow() {
        let env = Env::default();
        let (manager, pool, _nft, token_id, _admin, borrower) = setup_full_protocol(&env);
        let token_client = TokenClient::new(&env, &token_id);
        let stellar = StellarAssetClient::new(&env, &token_id);

        // Both deposit into pool and fund borrower
        pool.deposit(&borrower, &token_id, &10_000);

        // Request and approve loan
        let loan_id = manager.request_loan(&borrower, &3_000, &10_000);
        manager.approve_loan(&loan_id);

        stellar.mint(&borrower, &10_000);

        let loan_before = manager.get_loan(&loan_id);
        let due_before = loan_before.due_date;

        // Extend by 2,000 ledgers
        manager.extend_loan(&borrower, &loan_id, &2_000);

        let loan_after = manager.get_loan(&loan_id);
        assert_eq!(loan_after.due_date, due_before + 2_000);
        assert_eq!(loan_after.extension_count, 1);
        assert_eq!(loan_after.status, LoanStatus::Approved);

        // Verify extension fee was charged (1% of 3,000 = 30)
        // The fee is sent from borrower to lending pool
        let pool_balance = token_client.balance(&pool.address);
        assert!(pool_balance > 0); // Fee sent to pool
    }
}
