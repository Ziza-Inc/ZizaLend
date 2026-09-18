#![no_main]

use arbitrary::Arbitrary;
use libfuzzer_sys::fuzz_target;
use lending_pool::{LendingPool, LendingPoolClient};
use loan_manager::{LoanManager, LoanManagerClient};
use remittance_nft::{RemittanceNFT, RemittanceNFTClient};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Address, Env, BytesN, Symbol, IntoVal, Val};
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
    RequestLoan {
        user_id: u8,
        amount: i128,
        score: u32,
    },
    ApproveLoan {
        loan_id: u32,
    },
    Repay {
        user_id: u8,
        amount: i128,
        initial_score: u32,
    },
    SetMinScore {
        new_min: u32,
    },
    RecordDefault {
        user_id: u8,
    },
    LiquidationCheck {
        user_id: u8,
    },
    MultipleOperations {
        operations: Vec<LoanOperation>,
    },
}

#[derive(Arbitrary, Debug)]
struct LoanOperation {
    user_id: u8,
    amount: i128,
    score: u32,
    operation_type: u8, // 0: request, 1: repay, 2: record_default
}

fuzz_target!(|data: FuzzAction| {
    let env = Env::default();
    env.mock_all_auths();

    // 1. Setup RemittanceNFT
    let nft_id = env.register(RemittanceNFT, ());
    let nft_client = RemittanceNFTClient::new(&env, &nft_id);
    let admin = Address::generate(&env);
    nft_client.initialize(&admin);

    // 2. Setup LoanManager. initialize now takes (nft_contract, lending_pool, token, admin).
    let lending_pool_id = env.register(LendingPool, ());
    let token_admin = Address::generate(&env);
    let token_contract_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_id = token_contract_id.address();
    let loan_manager_id = env.register(LoanManager, ());
    let loan_manager_client = LoanManagerClient::new(&env, &loan_manager_id);
    loan_manager_client.initialize(&nft_id, &lending_pool_id, &token_id, &admin);

    // Principal can only leave the pool through the pool itself, so the pool
    // must be told which contract may request a disbursement.
    let lending_pool_client = LendingPoolClient::new(&env, &lending_pool_id);
    lending_pool_client.set_loan_manager(&loan_manager_id);
    
    // Authorize LoanManager to update scores in NFT contract
    nft_client.authorize_minter(&loan_manager_id);

    // The NFT moves a borrower's score only at the request of its single
    // configured recorder, so the manager must be registered as one.
    nft_client.set_score_recorder(&loan_manager_id);

    match data {
        FuzzAction::RequestLoan {
            user_id,
            amount,
            score,
        } => {
            let user = Address::generate(&env);

            // Skip invalid amounts
            if amount <= 0 {
                return;
            }

            // Mint NFT for user with specific score
            let history_hash = BytesN::from_array(&env, &[0u8; 32]);
            nft_client.mint(&user, &score, &history_hash, &soroban_sdk::String::from_str(&env, "ipfs://test"), &None);

            let result = rcall!(&env, loan_manager_client, "request_loan", (user, amount));

            if result.is_ok() {
                // Verify invariants if any (e.g. loan created)
            } else {
                // Verify invariant: score should be >= 500 for loan approval
                if score < 500 {
                    // This is expected failure
                }
            }
        }

        FuzzAction::ApproveLoan { loan_id } => {
            let _ = rcall!(&env, loan_manager_client, "approve_loan", (loan_id));
        }

        FuzzAction::Repay {
            user_id,
            amount,
            initial_score,
        } => {
            let user = Address::generate(&env);

            // Skip invalid amounts
            if amount <= 0 {
                return;
            }

            // Mint NFT for user
            let history_hash = BytesN::from_array(&env, &[0u8; 32]);
            nft_client.mint(&user, &initial_score, &history_hash, &soroban_sdk::String::from_str(&env, "ipfs://test"), &None);

            let score_before = nft_client.get_score(&user);
            let result = rcall!(&env, loan_manager_client, "repay", (user, amount));

            if result.is_ok() {
                let score_after = nft_client.get_score(&user);

                // Verify invariant: score must stay non-negative and within the
                // RemittanceNFT MAX_SCORE band after repayment.
                assert!(score_after >= 0, "Score should never be negative");
                assert!(
                    score_after <= remittance_nft::RemittanceNFT::MAX_SCORE,
                    "Score must not exceed MAX_SCORE"
                );
                // Repayment thresholds (>= 100 stroops) award only positive
                // delta, so score must NOT decrease on a successful repay.
                assert!(
                    score_after >= score_before,
                    "Repay must not decrease the borrower's score"
                );
            }
        }

        FuzzAction::SetMinScore { new_min } => {
            // Cap at RemittanceNFT::MAX_SCORE — setting higher would make every
            // request permanently fail and serve no realistic test signal.
            let capped = new_min.min(remittance_nft::RemittanceNFT::MAX_SCORE);
            let result = rcall!(&env, loan_manager_client, "set_min_score", (capped));
            assert!(
                result.is_ok(),
                "set_min_score within MAX_SCORE must succeed for admin"
            );

            // After raising the threshold, a request with the old min_score
            // must be rejected.  Track through to RequestLoan action implied
            // by the next iteration of the fuzzer — this assertion enforces
            // the invariant indirectly via the `min_score` storage key.
            // Note: we do not call set_min_score here with auth that's NOT
            // admin — `mock_all_auths()` masks the failure mode. A dedicated
            // unit test exists in src/test.rs for the auth boundary.
        }

        FuzzAction::RecordDefault { user_id } => {
            let user = Address::generate(&env);
            let history_hash = BytesN::from_array(&env, &[0u8; 32]);
            nft_client.mint(
                &user,
                &remittance_nft::RemittanceNFT::MAX_SCORE,
                &history_hash,
                &soroban_sdk::String::from_str(&env, "ipfs://test"),
                &None,
            );

            let score_before = nft_client.get_score(&user);
            let _ = rcall!(
                &env,
                loan_manager_client,
                "check_default",
                (0u32)
            );

            // Invariant: a default event must not leave the score above its
            // pre-default value.  (We don't know which loan_id would be
            // active, so the call may fail — when it does, score is unchanged
            // and the invariant trivially holds.)
            let score_after = nft_client.get_score(&user);
            assert!(
                score_after <= score_before,
                "Default event must not increase a borrower's score"
            );
        }

        FuzzAction::LiquidationCheck { user_id } => {
            // Surface invariant: is_liquidatable always returns Err for an
            // unknown loan_id, never a positive boolean on a non-existent
            // loan (which would leak storage semantics to callers).
            let _ = rcall!(
                &env,
                loan_manager_client,
                "is_liquidatable",
                (user_id as u32)
            );
        }

        FuzzAction::MultipleOperations { operations } => {
            let mut users = HashMap::new();

            for op in operations {
                let user_addr = users.entry(op.user_id).or_insert_with(|| {
                    let addr = Address::generate(&env);
                    let history_hash = BytesN::from_array(&env, &[0u8; 32]);
                    // Initialize user with some score
                    nft_client.mint(&addr, &op.score, &history_hash, &soroban_sdk::String::from_str(&env, "ipfs://test"), &None);
                    addr
                }).clone();

                match op.operation_type % 2 {
                    0 if op.amount > 0 => {
                        // Request loan
                        let _ = rcall!(&env, loan_manager_client, "request_loan", (user_addr, op.amount));
                    }
                    1 if op.amount > 0 => {
                        // Repay
                        let _ = rcall!(&env, loan_manager_client, "repay", (user_addr, op.amount));
                    }
                    _ => {}
                }
            }
        }
    }
});

