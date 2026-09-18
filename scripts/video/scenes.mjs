/**
 * The pitch video's single source of truth.
 *
 * One entry per scene. Everything downstream — the narration audio, the overlay
 * stills, the ffmpeg composition, and the verification pass — is derived from this
 * file, so the narration, the on-screen text, and the footage cannot drift apart.
 * Editing a claim here is the only way to change a claim in the video.
 *
 * `narration` is spoken verbatim. `overlay` describes what is drawn on top of the
 * footage; see `overlays.mjs` for the templates. `visual` selects the background and
 * its motion.
 *
 * Claims that appear in the narration and on screen are checked against the
 * repository by `verify.mjs` where a number is involved, because a pitch that
 * misstates its own metrics is worse than one that states fewer of them.
 */

/** Frame geometry. 1080p at 30fps — the format every platform accepts. */
export const VIDEO = {
  width: 1920,
  height: 1080,
  fps: 30,
  /** Cross-dissolve length. Long enough to read as deliberate, short enough not to drag. */
  transition: 0.6,
  /** Silence held after the narration ends, so the dissolve always lands on quiet. */
  tail: 1.1,
};

/** Brand palette, taken from `docs/DESIGN.md` and the frontend's CSS custom properties. */
export const BRAND = {
  bg: "#0D0D12",
  surface: "#16161F",
  surfaceElevated: "#1E1E2A",
  violet: "#7C3AED",
  violetSoft: "#A78BFA",
  teal: "#0ECFCF",
  success: "#22C55E",
  warning: "#F59E0B",
  danger: "#EF4444",
  text: "#F1F5F9",
  textSecondary: "#94A3B8",
  textMuted: "#64748B",
  border: "#2A2A3A",
};

