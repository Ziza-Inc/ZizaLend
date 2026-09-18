# ZizaLend Design Specification

> This document captures the design system, component library, and layout specifications for ZizaLend. It serves as the source of truth for UI development — no Figma file required.

---

## 1. Design System

### 1.1 Color Palette

| Role | Token | Hex | Usage |
|------|-------|-----|-------|
| Background | `--bg` | `#0D0D12` (Obsidian) | Main page background |
| Surface | `--surface` | `#16161F` | Cards, modals, sidebars |
| Surface Elevated | `--surface-elevated` | `#1E1E2A` | Hovered cards, dropdowns |
| Primary Accent | `--primary` | `#7C3AED` (Neon Purple) | CTAs, active states, links |
| Primary Hover | `--primary-hover` | `#6D28D9` | Button hover states |
| Secondary Accent | `--secondary` | `#0ECFCF` (Teal) | Secondary CTAs, progress fills, active nav |
| Success | `--success` | `#22C55E` | Repaid loans, positive yield, confirmed tx |
| Warning | `--warning` | `#F59E0B` (Amber) | Pending status, approaching thresholds |
| Danger | `--danger` | `#EF4444` | Defaulted loans, negative yield, errors |
| Text Primary | `--text-primary` | `#F1F5F9` | Headings, body text |
| Text Secondary | `--text-secondary` | `#94A3B8` | Labels, descriptions |
| Text Muted | `--text-muted` | `#64748B` | Placeholders, hints, timestamps |
| Border | `--border` | `#2A2A3A` | Card borders, dividers |
| Overlay | `--overlay` | `rgba(0, 0, 0, 0.6)` | Modal backdrops |

### 1.2 Typography

| Element | Font | Size | Weight | Line Height |
|---------|------|------|--------|-------------|
| H1 (Page Title) | Inter | 32px / 2rem | 700 (Bold) | 1.2 |
| H2 (Section) | Inter | 24px / 1.5rem | 600 (Semibold) | 1.3 |
| H3 (Card Title) | Inter | 18px / 1.125rem | 600 (Semibold) | 1.4 |
| Body | Inter | 14px / 0.875rem | 400 (Regular) | 1.5 |
| Body Small | Inter | 12px / 0.75rem | 400 (Regular) | 1.5 |
| Label | Inter | 12px / 0.75rem | 500 (Medium) | 1.4 |
| Monospace | JetBrains Mono | 13px / 0.8125rem | 400 (Regular) | 1.4 |
| Stat / Hero | Inter | 40px / 2.5rem | 700 (Bold) | 1.1 |

### 1.3 Spacing Scale

| Token | Pixels | Rem | Usage |
|-------|--------|-----|-------|
| `space-1` | 4px | 0.25rem | Icons, small gaps |
| `space-2` | 8px | 0.5rem | Inner padding (compact) |
| `space-3` | 12px | 0.75rem | Inner padding (default) |
| `space-4` | 16px | 1rem | Card padding, section gaps |
| `space-5` | 20px | 1.25rem | Between form fields |
| `space-6` | 24px | 1.5rem | Between sections |
| `space-8` | 32px | 2rem | Page section padding |
| `space-10` | 40px | 2.5rem | Page top/bottom margins |

### 1.4 Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| `radius-sm` | 6px | Buttons, inputs |
| `radius-md` | 8px | Cards, modals |
| `radius-lg` | 12px | Large modals, sheets |
| `radius-xl` | 16px | Page-level containers |
| `radius-full` | 9999px | Badges, avatars |

### 1.5 Shadows

| Token | Value | Usage |
|-------|-------|-------|
| `shadow-sm` | `0 1px 2px rgba(0,0,0,0.3)` | Subtle card elevation |
| `shadow-md` | `0 4px 12px rgba(0,0,0,0.4)` | Dropdowns, modals |
| `shadow-lg` | `0 8px 32px rgba(0,0,0,0.5)` | Full-screen overlays |
| `shadow-glow` | `0 0 16px rgba(124, 58, 237, 0.3)` | Primary accent glow |

---

## 2. Component Library

### 2.1 Global UI Components

These components appear across all pages and form the structural shell of the application.

#### Header
- **File:** `components/global_ui/Header.tsx`
- **Mobile:** Hidden (replaced by BottomNav)
- **Desktop:** Fixed top bar with:
  - Logo / branding (left)
  - Navigation links (center): Dashboard, Lend, Borrow, Kingdom
  - Wallet connection button (right)
  - Notification bell with unread badge
