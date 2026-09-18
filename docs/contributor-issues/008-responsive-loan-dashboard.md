---
title: "Add responsive design for the loan management dashboard"
area: frontend
difficulty: intermediate
labels: ["enhancement", "frontend", "help wanted", "ux"]
---


## Description

The loan management dashboard pages need responsive design improvements for mobile and tablet screens. Currently, several components assume desktop-width layouts and break on smaller screens.

## Design Reference

The project includes design documents:
- `UIUX Desktop.txt`
- `UIUX Mobile First.txt`
- `LENDERS_DASHBOARD_DESIGN.md`

## Components to Update

- **Loan List**: `frontend/src/app/[locale]/loans/page.tsx` — Currently displays loans in a table format that overflows on mobile
- **Loan Details**: `frontend/src/app/[locale]/loans/[loanId]/LoanDetailsPageClient.tsx` — Side-by-side layout doesn't stack on mobile
- **Dashboard Stats**: `frontend/src/app/[locale]/dashboard/page.tsx` — Stats cards need responsive grid
- **Admin Panel**: `frontend/src/app/[locale]/admin/` — Admin tables need horizontal scroll on mobile

## Requirements

- Use Tailwind CSS responsive prefixes (`sm:`, `md:`, `lg:`) for breakpoints
- Convert tables to card layouts on mobile (stacked cards with labels)
- Ensure all modals and dropdowns work on touch devices
- Test at 375px, 768px, and 1440px viewport widths
- Follow the mobile-first approach outlined in `UIUX Mobile First.txt`
- Reuse existing components (Card, Skeleton, EmptyState, Button)

## Definition of Done

- All dashboard pages are usable on a 375px wide mobile screen
- All interactive elements work on touch (no hover-only interactions)
- No horizontal scrolling on content
- `npm test` passes