export const SCENES = [
  {
    id: "hook",
    narration:
      "Every year, the world's two hundred and eighty million migrant workers send hundreds of billions of dollars home. Every one of those transfers is proof that they pay their bills on time. Almost none of them get credit for it.",
    visual: { gradient: ["#0D0D12", "#1A0B2E"] },
    overlay: {
      kind: "stats",
      eyebrow: "The remittance economy",
      items: [
        { value: "280M", label: "migrant workers worldwide" },
        { value: "$800B+", label: "sent home every year" },
      ],
      footer: "Reliable payers. Invisible to credit.",
    },
  },
  {
    id: "problem",
    narration:
      "Here is the trap. A worker sending money from Dubai to Manila builds a decade of reliable financial history, and owns none of it. They cannot open a bank account at home, cannot prove income, cannot borrow. And yet this is exactly the customer a lender wants. The data exists. It is just trapped inside somebody else's database.",
    visual: { asset: "live/landing-workflow", motion: "pan-right" },
    overlay: {
      kind: "lowerThird",
      eyebrow: "The problem",
      title: "Financial history without financial identity",
      points: [
        "No credit bureau record — no score, ever",
        "Remittance proof is siloed inside each provider",
        "Thin-file borrowers pay the highest rates, or get nothing",
      ],
    },
  },
  {
    id: "solution",
    narration:
      "ZizaLend turns remittance history into a portable, on-chain credit identity. Every transfer you make on Stellar is scored, attested, and minted as a Remittance NFT that you own. That NFT becomes collateral for a loan from a transparent liquidity pool. No credit bureau, no branch, no paperwork. Just the financial reputation you already earned, and a score anyone can verify.",
    visual: { asset: "local/readme-lifecycle", motion: "zoom-in" },
    overlay: {
      kind: "lowerThird",
      eyebrow: "The solution",
      title: "Send money. Build credit. Borrow.",
      points: [
        "Remittance history scores into a portable on-chain identity",
        "That identity is minted as an NFT the borrower actually owns",
        "The NFT collateralises a loan from a pool of real lender capital",
      ],
    },
  },
  {
    id: "architecture",
    narration:
      "Under the hood, four Soroban contracts deployed on Stellar Testnet. Remittance NFT issues the credit identity. The lending pool holds lender liquidity and tracks shares. The loan manager owns the whole lifecycle: request, approval, interest, repayment. And multisig governance gates every privileged action. The contracts talk to each other, and nothing trusts the backend.",
    visual: { asset: "local/architecture", motion: "zoom-out" },
    overlay: {
      kind: "lowerThird",
      eyebrow: "Architecture",
      title: "Four Soroban contracts. No trusted middle.",
      points: [
        "RemittanceNFT · credit identity and score history",
        "LendingPool · liquidity, shares, and yield accounting",
        "LoanManager · loan lifecycle and interest accrual",
        "MultisigGovernance · time-locked privileged actions",
      ],
    },
  },
  {
    id: "live-app",
    narration:
      "So let's look at the real thing. This is the live deployment, running against those deployed Testnet contracts, with a Freighter wallet. This is a working application, not a mockup and not a clickable prototype.",
    visual: { asset: "live/landing-hero", motion: "pan-down" },
    overlay: {
      kind: "title",
      eyebrow: "Live on Stellar Testnet",
      title: "zizalend.vercel.app",
      subtitle: "Four contracts deployed, wired, and verified end to end",
    },
  },
  {
    id: "borrower",
    narration:
      "Connect a wallet and the borrower view comes alive: your score, read from the contract, and the history behind it. The loan wizard walks you through amount, term, and the collateral you are willing to lock. Nothing here is a hard-coded display value. Every figure is a contract call, and every action is a signed transaction.",
    visual: { asset: "live/request-loan", motion: "zoom-in" },
    overlay: {
      kind: "callouts",
      eyebrow: "For borrowers",
      title: "From score to loan, in one flow",
      items: [
        { at: [0.16, 0.34], text: "Score read from the contract" },
        { at: [0.62, 0.42], text: "Amount, term, and collateral" },
        { at: [0.3, 0.86], text: "Signed, simulated, then submitted" },
      ],
    },
  },
  {
    id: "lenders",
    narration:
      "Lenders take the other side. Deposit into a pool and receive shares. Yield comes from real repayments, not from a token printer. Withdrawals are guarded, share pricing is explicit rather than implied, and the pool's outstanding balance is always auditable on chain. A lender can check the book without asking anyone's permission.",
    visual: { asset: "live/lend", motion: "pan-left" },
    overlay: {
      kind: "callouts",
      eyebrow: "For lenders",
      title: "Real yield from real repayments",
      items: [
        { at: [0.14, 0.36], text: "Deposit → shares" },
        { at: [0.58, 0.3], text: "Pool utilisation and yield" },
        { at: [0.26, 0.84], text: "Guarded withdrawals" },
      ],
    },
  },
  {
    id: "repayment",
    narration:
      "Then repay, and the protocol does something a bank will not: it credits your score. On-time repayment compounds into a higher limit and better terms on the next loan. That is the flywheel, and the contract's state machine enforces it, not a policy document.",
    visual: { asset: "live/analytics", motion: "zoom-in" },
    overlay: {
      kind: "lowerThird",
      eyebrow: "The flywheel",
      title: "Repay, and the score compounds",
      points: [
        "Repayment event → score update → higher limit",
        "Enforced by the contract state machine, not by policy",
        "Collateral is released only when the loan settles",
      ],
    },
  },
  {
    id: "transparency",
    narration:
      "Activity, analytics, liquidations, governance. Every state change is indexed from Soroban events and mirrored into the interface, so what the screen shows is what the chain says. When the two disagree, the chain wins, and it is the indexer that gets fixed.",
    visual: { asset: "live/wallet", motion: "pan-right" },
    overlay: {
      kind: "callouts",
      eyebrow: "Transparency",
      title: "The UI mirrors the ledger",
      items: [
        { at: [0.2, 0.3], text: "Indexed from Soroban events" },
        { at: [0.66, 0.5], text: "Liquidations in the open" },
        { at: [0.34, 0.86], text: "Governance proposals and timelocks" },
      ],
    },
  },
  {
    id: "performance",
    narration:
      "Performance was engineered rather than assumed. Every major transaction is benchmarked against the deployed contracts, on chain, and the numbers are published in the repository: deposits, withdrawals, loan requests, approvals, repayments, liquidations. Contract coverage is gated at seventy-five percent in CI, and the suite clears that gate. The WASM size budget is enforced too, so a fat contract fails the build instead of the wallet.",
    visual: { asset: "local/gas-table", motion: "pan-down" },
    overlay: {
      kind: "lowerThird",
      eyebrow: "Measured, not estimated",
      title: "Gas published for every major transaction",
      points: [
        "6 state-changing operations benchmarked on Testnet",
        "Coverage gated at 75% in CI, measured at 89%",
        "WASM size budgets enforced per contract",
      ],
    },
  },
  {
    id: "security",
    narration:
      "Security runs through it. More than a hundred typed error codes, each one documented, reachable, and stable, because a deployed variant's number is part of the ABI. Access control is reviewed contract by contract and written down. There is a threat model, a security policy, CodeQL on every push, and a dependency review on every pull request.",
    visual: { asset: "local/error-codes", motion: "zoom-out" },
    overlay: {
      kind: "lowerThird",
      eyebrow: "Security",
      title: "113 error codes. Every one reachable.",
      points: [
        "Codes are permanent — the ABI depends on them",
        "Per-contract access-control review, written down",
        "CodeQL on push, dependency review on every PR",
      ],
    },
  },
  {
    id: "ci",
    narration:
      "Seven GitHub Actions workflows, thirteen required status checks on main, branch protection, and a CI badge that tells the truth. If it is red, it does not merge. The frontend deploys from the same pipeline that tests it.",
    visual: { asset: "live/github-actions", motion: "pan-down" },
    overlay: {
      kind: "stats",
      eyebrow: "Continuous integration",
      items: [
        { value: "7", label: "GitHub Actions workflows" },
        { value: "13", label: "required checks on main" },
      ],
      footer: "If it is red, it does not merge.",
    },
  },
  {
    id: "open-source",
    narration:
      "And it is built to be contributed to. One hundred and twenty open issues, structured as real engineering work: contract hardening, indexer reliability, SDK surface, fuzzing campaigns, gas optimisation. Not cosmetic tasks. A contributor can land something meaningful, and the backlog says exactly where to start.",
    visual: { asset: "live/github-issues", motion: "pan-down" },
    overlay: {
      kind: "stats",
      eyebrow: "Open source",
      items: [
        { value: "120", label: "structured open issues" },
        { value: "ISSUE-###", label: "backlog reviewed like code" },
      ],
      footer: "Real engineering work, not cosmetics.",
    },
  },
  {
    id: "close",
    narration:
      "ZizaLend is live on Stellar Testnet today. All four contracts deployed, wired, and verified end to end by an automated test that runs the entire journey, from deposit to loan to repayment to a credited score. The application is deployed, and the whole thing is open source. Every transfer builds your future.",
    visual: { asset: "live/landing-hero", motion: "zoom-out" },
    overlay: {
      kind: "closing",
      title: "Every transfer builds your future",
      links: [
        { label: "zizalend.vercel.app", value: "Live application" },
        { label: "github.com/Ziza-Inc/ZizaLend", value: "Open source" },
        { label: "Stellar Testnet", value: "4 contracts, verified end to end" },
      ],
    },
  },
];

export default SCENES;