- **Background:** `#0D0D12` with slight bottom border glow

#### Sidebar
- **File:** `components/global_ui/Sidebar.tsx`
- **Desktop only:** Left-aligned fixed sidebar
- **Width:** 240px
- **Links:** Dashboard, Loans, Lend, Liquidations, Kingdom, Analytics, Activity, Settings, Admin
- **Active state:** Teal (`#0ECFCF`) left border indicator

#### Bottom Navigation (Mobile)
- **File:** `components/global_ui/BottomNav.tsx`
- **Fixed to bottom** of viewport
- **4 tabs:** Citadel (Dashboard), Vaults (Lend), Quests (Kingdom), Empire (Activity)
- **Active state:** Teal underline + icon highlight

#### Dashboard Shell
- **File:** `components/global_ui/DashboardShell.tsx`
- Responsive container that wraps Header + Sidebar (desktop) or BottomNav (mobile) + page content
- Max content width: 1280px, centered

#### Notification Dropdown
- **File:** `components/global_ui/NotificationDropdown.tsx`
- Dropdown panel triggered from Header bell icon
- Lists recent notifications with read/unread states
- "Mark all read" action
- Links to full Notifications page

#### Breadcrumbs
- **File:** `components/global_ui/Breadcrumbs.tsx`
- Optional secondary navigation within pages
- Separator: `/` in muted text

#### Route Error View
- **File:** `components/global_ui/RouteErrorView.tsx`
- Error boundary fallback for route-level errors
- Retry button + error message + support link

#### Offline Banner
- **File:** `components/global_ui/OfflineBanner.tsx`
- Top-of-page banner when network connection is lost
- Yellow/amber background with "You are offline" message
- Dismissible

#### Language Switcher
- **File:** `components/global_ui/LanguageSwitcher.tsx`
- Dropdown for i18n locale selection (EN, ES, TL)
- Stored in user preferences

#### Global XP Gain
- **File:** `components/global_ui/GlobalXPGain.tsx`
- Animated toast-like popup for XP gain events
- Shows "+X XP" with teal text and subtle animation
- Auto-dismisses after 3 seconds

#### Spinner
- **File:** `components/global_ui/Spinner.tsx`
- SVG spinning animation
- Size variants: sm (16px), md (24px), lg (40px)
- Color: primary accent (`#7C3AED`)

#### Install Prompt (PWA)
- **File:** `components/global_ui/InstallPrompt.tsx`
- Bottom sheet prompting users to install as PWA
- Shows on mobile when `beforeinstallprompt` event fires

#### Error Boundary
- **File:** `components/global_ui/ErrorBoundary.tsx`
- React error boundary wrapping page content
- Fallback: "Something went wrong" with retry button

### 2.2 UI Primitives

#### Button
- **File:** `components/ui/Button.tsx`
- **Variants:** `primary` (purple bg), `secondary` (teal outline), `ghost` (no bg), `danger` (red)
- **Sizes:** `sm` (32px), `md` (40px), `lg` (48px)
- **States:** default, hover, active, disabled, loading (shows spinner)
- **Border radius:** 6px

#### Input
- **File:** `components/ui/Input.tsx`
- Dark surface (`#16161F`) background
- Border: `#2A2A3A` on default, `#7C3AED` on focus
- Error state: red border + error text below
- Prefix/suffix icons and text support

#### Modal
- **File:** `components/ui/Modal.tsx`
- Overlay backdrop with click-outside-to-close
- Size variants: `sm` (400px), `md` (540px), `lg` (720px)
- Title bar with close icon (top right)
- Body content with optional footer action area

#### Card
- **File:** `components/ui/Card.tsx`
- Background: `#16161F`
- Inner padding: 16px (default), 24px (large variant)
- Optional header section with title + action
- Hover state: slight glow elevation

#### Toast
- **File:** `components/ui/Toast.tsx`
- Position: bottom-right (desktop), top-center (mobile)
- Variants: success (green), warning (amber), error (red), info (purple)
- Auto-dismiss: 5 seconds
- Stackable (max 3 visible)

#### Skeleton
- **File:** `components/ui/Skeleton.tsx`
- Loading placeholder with shimmer animation
- Variants: text, circle, rectangle, card
- Width/height configurable via props

#### Tooltip
- **File:** `components/ui/Tooltip.tsx`
- Position: top, bottom, left, right
- Dark surface background with arrow
- Shows on hover after 300ms delay

#### Tabs
- Used throughout (inline, not standalone component)
- Active tab: bottom border in teal (`#0ECFCF`)
- Inactive: muted text color

