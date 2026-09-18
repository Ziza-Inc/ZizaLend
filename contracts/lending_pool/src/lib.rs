#![no_std]
//! # ZizaLend Lending Pool Contract
//!
//! A share-based (LP token) liquidity pool that serves multiple token markets
//! from a single contract instance. Lenders deposit tokens and receive LP
//! shares whose value grows as loans are repaid with interest.
//!
//! ## Architecture
//!
//! - **Share-based accounting**: Every deposit mints LP shares at the current
//!   exchange rate. Yield is implicit in the share price — no separate `claim`
//!   step required.
//! - **Multi-token support**: One contract instance manages independent pools
//!   for different token addresses.
//! - **Withdrawal cooldown**: Configurable per-token delay between deposit and
//!   withdrawal to prevent rapid deposit/withdraw cycles (flash-loan-like
//!   behavior on Soroban).
//! - **Emergency pause**: Admin can pause deposits and withdrawals; a separate
//!   `emergency_withdraw` bypasses both pause and cooldown for user safety.
//! - **Admin governance**: Two-step admin transfer (`propose` + `accept`), plus a
//!   `set_admin` entry point for a configured governance contract. Once
//!   `set_governance` is called, `set_admin` accepts only the governance
//!   contract's authorisation, so a single admin key cannot bypass the timelock
//!   and signer quorum that governance exists to enforce.
//! - **Upgradeable**: WASM-hash replacement with version tracking.
//!
//! ## Key Invariants
//!
//! 1. `total_pool_assets = idle_balance + total_outstanding`
//! 2. `shares * (total_assets + 1) / (total_shares + 1)` always equals the
//!    depositor's proportional claim (including accrued yield). The virtual
//!    offset is what makes the claim resistant to donation-based price
//!    manipulation; see [`VIRTUAL_SHARES`](LendingPool::VIRTUAL_SHARES).
//! 3. First depositor always receives a 1:1 share-to-asset allocation.
//! 4. Subsequent depositors cannot dilute existing holders, and a donation made
//!    directly to the pool cannot be redeemed back by its sender.
//! 5. The share price is monotonic non-decreasing (yield can only increase it).
//! 6. `TotalDeposits` can never exceed `MaxPoolSize` when the cap is set.
//!    `TotalDeposits` is a principal *cost basis*, not an asset value: it excludes
//!    accrued yield, and a redemption reduces it by the pro-rata principal of the
//!    burned shares rather than by the assets paid out.
//! 7. Withdrawals can only reduce the idle balance — total_outstanding is
//!    only modified by `adjust_outstanding` (called by LoanManager).
use soroban_sdk::token::Client as TokenClient;
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, Address, BytesN, Env, Symbol,
};

mod events;
use events::*;

/// Errors returned by the LendingPool contract.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum PoolError {
    /// Contract has already been initialized
    AlreadyInitialized = 1,
    /// Contract has not been initialized
    NotInitialized = 2,
    /// The contract (or token-specific pool) is paused
    ContractPaused = 3,
    /// Amount or share value is zero or negative
    InvalidAmount = 4,
    /// Deposit would exceed the configured max pool size
    PoolSizeExceeded = 5,
    /// Provider does not hold enough shares to withdraw
    InsufficientBalance = 6,
    /// Pool lacks sufficient idle liquidity to fulfill the withdrawal
    InsufficientLiquidity = 7,
    /// Max pool size value is negative
    InvalidMaxPoolSize = 9,
    /// No pending admin proposal to accept
    NoProposedAdmin = 10,
    /// Withdrawal cooldown exceeds maximum allowed ledgers
    CooldownTooLong = 11,
    /// Minimum share hold time (flash loan protection) not yet elapsed
    MinimumHoldTimeNotMet = 12,
    /// Deposit amount is below the configured minimum
    AmountBelowMinimum = 13,
    /// No LoanManager has been configured for this pool
    LoanManagerNotSet = 14,
    /// Caller is not the configured LoanManager
    UnauthorizedLoanManager = 15,
}

/// Storage keys for the LendingPool contract.
///
/// Per-token keys carry the token address so one contract instance can
/// serve multiple independent liquidity pools. Persistent keys use
/// `(provider, token)` tuples for per-user data.
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Paused,
    WithdrawalCooldown,
    /// token → max pool size cap (0 = unlimited)
    MaxPoolSize(Address),
    /// token → total LP shares outstanding across all providers
    TotalShares(Address),
    /// (provider, token) → LP shares held
    Shares(Address, Address),
    /// (provider, token) → ledger sequence of the most recent deposit
    DepositTimestamp(Address, Address),
    /// token → total principal deposited (net of withdrawals); used for
    /// utilisation stats and the MaxPoolSize cap
    TotalDeposits(Address),
    /// token → total principal currently deployed in approved loans
    TotalOutstanding(Address),
    /// token → number of active depositors
    DepositorCount(Address),
    /// token → cumulative yield explicitly distributed to the pool
    TotalYieldDistributed(Address),
    ProposedAdmin,
    Version,
    /// Address of the LoanManager contract permitted to disburse principal and
    /// settle outstanding balances. Set by the admin at deploy time.
    LoanManager,
    /// Optional governance contract permitted to replace the admin once set.
    Governance,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct PoolStats {
    /// Principal contributed by lenders, net of principal withdrawn. This is a
    /// cost basis rather than an asset value: it excludes accrued yield, and a
    /// redemption reduces it by the pro-rata principal of the burned shares.
    pub total_deposits: i128,
    pub total_shares: i128,
    pub pool_token_balance: i128,
    pub depositor_count: u32,
    pub total_yield_distributed: i128,
    /// Fraction of total pool assets (`idle + outstanding`) currently out on loan,
    /// in basis points. Zero whenever nothing is deployed, regardless of how much
    /// yield has accumulated in the pool.
    pub utilization_bps: u32,
}

