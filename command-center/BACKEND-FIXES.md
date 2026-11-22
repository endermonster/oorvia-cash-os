# Backend fixes from the site critique (2026-11-22)

For the backend agent. These came from a full-site critique of command.vxpventures.com
(`.impeccable/critique/2026-11-22T09-09-40Z__command-vxpventures-com.md`). The front end was fixed separately; these
are logic, data and wiring, which Vedaant assigned to you. Values are as seen live on 2026-11-22. Most important first.

## 1. VXP profit leaves out fixed costs (P0)
- **Where:** `src/lib/metrics.ts:432`, `portfolio().total.contribution = stores.reduce(… x.contribution)`.
- **Problem:** Home's VXP row and hero show Profit (est.) **+₹2,292** (7D). Fixed costs (₹4,298 for 7D, from
  `fixedCostsIn(p)`) go into the VXP *breakeven* only (`metrics.ts:457`), never the profit. Net is about −₹2,006 (7D),
  −₹11,770 (Month, ₹14,062 fixed) and −₹16,978 (30D). That's why a red "Below breakeven" sits beside a green +₹2,292.
- **Fix:** add `fixedCosts` and `net` (`contribution − fixedCostsIn(p)`) to `Portfolio['total']`, or subtract it in
  `contribution` and keep a `beforeFixed` field. Same for `prevContribution`.
- **Front end now:** labels the VXP and hero profit "before ₹X fixed costs", read from `total.breakeven.fixedCosts`. That is
  `null` when a period has spend but no costed sales, so the label disappears exactly when the profit still excludes
  overhead (Codex review). Expose `total.fixedCosts` always, independent of the breakeven. Once `net` exists, tell the
  front end so it can show net as the headline.

## 2. Breakeven uses the pricing-sheet default delivery rate when real history exists (P1)
- **Where:** the store economics / delivery-rate fallback (`borrowedRates`, store view "Pricing sheet default · no history yet").
- **Problem:** Oorvia's store view assumes COD 70% share and **90.0%** COD delivery. The Delivery rate table on the same
  page shows Oorvia all-time COD **77.3%** (595 closed). Kaiven's real COD share is 90% (18 of 20) against the assumed 70%.
  Using 90% understates breakeven, so Oorvia's "2.32× vs 2.32×" is probably below breakeven.
- **Fix:** fall back in this order: store 30D → store all-time → VXP all-time → pricing-sheet default. Expose which one was
  used, so all three pages can say the same thing. Today Home says "on VXP delivery rates until 30 resolve", the store
  view says "Pricing sheet default", and the Ads footnote says "the last 30 days' delivery rates".

## 3. Freshness chips mislead (P1)
- **Shopify chip** (`src/lib/load.ts:156`, `oldestLatest(SHOPIFY_SOURCES, …)`): shows "2 days ago" because quiet Selnova
  sets the age, while the newest order is 3 h old. Don't fix this by taking the newest webhook across stores or skipping
  quiet stores: either lets a broken feed hide behind a healthy or quiet one (Codex review; keep `load.test.ts:163–168`).
  Add a per-store sync heartbeat (e.g. a periodic Shopify API check or backfill that records "checked at" per store) and
  age the chip from that.
- **vFulfill chip** (`load.ts:157`): green "2 days old" from *import* time, but the last shipments export was empty.
  Every Resolved figure is 0 and all 26 November orders read "Not shipped" (some from 17 Nov). Base staleness on the newest
  shipment date in the data (or flag an import that added 0 shipments), so the chip turns amber.
- **Knock-on copy, needs a staleness flag from you:**
  - Money Cash: "COD due ₹0 · Every delivered COD order is remitted" (`CashCard.tsx:26`) is true only because nothing
    counts as delivered.
  - Orders: `not_shipped` for orders newer than the last shipments data should be "No shipment data", not "Not shipped".

## 4. Ads stopping is never called (P1)
- **Where:** `calls()` in `src/lib/metrics.ts:504`.
- **Problem:** spend went 20 Nov ₹5,354 → 21 Nov ₹28 → 22 Nov ₹0. Kaiven's only campaign is paused. Home still leads with
  "Kaiven is paying for itself" and Needs your call says nothing. PRODUCT.md lists "ads stopped" under Meta priority #1.
- **Fix:** add a call when a store with spend in the previous days drops to ~₹0, or its campaigns are all paused/restricted.

## 5. Home footer GST and Your share are hard-coded empty (P2)
- **Where:** `src/lib/load.ts:321`, `gst: null, fixedCostsMonthly: null`.
- **Problem:** Home shows "GST: On Money →" and "Your share: On Money →", while Money has GST **₹305** (Nov) and your 50%
  share **−₹12,521**.
- **Fix:** load both into the Home data. `HomeView` already renders them when present (`Home.tsx` `BottomLine`).

## Also seen (lower priority)
- **Fixed costs, two methods:** Home spreads the quarterly vFulfill fee as a run rate (₹14,062 for November), while the
  Money P&L books it all in October (−₹46,352) and shows −₹1,694 for November. Pick one, or label both.
- **Period switch looks dead:** 7D, 30D and Month return identical store figures, and "vs ₹0 previous 7 days" shows,
  because activity starts 17 Nov. Probably genuine. Confirm, and if so expose "no activity before 17 Nov" so the front end
  can say it.
- **Today period:** Meta syncs daily, so Today always shows ₹0 spend and "No ads ran in this period" (profit +₹642 on one
  order). Expose "spend not synced yet for today".
- **Store view breakeven CPA:** "breakeven ₹1,066 per order" is per *unit* (Ads says "BE ₹1,066 / unit"). Oorvia's
  average order is ₹3,699, so CPA ₹1,595 reads as 50% over while ROAS sits at breakeven.
- **Map period:** "Orders across India" under 7D shows the newest 60 orders (13 Aug–22 Nov), not the period's 26.
- **Money P&L note:** "3 orders counted delivered because vFulfill remitted…" doesn't say which month they're in, while
  Sep–Nov revenue all read "—".