#### Badge
- **File:** `components/ui/LoanStatusBadge.tsx`
- Small pill with status text
- Colors: Active (teal), Repaid (green), Defaulted (red), Pending (amber), Disputed (purple)
- Optional icon prepended

#### Pagination Controls
- **File:** `components/ui/PaginationControls.tsx`
- Previous/Next buttons with page info
- "Showing X-Y of Z" label

#### Empty State
- **File:** `components/ui/EmptyState.tsx`
- Icon + heading + description + optional CTA button
- Used for empty lists, no results, etc.

#### Copy Button
- **File:** `components/ui/CopyButton.tsx`
- Click-to-copy with clipboard icon
- Shows "Copied!" checkmark for 2 seconds

#### Theme Toggle
- **File:** `components/ui/ThemeToggle.tsx`
- Toggles between dark and light mode
- Sun/moon icon swap
- Currently dark mode is primary, light mode is secondary

#### Status Indicator
- **File:** `components/ui/StatusIndicator.tsx`
- Small colored dot + label
- Green (healthy/active), Amber (pending/warning), Red (error/defaulted)

#### Confirm Transaction Dialog
- **File:** `components/ui/ConfirmTransactionDialog.tsx`
- Multi-step modal: Review → Sign → Confirm
- Shows transaction details (amount, fee, addresses)
- Pending state while waiting for wallet signature

### 2.3 Credit Score Components

#### Credit Score Gauge
- **File:** `components/ui/CreditScoreGauge.tsx`
- Circular progress ring showing score (300–850)
- Color transitions: Red → Amber → Yellow → Green based on score
- Center text: score number + tier label
- Subtle pulsing animation on score change

#### Credit Score Breakdown
- **File:** `components/ui/CreditScoreBreakdown.tsx`
- Tabular breakdown of scoring factors
- Sections: Repayment History, Loan Activity, Time Since First Loan
- Each factor shows weight, current value, and max possible

#### Credit Score Trend Chart
- **File:** `components/charts/CreditScoreTrendChart.tsx`
- Line chart of score history over time
- X-axis: Time (configurable range)
- Y-axis: Score (300–850)
- Annotations for key events (repayment, default, decay)

### 2.4 Loan Components

#### Loan Card
- **File:** `components/borrower/LoanCard.tsx`
- Compact card showing loan summary
- Fields: Amount (large), Status badge, Next payment date, Interest rate
- CTA: View Details → links to loan detail page

#### Loan Dashboard
- **File:** `components/borrower/LoanDashboard.tsx`
- Borrower's main loan overview
- Sections: Active Loans, Recent Activity, Repayment Schedule
- Summary stats at top: Total Borrowed, Active Loans Count, Next Payment

#### Loan List
- **File:** `components/borrower/LoanList.tsx`
- Filterable, paginated list of loans
- Filters: Status (active/repaid/defaulted), Date range, Amount range
- Sortable by date, amount, status

#### Loan Repayment Form
- **File:** `components/borrower/LoanRepaymentForm.tsx`
- Amount input with max button
- Shows remaining balance, interest accrued
- Wallet signature step before submission

#### Active Loans Tracker
- **File:** `components/borrower/ActiveLoansTracker.tsx`
- Visual timeline of active loans
- Progress bars showing repayment percentage
- Upcoming payment countdown

#### Loan Health
- **File:** `components/loan/LoanHealth.tsx`
- Health score gauge (0–100)
- Color-coded: Green (>75), Amber (50–75), Red (<50)
- Factors: Collateral ratio, Payment timeliness, Time remaining

#### Loan Timeline
- **File:** `components/ui/LoanTimeline.tsx`
- Vertical timeline of loan events
- Each event: Icon + label + date + amount
- Events: Requested, Approved, Repaid, Defaulted, Disputed, Liquidated

#### Repayment Progress
- **File:** `components/ui/RepaymentProgress.tsx`
- Horizontal progress bar: repaid amount vs total owed
- Percentage label centered on bar
- Green fill gradient

### 2.5 Loan Wizard

#### Loan Application Wizard
- **File:** `components/loan-wizard/LoanApplicationWizard.tsx`
- Multi-step form: 4 steps
- Step indicator at top with progress

#### Step 1: Amount & Asset
- **File:** `components/loan-wizard/StepAmountAsset.tsx`
- Amount input with asset selector (XLM, USDC)
- Live interest rate preview based on amount
- Minimum/maximum validation

