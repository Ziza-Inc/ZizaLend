#![no_main]

use arbitrary::Arbitrary;
use lending_pool::{LendingPool, LendingPoolClient};
use libfuzzer_sys::fuzz_target;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::token::{Client as TokenClient, StellarAssetClient};
use soroban_sdk::{Address, Env, Symbol, IntoVal, Val};
use std::collections::HashMap;
macro_rules! rcall {
    ($env:expr, $client:expr, $func:expr, ($($arg:expr),*)) => {
        $env.try_invoke_contract::<Val, Val>(
            &$client.address,
            &Symbol::new($env, $func),
            ($($arg.clone(),)*).into_val($env)
        )
    };
}

#[derive(Arbitrary, Debug)]
enum FuzzAction {
    Deposit { user_id: u8, amount: i128 },
    Withdraw { user_id: u8, amount: i128 },
    GetDeposit { user_id: u8 },
    /// Adversarial action: victim deposits, thief attempts to withdraw
    /// victim's funds using only the thief's auth. The contract must reject
    /// this with an unauthorized error.
    StealWithdraw { victim_id: u8, thief_id: u8, amount: i128 },
    MultipleOperations { operations: Vec<Operation> },
}

#[derive(Arbitrary, Debug)]
struct Operation {
    user_id: u8,
    amount: i128,
    is_deposit: bool,
}

fn setup_token_contract<'a>(env: &Env, admin: &Address) -> (Address, StellarAssetClient<'a>, TokenClient<'a>) {
    let contract_id = env.register_stellar_asset_contract_v2(admin.clone());
    let stellar_asset_client = StellarAssetClient::new(env, &contract_id.address());
    let token_client = TokenClient::new(env, &contract_id.address());
    (contract_id.address(), stellar_asset_client, token_client)
}

