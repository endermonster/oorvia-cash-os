# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Delegated (2026-11-18): Next.js App Router + TypeScript + Tailwind CSS 4, deployed on Vercel, Supabase backend (live since 2026-11-19). `DATA_SOURCE=supabase` reads real data; anything else serves the in-memory mock behind the same data contract.

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
- Separate from the user's personal finance app ("Money"), and must never be visually confused with it. Only one number flows across: Vedaant's 50% profit share. Command Center's own "Money" tab keeps that name (confirmed 2026-11-20); the separation rule covers visual identity, not tab names.
- Replaces Cash OS (the parent Oorvia-only app in this repo, confirmed 2026-11-20). Cash OS is legacy and gets retired once Command Center covers Oorvia; new product work goes here, not there.
- Data arrival: Shopify live by HMAC-verified webhook plus a 60-day backfill; Meta once a day by Vercel Cron (00:30 UTC) plus a "Sync now" button; vFulfill shipments and transaction ledger by CSV import scripts; Oorvia history before the API window by Shopify CSV import; bank balance typed in by hand.

## Capabilities and Constraints

- INR with Indian digit grouping (₹1,75,491). Large figures may abbreviate (₹1.75L) with the exact value on hover.
- Every number shows its source and period (e.g. `SPEND · 7D · META`), and on hover its formula.
- Gain/loss and over/under carry a sign, label or icon, never colour alone.
- A number whose inputs are stale or assumed says so (e.g. "assumed from Oorvia" for a new store's delivery rate).
- Kaiven and Selnova have days of history; Oorvia has data from March 2026 onward.
- Single user behind a Supabase Auth login gate: a session counts only if its email is on the allowlist. No figures render, mock or real, without one.
- Payment type can be `unknown` for history Shopify cannot settle: counted as an order, left out of COD share and delivery rates, never guessed.
- Not connected yet: gateway settlements (Razorpay, PayU, Cashfree). The cash total leaves out unconnected parts and names them; no cash-low alert until a bank balance exists.
- Mock mode stays available; while it drives the screen, every mocked number is tagged with its source and the top bar shows "Mock data".

## Brand Commitments

- Store names: Oorvia, Kaiven, Selnova. Business name: VXP Ventures (internal only; not shown on storefronts, but fine in this private tool).
- Visual direction: the user gave full creative control over the front end on 2026-11-20; the old UI and DESIGN.md were a quick preview, not a commitment. Binding, set by the user 2026-11-27 (replacing the Liquid Glass look pinned on 2026-11-20): dark, matte charcoal panels with no glass, blur or glow, and one luminous lime accent used as solid fills ("Lime", see DESIGN.md), chosen from the user's own references; must hold up as more stores are added. Must share no design tokens with "Money" and cannot be mistaken for it. The earlier reference screenshot (ROAS gauge with breakeven marker, COD/prepaid order grid, sentence-style insights, cumulative revenue-vs-spend chart, live order stream) is a list of useful ideas, not a required look.

## Evidence on Hand

- Real Oorvia monthly P&L, March–August 2026: `../phase0/pnl-2026-*.json` (e.g. April: 108 orders placed, ₹1,75,491 order value; August: ₹1,76,070 net revenue, ₹61,776 ad spend).
- Reference screenshot from the user (single-store dashboard, 18–19 Oct).
- Plan and metric list: `../PLAN-vxp-command-center.md`.
- Live Supabase data: Meta campaign spend for the four allowlisted ad accounts (Kaiven, Oorvia-1, Oorvia-2, Selnova1) backfilled 2026-01-01 to 2026-11-19; Shopify orders and products for all three stores; Oorvia vFulfill shipments and ledger (wallet matches vFulfill to the paisa).
- Kaiven and Selnova still have only days of history; new-store delivery rates are assumed from Oorvia and must say so.

## Product Principles

1. Decide, don't display: every top-level number maps to scale, hold, kill or protect cash.
2. Booked vs realised, always labelled.
3. Source on every number. Trust beats density.
4. One screen for three stores; switching stores never means switching apps.
5. Staleness is shown, never hidden.