#### Step 2: Collateral NFT
- **File:** `components/loan-wizard/StepCollateralNFT.tsx`
- Select Remittance NFT to use as collateral
- Shows NFT metadata: score, tier, mint date
- "No NFT" fallback flow

#### Step 3: Repayment Schedule
- **File:** `components/loan-wizard/StepRepaymentSchedule.tsx`
- Amortization table: installment breakdown
- Shows per-payment: principal, interest, due date
- Summary: total interest, APR, total repayment

#### Step 4: Final Signature
- **File:** `components/loan-wizard/StepFinalSignature.tsx`
- Review all terms before signing
- Wallet signature request via Freighter/Albedo
- Loading state while transaction is submitted
- Success confirmation with tx hash

#### Refinance Loan Modal
- **File:** `components/loan-wizard/RefinanceLoanModal.tsx`
- Modify existing loan terms mid-cycle
- Fields: New amount, new term
- Shows old vs new comparison
- Fee preview for refinancing

#### Extension Loan Modal
- **File:** `components/loan-wizard/ExtensionLoanModal.tsx`
- Extend loan due date
- Slider or input for extra days/ledgers
- Fee calculation based on extension length

#### Wizard Stepper
- **File:** `components/loan-wizard/WizardStepper.tsx`
- Horizontal step indicator
- Steps: numbered circles with labels
- Active: filled purple, Completed: filled green, Upcoming: outlined muted

#### Repayment Schedule Table
- **File:** `components/loan-wizard/RepaymentScheduleTable.tsx`
- Full amortization table
- Columns: Period, Due Date, Principal, Interest, Total, Balance
- Responsive: scrollable on mobile

### 2.6 Lender Components

#### Yield Earnings Chart
- **File:** `components/charts/YieldEarningsChart.tsx`
- Interactive line chart showing yield over time
- Timeframe toggles: 1D, 1W, 1M
- Percentage growth delta shown above chart
- Smooth curve with teal stroke on dark canvas

#### Risk Tier Chart
- **File:** `components/charts/RiskTierChart.tsx`
- Visual breakdown of pool risk distribution
- Colored segments: Low (green), Medium (amber), High (red)
- Interactive tooltips on hover

#### Deposit Flow
- Via wallet components + pool interactions
- Amount input with live APR preview
- Platform fee breakdown before confirmation
- Wallet signature step

#### Withdraw Flow
- Shows available balance + locked collateral
- Emergency withdraw option when pools are paused
- Estimated settlement time

### 2.7 Transaction Components

#### Transaction Preview Modal
- **File:** `components/transaction/TransactionPreviewModal.tsx`
- Before-submission review of any transaction
- Fields: From, To, Amount, Fee, Network
- Raw XDR display option for advanced users

#### Collateral Action Modal
- **File:** `components/transaction/CollateralActionModal.tsx`
- Deposit or release collateral for a loan
- Shows current collateral balance
- Amount input with max button

#### Recent Transactions Drawer
- **File:** `components/transaction/RecentTransactionsDrawer.tsx`
- Slide-in drawer with recent transaction list
- Each item: Type icon, Amount, Status, Timestamp
- Link to full Activity page

#### Transaction Status Tracker
- **File:** `components/ui/TransactionStatusTracker.tsx`
- Steps: Submitted → Confirmed → Finalized
- Animated progress between steps
- Each step shows timestamp when completed

### 2.8 Gamification Components

#### Kingdom Progress Widget
- **File:** `components/gamification/KingdomProgressWidget.tsx`
- Dashboard widget showing Kingdom progress
- Hero metric: "Kingdom Value" ($24,500)
- Sub-metrics: Net Worth, Savings Rate
- "New Quest Available" CTA

#### XP Gain Animation
- **File:** `components/gamification/XPGainAnimation.tsx`
- Floating "+X XP" text that animates upward and fades
- Triggers on repayments, deposits, quest completions
- Color: teal (`#0ECFCF`)

#### Achievements Panel
- **File:** `components/gamification/AchievementsPanel.tsx`
- Grid of achievement badges
- Each badge: Icon, Name, Description, Progress (locked/unlocked)
- Categories: Financial, Community, Milestone

#### Level Up Modal
- **File:** `components/gamification/LevelUpModal.tsx`
- Celebratory modal on reaching new Archon level
- Shows: New level number, unlocked features, XP to next level
- "Share" and "Continue" CTAs

#### Gamification Settings
- **File:** `components/gamification/GamificationSettings.tsx`
- Toggle notifications for XP gains, level ups, quests
- Privacy settings for sharing achievements