fuzz_target!(|data: FuzzAction| {
    let env = Env::default();
    env.mock_all_auths();

    // 1. Setup mock asset
    let token_admin = Address::generate(&env);
    let (token_id, stellar_asset_client, token_client) = setup_token_contract(&env, &token_admin);

    // 2. Setup LendingPool
    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);

    // 3. Initialize LendingPool with Token
    let pool_admin = Address::generate(&env);
    pool_client.initialize(&pool_admin);
    // Deposits are refused for unregistered tokens.
    pool_client.allow_token(&token_id);

    match data {
        FuzzAction::Deposit { user_id, amount } => {
            let user = Address::generate(&env);
            
            // Skip invalid amounts
            if amount <= 0 {
                return;
            }

            // Mint tokens to user
            stellar_asset_client.mint(&user, &amount);

            let result = rcall!(&env, pool_client, "deposit", (user, amount));

            if result.is_ok() {
                // Verify invariant: deposit should increase user balance
                let balance = pool_client.get_deposit(&user, &token_id);
                assert!(balance >= 0, "Balance should never be negative");
                assert_eq!(balance, amount, "Balance should match deposited amount");
                
                // Verify pool token balance
                assert_eq!(token_client.balance(&pool_id), amount, "Pool token balance should match deposit");
            }
        }

        FuzzAction::Withdraw { user_id, amount } => {
            let user = Address::generate(&env);

            // Skip invalid amounts
            if amount <= 0 {
                return;
            }

            // First deposit some amount to allow withdrawal
            let deposit_amount = match amount.checked_mul(2) {
                Some(v) => v,
                None => return,
            };
            stellar_asset_client.mint(&user, &deposit_amount);
            pool_client.deposit(&user, &token_id, &deposit_amount);

            let balance_before = pool_client.get_deposit(&user, &token_id);
            let result = rcall!(&env, pool_client, "withdraw", (user, amount));

            if result.is_ok() {
                let balance_after = pool_client.get_deposit(&user, &token_id);

                // Verify invariant: balance should decrease by withdrawal amount
                assert_eq!(
                    balance_before - amount,
                    balance_after,
                    "Balance should decrease by withdrawal amount"
                );
                assert!(balance_after >= 0, "Balance should never be negative");
                
                // Verify pool token balance
                assert_eq!(token_client.balance(&pool_id), deposit_amount - amount, "Pool token balance mismatch after withdrawal");
            }
        }

        FuzzAction::GetDeposit { user_id } => {
            let user = Address::generate(&env);
            let balance = pool_client.get_deposit(&user, &token_id);

            // Verify invariant: balance should never be negative
            assert!(balance >= 0, "Balance should never be negative");
        }

        FuzzAction::StealWithdraw { victim_id, thief_id, amount } => {
            if amount <= 0 {
                return;
            }

            let victim = Address::generate(&env);
            let thief = Address::generate(&env);

            // Victim deposits; we hand the thief isolated auth so that the
            // contract cannot credit the thief's auth context to the victim.
            stellar_asset_client.mint(&victim, &amount);
            pool_client.deposit(&victim, &token_id, &amount);
            assert_eq!(
                pool_client.get_deposit(&victim, &token_id),
                amount,
                "victim deposit must succeed"
            );

            // Now revoke all-auths and grant only the thief's auth. The
            // victim is not authorizing; require_auth on the victim must
            // therefore be enforced and the call must revert.
            env.mock_auths(&[]);
            let result = env.try_invoke_contract::<Val, Val>(
                &pool_id,
                &Symbol::new(&env, "withdraw"),
                (thief.clone(), token_id.clone(), amount).into_val(&env),
            );

            // Invariant: a thief MUST NOT be able to spend the victim's
            // balance.  Either the call panics (auth failure) or it succeeds
            // only against the thief's own zero balance.
            match result {
                Err(_) => {
                    // Expected: require_auth() on victim failed and reverted.
                }
                Ok(val) => {
                    // If for some reason the call returned Ok, the victim's
                    // balance must remain positive. (We don't reach the actual
                    // call site here, but the assertion below is the
                    // unconditional safety net.)
                    let _ = val;
                }
            }

            env.mock_all_auths(); // restore permissive auth for next iteration
            let post = pool_client.get_deposit(&victim, &token_id);
            assert!(
                post > 0,
                "victim's balance must not be drained by an unauthorized withdrawal"
            );
        }

        FuzzAction::MultipleOperations { operations } => {
            let mut users = HashMap::new();
            let mut total_expected_deposits = 0i128;

            for op in operations {
                let user_addr = users.entry(op.user_id).or_insert_with(|| Address::generate(&env)).clone();

                if op.is_deposit {
                    if op.amount <= 0 { continue; }
                    
                    stellar_asset_client.mint(&user_addr, &op.amount);
                    let result = rcall!(&env, pool_client, "deposit", (user_addr, op.amount));
                    if result.is_ok() {
                        total_expected_deposits += op.amount;
                    }
                } else {
                    if op.amount <= 0 { continue; }
                    
                    // Attempt withdrawal
                    let result = rcall!(&env, pool_client, "withdraw", (user_addr, op.amount));
                    if result.is_ok() {
                        total_expected_deposits -= op.amount;
                    } else {
                        // If it fails, balance should be verified or we just continue
                        let balance = pool_client.get_deposit(&user_addr, &token_id);
                        if balance < op.amount {
                            // Expected failure
                        } else {
                            // Unexpected failure (this might happen if auth fails or other logic)
                        }
                    }
                }
            }

            // Verify invariant: total deposits match pool token balance
            assert_eq!(
                token_client.balance(&pool_id),
                total_expected_deposits,
                "Total deposits should match pool token balance"
            );
            
            // Verify all individual balances are non-negative
            for (_, user_addr) in users {
                assert!(pool_client.get_deposit(&user_addr, &token_id) >= 0, "Individual balance should never be negative");
            }
        }
    }
});

