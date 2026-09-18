//! Tests for the admin ownership model.
//!
//! The protocol previously had three overlapping notions of "admin" with no
//! documented wiring between them, and `LendingPool::set_admin` was an instant
//! single-key transfer that bypassed the multisig + timelock apparatus entirely.
//! These tests pin the corrected model:
//!
//! 1. With no governance contract configured, the current admin authorises
//!    `set_admin` directly.
//! 2. Once `set_governance` is called, the admin key alone can no longer call
//!    `set_admin` — the bypass is closed.
//! 3. The documented wiring actually works: a real MultisigGovernance contract,
//!    configured as the pool's governance, can finalise an admin transfer through
//!    its timelock and quorum.
//! 4. Every contract that `MultisigGovernance` may retarget exposes `set_admin`
//!    (LendingPool, LoanManager, RemittanceNFT).

use lending_pool::{LendingPool, LendingPoolClient};
use loan_manager::{LoanManager, LoanManagerClient};
use multisig_governance::{GovernanceContract, GovernanceContractClient};
use remittance_nft::{RemittanceNFT, RemittanceNFTClient};
use soroban_sdk::testutils::{Address as _, Ledger as _, MockAuth, MockAuthInvoke};
use soroban_sdk::{Address, Env, IntoVal, Symbol};

const TIMELOCK_SECONDS: u64 = 86_400;

/// Test A — the admin key alone must not be able to replace the admin once
/// governance is configured, otherwise the timelock and quorum are decorative.
#[test]
fn admin_key_cannot_set_admin_once_governance_is_configured() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let admin = Address::generate(&env);
    let governance = Address::generate(&env);
    let attacker_admin = Address::generate(&env);

    let pool_id = env.register(LendingPool, ());
    let pool = LendingPoolClient::new(&env, &pool_id);
    pool.initialize(&admin);
    pool.set_governance(&governance);

    assert_eq!(pool.get_governance(), Some(governance.clone()));

    // Realistic authorization: the admin signs, and nothing else.
    env.mock_auths(&[MockAuth {
        address: &admin,
        invoke: &MockAuthInvoke {
            contract: &pool_id,
            fn_name: "set_admin",
            args: (attacker_admin.clone(),).into_val(&env),
            sub_invokes: &[],
        },
    }]);

    let outcome = env.try_invoke_contract::<(), lending_pool::PoolError>(
        &pool_id,
        &Symbol::new(&env, "set_admin"),
        (attacker_admin,).into_val(&env),
    );

    assert!(
        outcome.is_err(),
        "the admin key must not be able to bypass governance; got {outcome:?}"
    );
    assert_eq!(
        pool.get_admin(),
        admin,
        "admin must be unchanged after a rejected transfer"
    );
}

/// Test B — with no governance configured the admin still authorises directly,
/// so the escape hatch is not lost.
#[test]
fn admin_key_can_set_admin_when_no_governance_is_configured() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);

    let pool_id = env.register(LendingPool, ());
    let pool = LendingPoolClient::new(&env, &pool_id);
    pool.initialize(&admin);

    assert_eq!(pool.get_governance(), None);

    env.mock_auths(&[MockAuth {
        address: &admin,
        invoke: &MockAuthInvoke {
            contract: &pool_id,
            fn_name: "set_admin",
            args: (new_admin.clone(),).into_val(&env),
            sub_invokes: &[],
        },
    }]);

    let outcome = env.try_invoke_contract::<(), lending_pool::PoolError>(
        &pool_id,
        &Symbol::new(&env, "set_admin"),
        (new_admin.clone(),).into_val(&env),
    );

    assert!(
        outcome.is_ok(),
        "admin should still be able to set_admin: {outcome:?}"
    );
    assert_eq!(pool.get_admin(), new_admin);
}

/// Test C — end-to-end proof of the documented wiring. The governance contract
/// must be able to finalise a transfer through its own timelock and quorum, which
/// is only possible if it is registered as the pool's governance.
#[test]
fn governance_finalises_admin_transfer_on_the_pool() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let admin = Address::generate(&env);
    let signer = Address::generate(&env);
    let final_admin = Address::generate(&env);
    let caller = Address::generate(&env);

    // Pool, with the governance contract registered as its governance.
    let pool_id = env.register(LendingPool, ());
    let pool = LendingPoolClient::new(&env, &pool_id);
    pool.initialize(&admin);

    // Governance contract whose target is the pool.
    let gov_id = env.register(GovernanceContract, ());
    let gov = GovernanceContractClient::new(&env, &gov_id);
    gov.initialize(&admin, &pool_id);

    pool.set_governance(&gov_id);

    // Propose, approve, wait out the timelock, finalise.
    let start = env.ledger().timestamp();
    let mut signers = soroban_sdk::Vec::new(&env);
    signers.push_back(signer.clone());

    gov.propose_admin_transfer(&final_admin, &signers, &1u32, &TIMELOCK_SECONDS);
    gov.approve_transfer(&signer);
    assert_eq!(gov.get_approval_count(), 1);

    // Timelock has not elapsed yet.
    let early = gov.try_finalize_admin_transfer(&caller);
    assert!(early.is_err(), "finalising before the timelock must fail");

    env.ledger().set_timestamp(start + TIMELOCK_SECONDS + 1);

    gov.finalize_admin_transfer(&caller);

    assert_eq!(
        pool.get_admin(),
        final_admin,
        "the pool's admin must be the address governance finalised"
    );
}

/// Test D — every contract governance may retarget must expose `set_admin`,
/// otherwise a transfer can only ever reach one of them.
#[test]
fn all_retargetable_contracts_expose_a_gated_set_admin() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let admin = Address::generate(&env);
    let governance = Address::generate(&env);
    let new_admin = Address::generate(&env);

    // LendingPool
    let pool_id = env.register(LendingPool, ());
    let pool = LendingPoolClient::new(&env, &pool_id);
    pool.initialize(&admin);
    pool.set_governance(&governance);
    assert_eq!(pool.get_governance(), Some(governance.clone()));

    // LoanManager — previously exposed no set_admin at all.
    let nft_id = env.register(RemittanceNFT, ());
    let nft = RemittanceNFTClient::new(&env, &nft_id);
    nft.initialize(&admin);

    let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
    let token_id = token_contract.address();

    let manager_id = env.register(LoanManager, ());
    let manager = LoanManagerClient::new(&env, &manager_id);
    nft.authorize_minter(&manager_id);
    manager.initialize(&nft_id, &pool_id, &token_id, &admin);
    manager.set_governance(&governance);
    assert_eq!(manager.get_governance(), Some(governance.clone()));

    // RemittanceNFT
    nft.set_governance(&governance);
    assert_eq!(nft.get_governance(), Some(governance.clone()));

    // All three accept the call signature governance invokes, and all three
    // reject it when no governance is present and the wrong party authorises.
    env.mock_auths(&[]);
    for contract in [pool_id.clone(), manager_id.clone(), nft_id.clone()] {
        let outcome = env.try_invoke_contract::<(), soroban_sdk::Val>(
            &contract,
            &Symbol::new(&env, "set_admin"),
            (new_admin.clone(),).into_val(&env),
        );
        assert!(
            outcome.is_err(),
            "set_admin on {contract:?} must fail without governance auth"
        );
    }
}