### 2.9 Remittance Components

#### Remittance Form
- **File:** `components/remittance/RemittanceForm.tsx`
- Cross-border transfer interface
- Fields: Recipient address, Amount, Asset (XLM/USDC), Memo
- Transaction preview before submission
- Recent recipients dropdown

### 2.10 Skeleton Loaders

All skeleton files are in `components/skeletons/`:

| Component | Page | Description |
|-----------|------|-------------|
| `DashboardSkeleton` | Dashboard | Full dashboard layout placeholder |
| `CreditScoreSkeleton` | Dashboard | Circular score gauge placeholder |
| `LoansListSkeleton` | Loans | Loan list items placeholder |
| `LoanDetailSkeleton` | Loan Detail | Single loan detail placeholder |
| `WizardSkeleton` | Loan Wizard | Multi-step form placeholder |
| `DepositWithdrawSkeleton` | Lend | Deposit/withdraw form placeholder |
| `TransactionsSkeleton` | Activity | Transaction list placeholder |
| `AnalyticsSkeleton` | Analytics | Charts and metrics placeholder |
| `KingdomProgressSkeleton` | Kingdom | Gamification dashboard placeholder |
| `AchievementsSkeleton` | Kingdom | Achievements panel placeholder |

---

## 3. Page Layouts

### 3.1 Landing Page (`/`)

**Mobile-First Design**

| Section | Components | Details |
|---------|------------|---------|
| Hero | Full-bleed background | Platform name, tagline, TVL ($1.2B+) and Avg. Yield (4.8%) metrics |
| | Primary CTA button | "Enter the Citadel" — full-width purple button |
| Feature Suite | 3 feature cards | Lend to Earn, Gamified Quests, Secure Vaults — icon + copy |
| Trust Section | Stellar logo | Network callout; no audit badge until an external audit is complete |
| | Closing module | "The Gates are Opening" urgency headline |
| Sticky Nav | 4 tabs (bottom) | Citadel, Vaults, Quests, Empire |

### 3.2 Borrower Dashboard (`/[locale]/`)

| Area | Components | Details |
|------|------------|---------|
| Score Widget | CreditScoreGauge | Circular gauge (300–850), tier label |
| | CreditScoreBreakdown | Factor breakdown table |
| Active Loans | LoanCard × N | Compact loan summary cards |
| | ActiveLoansTracker | Timeline progress visualization |
| Repayment | LoanRepaymentForm | Quick repay from dashboard |
| Recent Activity | RecentTransactionsDrawer | Last 5 transactions |

### 3.3 Loan Wizard (`/[locale]/request-loan`)

| Step | Component | Details |
|------|-----------|---------|
| Stepper | WizardStepper | 4-step progress indicator |
| 1. Amount | StepAmountAsset | Amount + asset selector |
| 2. Collateral | StepCollateralNFT | NFT selection for collateral |
| 3. Schedule | StepRepaymentSchedule | Amortization table |
| 4. Sign | StepFinalSignature | Review + wallet signature |

### 3.4 Loan Details (`/[locale]/loans/[loanId]`)

| Area | Components | Details |
|------|------------|---------|
| Summary | LoanHealth | Health score gauge |
| | LoanStatusBadge | Status pill |
| Timeline | LoanTimeline | Event history vertical timeline |
| Repayment | RepaymentProgress | Progress bar |
| Actions | Button group | Repay, Extend, Refinance, Add Collateral |

### 3.5 Lender Dashboard (`/[locale]/lend`)

| Area | Components | Details |
|------|------------|---------|
| Yield Chart | YieldEarningsChart | Interactive chart with timeframe toggle |
| Active Positions | Position table | Asset, Pool, Balance, Yield, Status |
| Pool Cards | Card grid | Utilization bar, risk tier, health score |
| Quests Sidebar | Panel | Active quests with XP rewards |
| Expand Position | Slide-in panel | Deposit flow with APR preview |

### 3.6 Kingdom / Gamification (`/[locale]/kingdom`)

| Area | Components | Details |
|------|------------|---------|
| Kingdom Value | Hero stat | Large value display with delta |
| Level | Level display | Archon level with progress to next |
| Quests | Quest list | Active quests with progress bars |
| Achievements | AchievementsPanel | Badge grid with unlock states |

### 3.7 Administration (`/[locale]/admin`)

| Area | Description |
|------|-------------|
| Disputes | Loan dispute list with resolve/reject actions |
| Governance | Multi-sig controls, admin transfer proposals |
| Loans | All-loans overview with status filters |

