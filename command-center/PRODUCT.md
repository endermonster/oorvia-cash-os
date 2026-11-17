# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Delegated (2026-11-18): Next.js App Router + TypeScript + Tailwind CSS 4, deployed on Vercel. It matches Cash OS and the user's other apps, so the Supabase backend plugs in later without a port. The first build is front end only, with mock data.

## Users

One person: Vedaant, who runs VXP Ventures (sole proprietor, Pune) with one partner, Gaurang, 50/50. VXP runs three Shopify D2C stores for the Indian market: **Oorvia** (oorvia.com), **Kaiven** (kaiven.in, live 2026-11-10) and **Selnova** (selnova.in, live 2026-11-13). Private and single-user; never shared.

Vedaant opens it to decide whether to scale, hold or kill ad spend per store, and whether there is cash to keep spending.

## Product Purpose

Replace switching between about ten tabs: Meta Ads Manager ×3 (one ad account per brand), Shopify admin ×3, vFulfill, three payment gateways (Razorpay on all three stores, PayU on Kaiven, Cashfree on Oorvia), and the bank. One screen, all three stores, with a store switcher (All VXP · Oorvia · Kaiven · Selnova).

Priority, set by the user 2026-11-18:
1. **Meta**: ROAS against a computed breakeven per store, spend, CPA, CPM, CTR, winning and losing campaigns, ad account restricted or ads stopped.
2. **Shopify**: orders and sales, COD vs prepaid, products, live order stream across all three stores.
3. **vFulfill**: mostly behind the scenes. Delivered, RTO, NDR, fees, wallet and COD remittance feed real profit and cash; no large panel of its own.
4. **Cash**: settlements due per gateway, vFulfill wallet, COD due, bank balance (typed in).
5. **GST**: one GSTIN covers all three stores. Combined liability this month and the due date.

Out of scope: reviews, Meta comments/DMs, abandoned checkouts.

Success: Vedaant stops opening Ads Manager and Shopify admin to answer "how are we doing today", and trusts the profit number enough to act on it.

## Positioning

Built for Indian COD economics, which Shopify and Meta dashboards ignore. Profit only exists at delivery. RTO orders earn ₹0 and cost shipping both ways. COD cash arrives days after delivery while Meta bills now. So every money figure is one of two labelled layers:
- **Booked**: live, from Shopify and Meta, projected with an expected delivery rate.
- **Realised**: from vFulfill delivered/RTO data, days later.

Breakeven ROAS is computed per store from real costs, never typed in.

## Operating Context

- Laptop first: the main session is on a laptop. The phone must still work for quick checks of the top numbers and the order stream.
- Checked several times a day during ad-testing periods, mostly for Meta, then Shopify.
- vFulfill data arrives by CSV import, not live; staleness must be visible.
- Separate from the user's personal finance app ("Money"), and must never be visually confused with it. Only one number flows across: Vedaant's 50% profit share.

## Capabilities and Constraints

- INR with Indian digit grouping (₹1,75,491). Large figures may abbreviate (₹1.75L) with the exact value on hover.
- Every number shows its source and period (e.g. `SPEND · 7D · META`), and on hover its formula.
- Gain/loss and over/under carry a sign, label or icon, never colour alone.
- A number whose inputs are stale or assumed says so (e.g. "assumed from Oorvia" for a new store's delivery rate).
- Kaiven and Selnova have days of history; Oorvia has data from March 2026 onward.
- First build uses mock data shaped like the real data; every mocked number is tagged with its future source.

## Brand Commitments

- Store names: Oorvia, Kaiven, Selnova. Business name: VXP Ventures (internal only; not shown on storefronts, but fine in this private tool).
- Visual direction set by the user: its own identity, built on a reference screenshot (dark dashboard with neon-gradient hero numbers, ROAS gauge with breakeven marker, COD/prepaid order dot grid, sentence-style insight cards, cumulative revenue-vs-spend chart, live order stream). Shares no design tokens with "Money".

## Evidence on Hand

- Real Oorvia monthly P&L, March–August 2026: `../phase0/pnl-2026-*.json` (e.g. April: 108 orders placed, ₹1,75,491 order value; August: ₹1,76,070 net revenue, ₹61,776 ad spend).
- Reference screenshot from the user (single-store dashboard, 18–19 Oct).
- Plan and metric list: `../PLAN-vxp-command-center.md`.
- No real Kaiven or Selnova numbers yet; mock them plausibly and label them mock.

## Product Principles

1. Decide, don't display: every top-level number maps to scale, hold, kill or protect cash.
2. Booked vs realised, always labelled.
3. Source on every number. Trust beats density.
4. One screen for three stores; switching stores never means switching apps.
5. Staleness is shown, never hidden.