#[contract]
pub struct LendingPool;

#[contractimpl]
impl LendingPool {
    const INSTANCE_TTL_THRESHOLD: u32 = 17280;
    const INSTANCE_TTL_BUMP: u32 = 518400;
    const PERSISTENT_TTL_THRESHOLD: u32 = 17280;
    const PERSISTENT_TTL_BUMP: u32 = 518400;
    const CURRENT_VERSION: u32 = 3;
    const DEFAULT_WITHDRAWAL_COOLDOWN: u32 = 1_440;
    const SHARE_PRICE_SCALE: i128 = 1_000_000;
    const MAX_WITHDRAWAL_COOLDOWN_LEDGERS: u32 = 17_280 * 30;
    const MIN_DEPOSIT_AMOUNT: i128 = 100;

    // ── TTL helpers ───────────────────────────────────────────────────────

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

    // ── Storage accessors ─────────────────────────────────────────────────

    fn admin(env: &Env) -> Address {
        Self::bump_instance_ttl(env);
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized")
    }

    fn read_pool_balance(env: &Env, token: &Address) -> i128 {
        TokenClient::new(env, token).balance(&env.current_contract_address())
    }

    fn read_total_outstanding(env: &Env, token: &Address) -> i128 {
        Self::bump_instance_ttl(env);
        env.storage()
            .instance()
            .get(&DataKey::TotalOutstanding(token.clone()))
            .unwrap_or(0)
    }

    fn total_pool_assets(env: &Env, token: &Address) -> i128 {
        let idle_balance = Self::read_pool_balance(env, token);
        let outstanding = Self::read_total_outstanding(env, token);
        idle_balance
            .checked_add(outstanding)
            .expect("total assets overflow")
    }

    fn total_deposits(env: &Env, token: &Address) -> i128 {
        Self::bump_instance_ttl(env);
        env.storage()
            .instance()
            .get(&DataKey::TotalDeposits(token.clone()))
            .unwrap_or(0)
    }

    fn total_shares(env: &Env, token: &Address) -> i128 {
        Self::bump_instance_ttl(env);
        env.storage()
            .instance()
            .get(&DataKey::TotalShares(token.clone()))
            .unwrap_or(0)
    }

    fn read_shares(env: &Env, provider: &Address, token: &Address) -> i128 {
        let key = DataKey::Shares(provider.clone(), token.clone());
        let shares: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        if shares > 0 {
            Self::bump_persistent_ttl(env, &key);
        }
        shares
    }

    fn read_deposit_timestamp(env: &Env, provider: &Address, token: &Address) -> Option<u32> {
        let key = DataKey::DepositTimestamp(provider.clone(), token.clone());
        let deposit_ledger: Option<u32> = env.storage().persistent().get(&key);
        if deposit_ledger.is_some() {
            Self::bump_persistent_ttl(env, &key);
        }
        deposit_ledger
    }