### 3.8 Activity (`/[locale]/activity`)

| Feature | Description |
|---------|-------------|
| Transaction list | Paginated, filterable history |
| Filters | Type (loan, deposit, withdraw, repay), date range, status |
| CSV Export | Download transaction history |

### 3.9 Settings (`/[locale]/settings`)

| Section | Options |
|---------|---------|
| Notifications | Toggle in-app, email, SMS per event type |
| Theme | Dark/Light mode toggle |
| Wallet | Connected wallet info, disconnect option |
| Language | EN, ES, TL locale selector |

---

## 4. Gamification System

### 4.1 Archon Levels

| Level | Title | XP Required | Unlocks |
|-------|-------|-------------|---------|
| 1–4 | Apprentice | 0–999 | Basic dashboard |
| 5–9 | Sovereign | 1,000–4,999 | Quest system |
| 10–14 | Archon | 5,000–9,999 | Achievement stamps |
| 15–19 | Exalted | 10,000–24,999 | Premium features |
| 20+ | Citadel Lord | 25,000+ | Governance access |

### 4.2 XP Sources

| Action | XP Reward | Cooldown |
|--------|-----------|----------|
| Loan repayment | +50 XP | Per payment |
| Deposit to lending pool | +25 XP | Per deposit |
| Perfect repayment month | +200 XP | Monthly |
| Refer a borrower | +100 XP | Once per referral |
| Complete a quest | +150–500 XP | Per quest |
| First loan | +100 XP (one-time) | — |
| 30-day repayment streak | +300 XP | Monthly |

### 4.3 Quests

| Quest | Requirement | XP | Type |
|-------|-------------|----|------|
| Whale Migration | Deploy $10,000+ liquidity | +500 | One-time |
| Iron Resolve | Maintain position for 30 days | +300 | One-time |
| First Harvest | Repay first loan | +150 | One-time |
| Trusted Borrower | Reach Silver tier | +250 | Milestone |
| Empire Builder | 3 active loans | +400 | Milestone |

### 4.4 Achievement Stamps

| Stamp | Requirement | NFT? |
|-------|-------------|------|
| Early Adopter | Signed up in first 30 days | Yes |
| Trusted | 6 months active | Yes |
| Iron Will | 12 consecutive on-time repayments | Yes |
| Whale | $50,000+ total deposits | Yes |
| Platinum | Reach Platinum credit tier | Yes |

---

## 5. Responsive Breakpoints

| Breakpoint | Width | Layout |
|------------|-------|--------|
| Mobile | < 640px | Single column, BottomNav |
| Tablet | 640–1024px | 2-column grid, Sidebar collapsed |
| Desktop | > 1024px | Full layout, Sidebar visible |

### Mobile Adaptations

- Bottom navigation replaces sidebar
- Cards stack vertically (1 column)
- Modals become full-screen sheets
- Tables scroll horizontally
- Charts reduce to compact view (shorter, legend bottom)

---

## 6. Animation & Interaction Specs

| Element | Animation | Duration | Easing |
|---------|-----------|----------|--------|
| Button hover | Background color + slight scale | 150ms | ease-out |
| Card hover | Subtle glow shadow | 200ms | ease-out |
| Modal open | Fade in + scale up (0.95→1) | 200ms | ease-out |
| XP Gain | Float up + fade out | 1.5s | ease-in-out |
| Score change | Number counter animation | 500ms | ease-out |
| Toast enter | Slide in from right | 300ms | ease-out |
| Skeleton shimmer | Left-to-right sweep | 1.5s (loop) | linear |
| Page transition | Fade in | 200ms | ease-out |

---

## 7. Data Visualization Specs

### Credit Score Gauge
- **Type:** Circular gauge (270° arc)
- **Segments:** Red (300–500), Amber (501–650), Yellow (651–750), Green (751–850)
- **Animation:** Counter animates to current value on load

### Yield Earnings Chart
- **Type:** Smooth line chart (Recharts)
- **Colors:** Teal line (`#0ECFCF`), dark fill gradient below
- **Timeframes:** 1D, 1W, 1M toggle
- **Tooltip:** Crosshair + value popup

### Pool Health Bar
- **Type:** Horizontal progress bar
- **Colors:** Green (>80%), Amber (60–80%), Red (<60%)
- **Label:** "94/100" with percentage fill

---

## 8. Design File Access

The Figma design file is maintained internally. Contact the team for access to the latest mockups, component variants, and prototyping flows.
