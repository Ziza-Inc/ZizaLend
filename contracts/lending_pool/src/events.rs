use crate::DataKey;
use soroban_sdk::{Address, Env, Symbol};

pub fn deposit(env: &Env, provider: Address, token: Address, amount: i128, shares_minted: i128) {
    let topics = (Symbol::new(env, "Deposit"), provider, token);
    env.events().publish(topics, (amount, shares_minted));
}

pub fn withdraw(env: &Env, provider: Address, token: Address, amount: i128, shares_burned: i128) {
    let topics = (Symbol::new(env, "Withdraw"), provider, token);
    env.events().publish(topics, (amount, shares_burned));
}

#[allow(dead_code)]
pub fn yield_distributed(env: &Env, token: Address, amount: i128) {
    if amount > 0 {
        let total = env
            .storage()
            .instance()
            .get::<_, i128>(&DataKey::TotalYieldDistributed(token.clone()))
            .unwrap_or(0)
            .checked_add(amount)
            .expect("total yield distributed overflow");
        env.storage()
            .instance()
            .set(&DataKey::TotalYieldDistributed(token.clone()), &total);
    }

    let topics = (Symbol::new(env, "YieldDistributed"), token);
    env.events().publish(topics, amount);
}

/// Emitted when the admin registers `token` as a supported market.
pub fn token_allowed(env: &Env, token: Address) {
    let topics = (Symbol::new(env, "TokenAllowed"), token);
    env.events().publish(topics, ());
}

/// Emitted when the admin stops accepting new deposits for `token`. Existing
/// positions are unaffected, so this is not a wind-down of the market.
pub fn token_disallowed(env: &Env, token: Address) {
    let topics = (Symbol::new(env, "TokenDisallowed"), token);
    env.events().publish(topics, ());
}

pub fn deposit_cap_updated(env: &Env, token: Address, old_cap: i128, new_cap: i128) {
    let topics = (Symbol::new(env, "DepositCapUpdated"), token);
    env.events().publish(topics, (old_cap, new_cap));
}

/// Emitted when a deposit is rejected because it would exceed the pool's
/// configured max size cap. Allows off-chain monitors to detect when the
/// pool is at capacity.
pub fn deposit_cap_reached(env: &Env, provider: Address, token: Address, amount: i128, cap: i128) {
    let topics = (Symbol::new(env, "DepositCapReached"), provider, token);
    env.events().publish(topics, (amount, cap));
}

pub fn pool_paused(env: &Env) {
    let topics = (Symbol::new(env, "PoolPaused"),);
    env.events().publish(topics, ());
}

pub fn pool_unpaused(env: &Env) {
    let topics = (Symbol::new(env, "PoolUnpaused"),);
    env.events().publish(topics, ());
}

pub fn withdrawal_cooldown_updated(env: &Env, old_cooldown: u32, new_cooldown: u32) {
    let topics = (Symbol::new(env, "WithdrawalCooldownUpdated"),);
    env.events().publish(topics, (old_cooldown, new_cooldown));
}

pub fn admin_proposed(env: &Env, current_admin: Address, proposed_admin: Address) {
    let topics = (Symbol::new(env, "AdminProposed"), current_admin);
    env.events().publish(topics, proposed_admin);
}

pub fn admin_transferred(env: &Env, previous_admin: Address, new_admin: Address, via: Symbol) {
    let topics = (Symbol::new(env, "AdminTransferred"), via);
    env.events().publish(topics, (previous_admin, new_admin));
}

/// Emitted when the pool disburses principal to a borrower at the
/// LoanManager's request. This is the only path by which principal leaves the
/// pool, so off-chain indexers should treat it as the canonical "loan funded"
/// signal alongside the LoanManager's `LoanApproved`.
pub fn disbursed(env: &Env, token: Address, to: Address, amount: i128) {
    let topics = (Symbol::new(env, "Disbursed"), to, token);
    env.events().publish(topics, amount);
}

/// Emitted when the pool's outstanding balance is reduced, on principal
/// repayment, refinance-down, or default write-off.
pub fn outstanding_settled(env: &Env, token: Address, amount: i128) {
    let topics = (Symbol::new(env, "OutstandingSettled"), token);
    env.events().publish(topics, amount);
}

/// Emitted when the admin re-points the pool at a different LoanManager.
/// High-signal for monitoring: this role can move every token in the pool.
pub fn loan_manager_updated(env: &Env, loan_manager: Address) {
    let topics = (Symbol::new(env, "LoanManagerSet"),);
    env.events().publish(topics, loan_manager);
}

/// Emitted when the admin configures (or re-points) the governance contract.
/// From this point `set_admin` requires the governance contract's authorisation.
pub fn governance_updated(env: &Env, governance: Address) {
    let topics = (Symbol::new(env, "GovernanceSet"),);
    env.events().publish(topics, governance);
}