    fn read_depositor_count(env: &Env, token: &Address) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::DepositorCount(token.clone()))
            .unwrap_or(0)
    }

    fn total_yield_distributed(env: &Env, token: &Address) -> i128 {
        Self::bump_instance_ttl(env);
        env.storage()
            .instance()
            .get(&DataKey::TotalYieldDistributed(token.clone()))
            .unwrap_or(0)
    }

    fn withdrawal_cooldown(env: &Env) -> u32 {
        Self::bump_instance_ttl(env);
        env.storage()
            .instance()
            .get(&DataKey::WithdrawalCooldown)
            .unwrap_or(Self::DEFAULT_WITHDRAWAL_COOLDOWN)
    }

    fn assert_not_paused(env: &Env) -> Result<(), PoolError> {
        Self::bump_instance_ttl(env);
        let paused: bool = env
            .storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false);
        if paused {
            return Err(PoolError::ContractPaused);
        }
        Ok(())
    }

    // ── Share / asset math ────────────────────────────────────────────────

    /// Virtual share and asset quantities credited to every LP share-pricing
    /// computation.
    ///
    /// LP shares are priced from the pool's token balance, and anyone can send
    /// tokens straight to the pool address. Without an offset that is the standard
    /// first-depositor inflation attack: the attacker takes the smallest allowed
    /// position, then donates tokens directly, which raises `total_assets` without
    /// minting shares. A subsequent depositor's `floor(amount * shares / assets)`
    /// then rounds down -- to zero, which reverts their deposit, or to a fraction of
    /// what they paid, with the attacker redeeming at the inflated price and
    /// collecting the difference.
    ///
    /// Crediting a virtual position to both sides of every conversion makes a
    /// donation *shared* with that position instead of captured by the donor, so an
    /// attacker can never redeem back the full amount they put in and the attack
    /// costs more than it yields. This is the mitigation the ERC-4626 specification
    /// recommends, with an offset of zero: one virtual share and one virtual asset.
    ///
    /// Two consequences are accepted deliberately. First, up to one share's worth of
    /// value becomes permanently unattributable, since the virtual position can never
    /// be redeemed; it stays in the pool and improves solvency rather than enriching
    /// anyone, and for a healthy pool it is a single unit of the asset. Second, a
    /// depositor into a pool whose price an attacker has inflated still loses
    /// granularity to share indivisibility -- but no longer in a way that an attacker
    /// can profit from, which removes the incentive entirely.
    const VIRTUAL_SHARES: i128 = 1;
    const VIRTUAL_ASSETS: i128 = 1;

    /// LP shares to mint for `amount` of deposited assets.
    ///
    /// The first depositor always receives a 1-for-1 allocation, since a fresh pool
    /// converts `amount * (0 + 1) / (0 + 1)`. Subsequent depositors receive
    /// `amount * (total_shares + 1) / (total_assets_before + 1)` so that the exchange
    /// rate is preserved, existing holders are not diluted, and a donated balance
    /// cannot be captured by whoever donated it. Total assets includes both idle
    /// balance and outstanding loans.
    fn calc_shares_to_mint(
        amount: i128,
        total_assets_before: i128,
        cur_total_shares: i128,
    ) -> i128 {
        // A pool with no shares has no holder to dilute, so the first depositor takes a
        // 1:1 position regardless of any balance already sitting in the pool. That
        // balance belongs to nobody -- it was donated, or pre-funded at deployment --
        // and pricing against it would let whoever sent it round the first real
        // deposit's share count down to zero, which is the griefing half of the
        // donation attack. Invariant 3 relies on this branch.
        if cur_total_shares == 0 {
            return amount;
        }

        // A pool that still has shares but holds no assets is insolvent and has no
        // meaningful share price. Pricing against a zero denominator would mint
        // `amount * (shares + 1)` shares and dilute existing holders to nothing.
        if total_assets_before == 0 {
            return amount;
        }

        let virtual_total_shares = cur_total_shares
            .checked_add(Self::VIRTUAL_SHARES)
            .expect("virtual shares overflow");
        let virtual_total_assets = total_assets_before
            .checked_add(Self::VIRTUAL_ASSETS)
            .expect("virtual assets overflow");

        amount
            .checked_mul(virtual_total_shares)
            .and_then(|v| v.checked_div(virtual_total_assets))
            .expect("share mint overflow")
    }

    /// Underlying assets redeemable for `shares` given current pool state.
    ///
    /// Returns `shares * (total_assets + 1) / (total_shares + 1)`, which automatically
    /// includes any yield that has accumulated since the shares were minted and is
    /// computed against the same virtual offset deposits use, so the two conversions
    /// are exact inverses. Total assets includes both idle balance and outstanding
    /// loans.
    fn calc_assets_to_redeem(shares: i128, total_assets: i128, cur_total_shares: i128) -> i128 {
        let virtual_total_assets = total_assets
            .checked_add(Self::VIRTUAL_ASSETS)
            .expect("virtual assets overflow");
        let virtual_total_shares = cur_total_shares
            .checked_add(Self::VIRTUAL_SHARES)
            .expect("virtual shares overflow");

        shares
            .checked_mul(virtual_total_assets)
            .and_then(|v| v.checked_div(virtual_total_shares))
            .expect("share redeem overflow")
    }

    /// Minimum number of ledgers a depositor must hold LP shares before
    /// withdrawing. Prevents flash-loan-style deposit/withdraw cycles that
    /// could extract value from the pool's yield in a single transaction.
    ///
    /// Set to 1 ledger minimum — in Soroban, cross-contract calls within a
    /// single transaction all execute at the same ledger sequence, so a 1
    /// ledger hold effectively prevents flash-loan attacks while allowing
    /// same-ledger withdrawals when the cooldown is configured to 0.
    const MINIMUM_HOLD_LEDGERS: u32 = 1;

    /// Assert that the minimum share hold time has elapsed since the provider's
    /// most recent deposit. This prevents flash-loan-style manipulation where
    /// funds are deposited and withdrawn in the same ledger.
    ///
    /// # Panics
    ///
    /// Panics with `"minimum_hold_time_not_met"` if the current ledger is less
    /// than the deposit ledger plus `MINIMUM_HOLD_LEDGERS` **and** the
    /// withdrawal cooldown is set to 0 (since the cooldown already covers
    /// longer holds when configured).
    fn assert_minimum_hold_elapsed(env: &Env, provider: &Address, token: &Address) {
        let cooldown = Self::withdrawal_cooldown(env);
        // When a longer cooldown is configured, it already prevents
        // flash-loan behavior — skip the minimum hold check.
        if cooldown >= Self::MINIMUM_HOLD_LEDGERS {
            return;
        }

        let Some(deposit_ledger) = Self::read_deposit_timestamp(env, provider, token) else {
            return;
        };

        let current_ledger = env.ledger().sequence();
        if current_ledger < deposit_ledger.saturating_add(Self::MINIMUM_HOLD_LEDGERS) {
            panic!("minimum_hold_time_not_met");
        }
    }

    /// Principal attributable to `shares` out of `total_shares`.
    ///
    /// Used to reduce the tracked principal basis when shares are burned.
    /// `TotalDeposits` is a cost basis, so it must fall by the principal the burned
    /// shares represent — not by the assets they redeem for. Subtracting the asset
    /// value would also subtract accrued yield, so every yield distribution would
    /// silently shrink tracked principal, and with it the `MaxPoolSize` ceiling and
    /// the utilisation denominator.
    fn principal_share(total_deposits: i128, shares: i128, total_shares: i128) -> i128 {
        if total_shares <= 0 || total_deposits <= 0 {
            return 0;
        }
        shares
            .checked_mul(total_deposits)
            .and_then(|v| v.checked_div(total_shares))
            .expect("principal share overflow")
            .min(total_deposits)
    }

    fn assert_withdrawal_cooldown_elapsed(env: &Env, provider: &Address, token: &Address) {
        let cooldown = Self::withdrawal_cooldown(env);
        if cooldown == 0 {
            return;
        }

        let Some(deposit_ledger) = Self::read_deposit_timestamp(env, provider, token) else {
            return;
        };

        let current_ledger = env.ledger().sequence();
        if current_ledger < deposit_ledger.saturating_add(cooldown) {
            panic!("withdrawal_cooldown_active");
        }
    }

    fn redeem_shares(
        env: &Env,
        provider: &Address,
        token: &Address,
        shares: i128,
    ) -> Result<(), PoolError> {
        if shares <= 0 {
            return Err(PoolError::InvalidAmount);
        }

        let cur_shares = Self::read_shares(env, provider, token);
        if cur_shares < shares {
            return Err(PoolError::InsufficientBalance);
        }

        let cur_total_shares = Self::total_shares(env, token);
        let total_assets = Self::total_pool_assets(env, token);
        let assets_to_return = Self::calc_assets_to_redeem(shares, total_assets, cur_total_shares);

        if assets_to_return <= 0 {
            return Err(PoolError::InvalidAmount);
        }

        // `calc_assets_to_redeem` floors, so the redeemer receives at most their
        // proportional claim and any truncated remainder stays in the pool. That
        // is not lost value and must not be paid out: it raises the value of every
        // remaining share, making the share price non-decreasing across
        // redemptions. Paying it to the admin would extract value from holders and
        // would break `total_pool_assets = idle + outstanding`, because assets
        // would leave without any shares being burned.
        let idle_balance = Self::read_pool_balance(env, token);
        if assets_to_return > idle_balance {
            return Err(PoolError::InsufficientLiquidity);
        }

        TokenClient::new(env, token).transfer(
            &env.current_contract_address(),
            provider,
            &assets_to_return,
        );

        let share_key = DataKey::Shares(provider.clone(), token.clone());
        let deposit_key = DataKey::DepositTimestamp(provider.clone(), token.clone());
        let remaining = cur_shares.checked_sub(shares).expect("share underflow");
        if remaining == 0 {
            env.storage().persistent().remove(&share_key);
            env.storage().persistent().remove(&deposit_key);
            let count = Self::read_depositor_count(env, token);
            env.storage().instance().set(
                &DataKey::DepositorCount(token.clone()),
                &count.saturating_sub(1),
            );
        } else {
            env.storage().persistent().set(&share_key, &remaining);
            Self::bump_persistent_ttl(env, &share_key);
            Self::bump_persistent_ttl(env, &deposit_key);
        }

        let new_total_shares = cur_total_shares
            .checked_sub(shares)
            .expect("total shares underflow");
        env.storage()
            .instance()
            .set(&DataKey::TotalShares(token.clone()), &new_total_shares);

        // Reduce the principal basis by the pro-rata principal of the burned
        // shares. This previously subtracted `assets_to_return`, which includes
        // accrued yield, so each redemption also wrote off yield from the tracked
        // principal and steadily understated the pool's cost basis.
        let cur_total_deposits = Self::total_deposits(env, token);
        let principal_redeemed =
            Self::principal_share(cur_total_deposits, shares, cur_total_shares);
        let new_total_deposits = cur_total_deposits.saturating_sub(principal_redeemed);
        env.storage()
            .instance()
            .set(&DataKey::TotalDeposits(token.clone()), &new_total_deposits);

        Self::bump_instance_ttl(env);
        withdraw(
            env,
            provider.clone(),
            token.clone(),
            assets_to_return,
            shares,
        );
        Ok(())
    }

    // ── Admin / lifecycle ─────────────────────────────────────────────────

    /// Initialize the LendingPool contract with an admin address.
    ///
    /// Called once at deployment. Sets the initial admin, unpaused state,
    /// default withdrawal cooldown, and version. Reverts with
    /// [`PoolError::AlreadyInitialized`] if called a second time.
    pub fn initialize(env: Env, admin: Address) -> Result<(), PoolError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(PoolError::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Paused, &false);
        env.storage().instance().set(
            &DataKey::WithdrawalCooldown,
            &Self::DEFAULT_WITHDRAWAL_COOLDOWN,
        );
        env.storage()
            .instance()
            .set(&DataKey::Version, &Self::CURRENT_VERSION);
        Self::bump_instance_ttl(&env);
        Ok(())
    }

    /// Return the current contract version.
    pub fn version(env: Env) -> u32 {
        Self::bump_instance_ttl(&env);
        env.storage().instance().get(&DataKey::Version).unwrap_or(0)
    }

    /// Return the current admin address.
    pub fn get_admin(env: Env) -> Address {
        Self::admin(&env)
    }

    /// Return the proposed admin address if a two-step transfer is pending.
    pub fn get_proposed_admin(env: Env) -> Option<Address> {
        Self::bump_instance_ttl(&env);
        env.storage().instance().get(&DataKey::ProposedAdmin)
    }

    /// Upgrade the contract WASM code.
    ///
    /// Requires admin authorization. Increments the version counter and
    /// publishes a `ContractUpgraded` event before replacing the bytecode.
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

    /// Set the maximum pool size cap for a given token.
    ///
    /// When `max > 0`, deposits that would push `TotalDeposits` above this
    /// cap are rejected with [`PoolError::PoolSizeExceeded`]. Set to `0` for
    /// unlimited deposits.
    ///
    /// Requires admin authorization.
    pub fn set_max_pool_size(env: Env, token: Address, max: i128) -> Result<(), PoolError> {
        Self::admin(&env).require_auth();
        if max < 0 {
            return Err(PoolError::InvalidMaxPoolSize);
        }

        let old_max = Self::get_max_pool_size(env.clone(), token.clone());

        env.storage()
            .instance()
            .set(&DataKey::MaxPoolSize(token.clone()), &max);
        Self::bump_instance_ttl(&env);

        deposit_cap_updated(&env, token, old_max, max);
        Ok(())
    }

    /// Set the withdrawal cooldown period in ledgers.
    ///
    /// After a deposit, the provider must wait this many ledgers before
    /// withdrawing. Set to `0` to disable (though the 1-ledger minimum
    /// hold time for flash loan protection still applies).
    ///
    /// Rejects values above `MAX_WITHDRAWAL_COOLDOWN_LEDGERS` (30 days).
    /// Requires admin authorization.
    pub fn set_withdrawal_cooldown(env: Env, ledgers: u32) -> Result<(), PoolError> {
        Self::admin(&env).require_auth();
        if ledgers > Self::MAX_WITHDRAWAL_COOLDOWN_LEDGERS {
            return Err(PoolError::CooldownTooLong);
        }

        let old_cooldown = Self::get_withdrawal_cooldown(env.clone());

        env.storage()
            .instance()
            .set(&DataKey::WithdrawalCooldown, &ledgers);
        Self::bump_instance_ttl(&env);

        withdrawal_cooldown_updated(&env, old_cooldown, ledgers);
        Ok(())
    }

    /// Return the max pool size cap for `token`. Returns `0` when unlimited.
    pub fn get_max_pool_size(env: Env, token: Address) -> i128 {
        Self::bump_instance_ttl(&env);
        env.storage()
            .instance()
            .get(&DataKey::MaxPoolSize(token))
            .unwrap_or(0)
    }

    /// Return the total tracked deposits for `token`.
    pub fn get_total_deposits(env: Env, token: Address) -> i128 {
        Self::total_deposits(&env, &token)
    }

    /// Return the total outstanding LP shares for `token`.
    pub fn get_total_shares(env: Env, token: Address) -> i128 {
        Self::total_shares(&env, &token)
    }

    /// Return the number of unique depositors for `token`.
    pub fn get_depositor_count(env: Env, token: Address) -> u32 {
        Self::read_depositor_count(&env, &token)
    }

    /// Return the cumulative yield distributed to `token` pool.
    pub fn get_total_yield_distributed(env: Env, token: Address) -> i128 {
        Self::total_yield_distributed(&env, &token)
    }

    /// Return the withdrawal cooldown period in ledgers.
    pub fn get_withdrawal_cooldown(env: Env) -> u32 {
        Self::withdrawal_cooldown(&env)
    }

    // ── Core pool operations ──────────────────────────────────────────────

    /// Deposit `amount` of `token` and receive LP shares in return.
    ///
    /// Shares are minted proportional to the current exchange rate so that
    /// existing depositors are not diluted.  Any yield already present in the
    /// pool is captured in the share price at the point of deposit, not
    /// credited to the new depositor.
    pub fn deposit(
        env: Env,
        provider: Address,
        token: Address,
        amount: i128,
    ) -> Result<(), PoolError> {
        provider.require_auth();
        Self::assert_not_paused(&env)?;

        if amount <= 0 {
            return Err(PoolError::InvalidAmount);
        }

        // Minimum deposit guard: prevents storage-DoS via tiny deposits.
        if amount < Self::MIN_DEPOSIT_AMOUNT {
            return Err(PoolError::AmountBelowMinimum);
        }

        // MaxPoolSize cap uses tracked principal, not pool balance.
        let max: i128 = env
            .storage()
            .instance()
            .get(&DataKey::MaxPoolSize(token.clone()))
            .unwrap_or(0);
        if max > 0 {
            let total = Self::total_deposits(&env, &token);
            if total.checked_add(amount).expect("overflow") > max {
                deposit_cap_reached(&env, provider.clone(), token.clone(), amount, max);
                return Err(PoolError::PoolSizeExceeded);
            }
        }

        // Snapshot pool state *before* the transfer so the share price
        // reflects the pre-deposit pool composition.
        let total_assets_before = Self::total_pool_assets(&env, &token);
        let cur_total_shares = Self::total_shares(&env, &token);

        let shares_to_mint =
            Self::calc_shares_to_mint(amount, total_assets_before, cur_total_shares);
        if shares_to_mint <= 0 {
            return Err(PoolError::InvalidAmount);
        }

        TokenClient::new(&env, &token).transfer(
            &provider,
            &env.current_contract_address(),
            &amount,
        );

        // Track new depositors.
        let existing_shares = Self::read_shares(&env, &provider, &token);
        if existing_shares == 0 {
            let count = Self::read_depositor_count(&env, &token);
            env.storage()
                .instance()
                .set(&DataKey::DepositorCount(token.clone()), &(count + 1));
        }

        let new_shares = existing_shares
            .checked_add(shares_to_mint)
            .expect("shares overflow");
        let share_key = DataKey::Shares(provider.clone(), token.clone());
        env.storage().persistent().set(&share_key, &new_shares);
        Self::bump_persistent_ttl(&env, &share_key);
        let deposit_key = DataKey::DepositTimestamp(provider.clone(), token.clone());
        let current_ledger = env.ledger().sequence();
        env.storage()
            .persistent()
            .set(&deposit_key, &current_ledger);
        Self::bump_persistent_ttl(&env, &deposit_key);

        let new_total_shares = cur_total_shares
            .checked_add(shares_to_mint)
            .expect("total shares overflow");
        env.storage()
            .instance()
            .set(&DataKey::TotalShares(token.clone()), &new_total_shares);

        let new_total_deposits = Self::total_deposits(&env, &token)
            .checked_add(amount)
            .expect("total deposits overflow");
        env.storage()
            .instance()
            .set(&DataKey::TotalDeposits(token.clone()), &new_total_deposits);

        Self::bump_instance_ttl(&env);
        deposit(
            &env,
            provider.clone(),
            token.clone(),
            amount,
            shares_to_mint,
        );
        Ok(())
    }

    /// Returns `(shares, current_asset_value)` for `provider` in the `token` pool.
    ///
    /// Net yield = `current_asset_value - original_deposit`.  Since original
    /// deposit amounts are not stored per-depositor, callers derive yield by
    /// comparing `current_asset_value` against their own recorded cost basis.
    /// Current asset value includes proportional share of outstanding loans.
    pub fn get_depositor_yield(env: Env, provider: Address, token: Address) -> (i128, i128) {
        let shares = Self::read_shares(&env, &provider, &token);
        if shares == 0 {
            return (0, 0);
        }
        let cur_total_shares = Self::total_shares(&env, &token);
        if cur_total_shares == 0 {
            return (shares, 0);
        }
        let asset_value = Self::calc_assets_to_redeem(
            shares,
            Self::total_pool_assets(&env, &token),
            cur_total_shares,
        );
        (shares, asset_value)
    }

    /// Underlying asset value of `provider`'s LP shares (principal + yield).
    /// Includes proportional share of outstanding loans.
    pub fn get_deposit(env: Env, provider: Address, token: Address) -> i128 {
        let shares = Self::read_shares(&env, &provider, &token);
        if shares == 0 {
            return 0;
        }
        let cur_total_shares = Self::total_shares(&env, &token);
        if cur_total_shares == 0 {
            return 0;
        }
        Self::calc_assets_to_redeem(
            shares,
            Self::total_pool_assets(&env, &token),
            cur_total_shares,
        )
    }

    /// Raw LP share balance for `provider` in the `token` pool.
    pub fn get_shares(env: Env, provider: Address, token: Address) -> i128 {
        Self::read_shares(&env, &provider, &token)
    }

    /// Current LP share price scaled by `SHARE_PRICE_SCALE`.
    /// `1_000_000` means 1.0 underlying asset per share.
    /// Price includes proportional value of outstanding loans.
    ///
    /// Measured on the same virtual offset the deposit and redemption conversions
    /// use, so the reported price is exactly the rate a depositor would transact at.
    pub fn get_share_price(env: Env, token: Address) -> i128 {
        // A pool with no shares reports parity, because that is the rate the next
        // deposit actually transacts at: `calc_shares_to_mint` mints 1:1 until shares
        // exist, so a pre-funded or donated balance is not priced in.
        if Self::total_shares(&env, &token) == 0 {
            return Self::SHARE_PRICE_SCALE;
        }

        let virtual_assets = Self::total_pool_assets(&env, &token)
            .checked_add(Self::VIRTUAL_ASSETS)
            .expect("virtual assets overflow");
        let virtual_shares = Self::total_shares(&env, &token)
            .checked_add(Self::VIRTUAL_SHARES)
            .expect("virtual shares overflow");

        virtual_assets
            .checked_mul(Self::SHARE_PRICE_SCALE)
            .and_then(|v| v.checked_div(virtual_shares))
            .expect("share price overflow")
    }

    /// Burn `shares` LP tokens and receive the proportional underlying assets.
    ///
    /// The redemption value is `shares * pool_balance / total_shares`, which
    /// automatically includes any interest that has been repaid to the pool
    /// since the shares were minted — no separate claim step is required.
    /// Burn `shares` LP tokens and receive the proportional underlying assets.
    ///
    /// The redemption value is `shares * pool_balance / total_shares`, which
    /// automatically includes any interest that has been repaid to the pool
    /// since the shares were minted — no separate claim step is required.
    ///
    /// Enforces both the withdrawal cooldown and the minimum share hold time
    /// (flash loan protection). Use [`emergency_withdraw`] to bypass these
    /// guards during a contract pause.
    ///
    /// # Errors
    ///
    /// Returns [`PoolError::ContractPaused`] if the pool is paused.
    /// Returns [`PoolError::InvalidAmount`] for non-positive share amounts.
    /// Returns [`PoolError::InsufficientBalance`] if the provider holds fewer
    /// shares than requested.
    pub fn withdraw(
        env: Env,
        provider: Address,
        token: Address,
        shares: i128,
    ) -> Result<(), PoolError> {
        provider.require_auth();
        Self::assert_not_paused(&env)?;
        Self::assert_minimum_hold_elapsed(&env, &provider, &token);
        Self::assert_withdrawal_cooldown_elapsed(&env, &provider, &token);
        Self::redeem_shares(&env, &provider, &token, shares)
    }

    /// Emergency withdrawal that bypasses pause and cooldown checks.
    ///
    /// This is a safety hatch for depositors when the pool is paused. It still
    /// validates share balance and liquidity, but skips `assert_not_paused` and
    /// `assert_withdrawal_cooldown_elapsed`.
    ///
    /// Note: `emergency_withdraw` still enforces the minimum hold time to
    /// prevent flash-loan extraction during an emergency.
    pub fn emergency_withdraw(
        env: Env,
        provider: Address,
        token: Address,
        shares: i128,
    ) -> Result<(), PoolError> {
        provider.require_auth();
        Self::redeem_shares(&env, &provider, &token, shares)
    }

    // ── Cooldown views ────────────────────────────────────────────────────

    /// Ledger sequence at which the provider may withdraw from `token`.
    ///
    /// Returns 0 when the cooldown is disabled, the provider has no deposit
    /// timestamp, or the cooldown has already elapsed.
    pub fn get_withdrawal_available_at(env: Env, provider: Address, token: Address) -> u32 {
        let cooldown = Self::withdrawal_cooldown(&env);
        if cooldown == 0 {
            return 0;
        }

        let Some(deposit_ledger) = Self::read_deposit_timestamp(&env, &provider, &token) else {
            return 0;
        };

        deposit_ledger.saturating_add(cooldown)
    }
    /// Number of ledgers remaining before the provider may withdraw from `token`.
    ///
    /// Returns 0 when no cooldown is active, the cooldown has already expired,
    /// or the provider has no deposit timestamp.
    pub fn get_withdraw_cooldown_left(env: Env, provider: Address, token: Address) -> u32 {
        let available_at =
            Self::get_withdrawal_available_at(env.clone(), provider.clone(), token.clone());
        if available_at == 0 {
            return 0;
        }

        let current = env.ledger().sequence();
        if current >= available_at {
            return 0;
        }
        available_at - current
    }

    // ── Queries ───────────────────────────────────────────────────────────

    pub fn get_pool_stats(env: Env, token: Address) -> PoolStats {
        let total_deposits = Self::total_deposits(&env, &token);
        let total_shares = Self::total_shares(&env, &token);
        let pool_token_balance = Self::read_pool_balance(&env, &token);

        // Utilisation: fraction of total pool assets currently out on loan.
        //
        // Derived from the authoritative outstanding counter rather than from
        // `total_deposits - pool_token_balance`. That older form treated every
        // token held above the principal basis as borrowed, so a repayment of
        // interest made an entirely idle pool report a non-zero utilisation.
        let outstanding = Self::read_total_outstanding(&env, &token);
        let total_assets = pool_token_balance.saturating_add(outstanding);
        let utilization_bps = if total_assets > 0 {
            (outstanding.saturating_mul(10_000) / total_assets) as u32
        } else {
            0
        };

        PoolStats {
            total_deposits,
            total_shares,
            pool_token_balance,
            depositor_count: Self::read_depositor_count(&env, &token),
            total_yield_distributed: Self::total_yield_distributed(&env, &token),
            utilization_bps,
        }
    }

    // ── Admin governance ──────────────────────────────────────────────────

    pub fn propose_admin(env: Env, new_admin: Address) {
        let current_admin = Self::admin(&env);
        current_admin.require_auth();

        env.storage()
            .instance()
            .set(&DataKey::ProposedAdmin, &new_admin);
        Self::bump_instance_ttl(&env);

        admin_proposed(&env, current_admin.clone(), new_admin.clone());
    }

    pub fn accept_admin(env: Env) -> Result<(), PoolError> {
        let previous_admin = Self::admin(&env);
        let proposed_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::ProposedAdmin)
            .ok_or(PoolError::NoProposedAdmin)?;
        proposed_admin.require_auth();

        env.storage()
            .instance()
            .set(&DataKey::Admin, &proposed_admin);
        env.storage().instance().remove(&DataKey::ProposedAdmin);
        Self::bump_instance_ttl(&env);

        admin_transferred(
            &env,
            previous_admin,
            proposed_admin.clone(),
            Symbol::new(&env, "accept"),
        );
        Ok(())
    }

    /// Set the governance contract permitted to replace this contract's admin.
    ///
    /// Once configured, [`Self::set_admin`] accepts authorisation from this
    /// contract only. That is the point of configuring one: governance enforces a
    /// 24-hour timelock and a signer quorum, so leaving a single admin key able to
    /// call `set_admin` directly would bypass the entire apparatus. The admin
    /// keeps [`Self::propose_admin`] / [`Self::accept_admin`] as a two-step escape
    /// hatch should governance become unreachable.
    ///
    /// Requires admin authorization.
    pub fn set_governance(env: Env, governance: Address) -> Result<(), PoolError> {
        Self::admin(&env).require_auth();

        env.storage()
            .instance()
            .set(&DataKey::Governance, &governance);
        Self::bump_instance_ttl(&env);

        governance_updated(&env, governance);
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
    /// the current admin otherwise. This is the entry point that
    /// `MultisigGovernance::finalize_admin_transfer` invokes on its target, so it
    /// is also the boundary at which the target verifies that the caller really
    /// is the governance contract rather than merely holding the admin key.
    ///
    /// Use [`Self::propose_admin`] / [`Self::accept_admin`] for a two-step
    /// transfer that works in either configuration.
    ///
    /// # Errors
    ///
    /// [`PoolError::NotInitialized`] when the contract has no admin.
    pub fn set_admin(env: Env, new_admin: Address) -> Result<(), PoolError> {
        let current_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(PoolError::NotInitialized)?;

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

        admin_transferred(&env, current_admin, new_admin, via);
        Ok(())
    }

    pub fn pause(env: Env) {
        Self::admin(&env).require_auth();
        env.storage().instance().set(&DataKey::Paused, &true);
        Self::bump_instance_ttl(&env);

        pool_paused(&env);
    }

    pub fn unpause(env: Env) {
        Self::admin(&env).require_auth();
        env.storage().instance().set(&DataKey::Paused, &false);
        Self::bump_instance_ttl(&env);

        pool_unpaused(&env);
    }

    pub fn is_paused(env: Env) -> bool {
        Self::bump_instance_ttl(&env);
        env.storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
    }

    pub fn get_total_outstanding(env: Env, token: Address) -> i128 {
        Self::read_total_outstanding(&env, &token)
    }

    /// Adjust the outstanding counter by a signed `delta`.
    ///
    /// Retained for the LoanManager's net-delta call sites, but re-gated from
    /// admin auth to LoanManager auth: the pool's admin and the contract that
    /// creates loans are different roles, and only the latter moves this counter.
    pub fn adjust_outstanding(env: Env, token: Address, delta: i128) {
        if Self::require_loan_manager(&env).is_err() {
            panic!("loan manager not set");
        }

        if delta == 0 {
            return;
        }

        let key = DataKey::TotalOutstanding(token.clone());
        let current = Self::read_total_outstanding(&env, &token);
        let updated = current
            .checked_add(delta)
            .expect("total outstanding overflow");

        if updated < 0 {
            panic!("total outstanding underflow");
        }

        env.storage().instance().set(&key, &updated);
        Self::bump_instance_ttl(&env);
    }

    pub fn pool_balance(env: Env, token: Address) -> i128 {
        Self::read_pool_balance(&env, &token)
    }

    // ── LoanManager integration ───────────────────────────────────────────
    //
    // Principal must leave the pool through the pool itself. A contract address
    // can only authorise implicitly — by being the contract currently executing
    // — so a LoanManager calling `token.transfer(pool, borrower, amount)` can
    // never be authorised: the pool is not in that call stack, and a signature
    // cannot stand in for a contract address. Routing disbursement through
    // `disburse` makes the pool the executing contract, so its implicit
    // authorisation applies. This is the only supported way for principal to
    // reach a borrower.

    /// Set the LoanManager contract permitted to call [`Self::disburse`] and
    /// [`Self::settle_outstanding`].
    ///
    /// Requires admin authorization. Re-pointing this at a hostile contract
    /// would hand it the pool's funds, so it is admin-gated and emits an event.
    pub fn set_loan_manager(env: Env, loan_manager: Address) -> Result<(), PoolError> {
        Self::admin(&env).require_auth();

        env.storage()
            .instance()
            .set(&DataKey::LoanManager, &loan_manager);
        Self::bump_instance_ttl(&env);

        loan_manager_updated(&env, loan_manager);
        Ok(())
    }

    /// Address of the configured LoanManager, if any.
    pub fn get_loan_manager(env: Env) -> Option<Address> {
        Self::bump_instance_ttl(&env);
        env.storage().instance().get(&DataKey::LoanManager)
    }

    /// Authorise an inbound call from the configured LoanManager.
    ///
    /// The LoanManager is the *invoker* of this contract, so its implicit
    /// authorisation applies and no signature is required. A caller that merely
    /// holds the same admin key is not accepted — the pool's admin and its
    /// LoanManager are deliberately distinct roles.
    fn require_loan_manager(env: &Env) -> Result<Address, PoolError> {
        let loan_manager: Address = env
            .storage()
            .instance()
            .get(&DataKey::LoanManager)
            .ok_or(PoolError::LoanManagerNotSet)?;
        loan_manager.require_auth();
        Self::bump_instance_ttl(env);
        Ok(loan_manager)
    }

    /// Move `amount` of `token` from the pool to `to`, recording it as
    /// outstanding.
    ///
    /// Recording the amount as outstanding is what keeps
    /// `total_pool_assets = idle_balance + outstanding` true, so the LP share
    /// price is unchanged by disbursement (the pool has exchanged idle tokens
    /// for a claim of equal size) and rises only when interest is repaid.
    ///
    /// Callable only by the configured LoanManager. State is written before the
    /// token transfer (checks-effects-interactions).
    ///
    /// # Errors
    ///
    /// [`PoolError::LoanManagerNotSet`] when no LoanManager is configured;
    /// [`PoolError::ContractPaused`] when the pool is paused;
    /// [`PoolError::InvalidAmount`] for non-positive amounts;
    /// [`PoolError::InsufficientLiquidity`] when idle balance is below `amount`.
    pub fn disburse(env: Env, token: Address, to: Address, amount: i128) -> Result<(), PoolError> {
        Self::require_loan_manager(&env)?;
        Self::assert_not_paused(&env)?;

        if amount <= 0 {
            return Err(PoolError::InvalidAmount);
        }

        let idle_balance = Self::read_pool_balance(&env, &token);
        if amount > idle_balance {
            return Err(PoolError::InsufficientLiquidity);
        }

        // ── EFFECTS before the external call ──────────────────────────────
        let current = Self::read_total_outstanding(&env, &token);
        let updated = current
            .checked_add(amount)
            .ok_or(PoolError::InvalidAmount)?;
        env.storage()
            .instance()
            .set(&DataKey::TotalOutstanding(token.clone()), &updated);
        Self::bump_instance_ttl(&env);

        // ── INTERACTION ───────────────────────────────────────────────────
        TokenClient::new(&env, &token).transfer(&env.current_contract_address(), &to, &amount);

        disbursed(&env, token, to, amount);
        Ok(())
    }

    /// Reduce the pool's outstanding balance by `amount`.
    ///
    /// Called by the LoanManager when principal is returned (repayment),
    /// retired (refinance downward), or written off (default). Saturates at
    /// zero so a mis-sequenced settlement can never underflow the counter and
    /// silently corrupt the share price.
    ///
    /// Callable only by the configured LoanManager.
    pub fn settle_outstanding(env: Env, token: Address, amount: i128) -> Result<(), PoolError> {
        Self::require_loan_manager(&env)?;

        if amount < 0 {
            return Err(PoolError::InvalidAmount);
        }

        let current = Self::read_total_outstanding(&env, &token);
        let updated = current.saturating_sub(amount);
        env.storage()
            .instance()
            .set(&DataKey::TotalOutstanding(token.clone()), &updated);
        Self::bump_instance_ttl(&env);

        outstanding_settled(&env, token, amount);
        Ok(())
    }
}

#[cfg(test)]
mod test;
