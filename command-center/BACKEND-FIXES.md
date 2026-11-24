# Backend fixes from the site critique (2026-11-22)

## Status 2026-11-24: front end wired for 1, 2, 3, 3b, 4, 5

Home headline and VXP row show `total.net` ("after ₹X fixed costs at run rate"); footer reads `getHomeData()` ("Source: monthly P&L");
one rate note (`rateSourceNote` in `components/bits.tsx`) on Home, the Ads footnote and the store view (labels show the window);
one freshness rule (`vfState` in `bits.tsx`, honours `vfulfillOverdueOrders` and missing stores) for the TopBar chip, GstCard,
CashCard and Orders; Orders rows read "No shipment data" from `noShipmentData`; Home's verdict leads with a Meta ads stop.

## Status 2026-11-22: backend done for 1, 2, 3 (vFulfill part), 4, 5 — front end must wire

The backend now exposes the fields below. Nothing on screen changes until a component reads them (the user chose
"backend only + handoff"). Not done yet: the Shopify heartbeat (3, parked: the user wants a free trigger) and the
"Also seen" list.

| # | Read this | Instead of / to show |
|---|---|---|
| 1 | `portfolio(p).total.net`, `.prevNet`, `.fixedCosts` (always set, 0 when none), `.prevFixedCosts`, `.fixedOnRecord` | Headline VXP profit = `net`. Label "before ₹X fixed costs" now reads `total.fixedCosts`, not `total.breakeven.fixedCosts`. `contribution` is unchanged (before fixed costs). |
| 2 | `Rate.window` (`'7d' \| '30d' \| 'lifetime' \| null`) on `deliveryRate()` / `codShare()`; `m.rateSources(storeIds?, period?)` → `{ store, source: 'own-30d' \| 'own-lifetime' \| 'vxp' \| 'sheet' }[]` | Fallback is now SKU → store (30D) → store all-time → VXP all-time → sheet. `StoreView.basisNote` must say the window (a `store` basis can now be all-time while the label says "· 30D"). Home's "on VXP delivery rates", the store view's note and the Ads footnote should all come from `rateSources`. For COD share, "all-time" = the 70 days the snapshot loads. |
| 3 | `d.sync.vfulfillDataDaysAgo`, `d.sync.shipmentsThrough` (newest closed shipment, YYYY-MM-DD) | vFulfill chip (`TopBar.tsx`) and `GstCard`'s warning should age from the worse of `vfulfillImportDaysAgo` and `vfulfillDataDaysAgo`. Needs-your-call already does. |
| 3 | `OrderView.noShipmentData` (status stays `not_shipped`) | Orders: show "No shipment data" instead of "Not shipped" when true. Per store (2026-11-24): a store with no shipment rows (Kaiven, Selnova today) flags every unshipped order. |
| 3 | `d.sync.vfulfillMissingStores` (2026-11-24) | Stores left unticked in vFulfill's export. `vfulfillDataDaysAgo` already counts them; Needs your call names them (`vf-stale`). The /settings upload report also warns ("no kaiven shipments in this file…"). TopBar's vFulfill chip could name them. |
| 3 | `d.sync.vfulfillDataDaysAgo` | Money `CashCard.tsx:26` "Every delivered COD order is remitted": only say it when the shipments data is fresh; otherwise say the data runs to `shipmentsThrough`. |
| 4 | `calls()` now emits `${id}-ads-stopped` (tone `warn`) | No wiring needed; it shows in Needs your call. The spend-drop rule needs `d.sync.metaYesterdayVerified[store]` (the Meta run matched yesterday's campaign spend to the account total); "all paused" needs no ACTIVE campaign. Home's hero sentence ("Kaiven is paying for itself") should not lead when that call is present. |
| 4b | 2026-11-24, "Needs your call lists only decisions not yet made" | A user-set status (PAUSED, CAMPAIGN_PAUSED, ADSET_PAUSED, ARCHIVED, DELETED) is never a call: `-ads-stopped` fires only for Meta stops (DISAPPROVED, WITH_ISSUES, PENDING_BILLING_INFO) or a verified drop in campaigns still live. `-loss` / `-below` are skipped when every campaign that spent in the period is user-paused, none is ACTIVE and nothing spent yesterday; the loss still shows on the store row. Campaign-level status only: a pause at ad-set or ad level is not seen. |
| 3b | `d.sync.vfulfillOverdueOrders` (2026-11-24) | Orders vFulfill should have shipped (stores with vFulfill history, real, uncancelled, placed after `shipmentsThrough` and > 3 days ago, no shipment row). 0 = data current: `vfulfillDataDaysAgo` is null and `vf-stale` stays quiet however old the newest shipment or import. Stores that have never shipped (Kaiven, Selnova today) are never flagged: no upload warning, orders keep "Not shipped". |
| 3c | `d.sync.vfulfillOpenShipments` (2026-11-24) | Shipments still open in the last export, for orders placed in the last 60 days at stores with vFulfill history (older open rows are stuck: 5 Oorvia rows from May 2026 still read In Transit). The data is current only when this AND `vfulfillOverdueOrders` are 0; `vfulfillDataDaysAgo` and `vf-stale` follow the same rule. |
| 4c | `m.adsStopped(storeIds?)` → `StoreId[]` (2026-11-24) | Stores whose ads stopped, same rule as `${id}-ads-stopped`, without the three-call cap of `calls()`. Home's headline should read this, not search `calls()`. |
| 5 | `getHomeData()` (src/lib/data.ts) | `src/app/page.tsx`: swap `getData()` for `getHomeData()`. Then `m.gst()` (= Money's GST headline, `owed` = GSTR-3B cash) and `m.ownerShare()` (= Money's P&L "Your 50% share" for this month) are filled and `BottomLine` renders them. Footer source label for the share should say "monthly P&L", not "profit model". |

Fixed costs, two methods ("Also seen"): kept both on purpose. Period profit (7D/30D/Month on Home) spreads fixed costs as
a run rate; the monthly P&L books them when billed. Home's "Your share" now comes from the P&L, so it matches Money.
Label the Home net "fixed costs at run rate".

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

## 6. Ad account funds and COD share (2026-11-24, built)
| Read this | What it is |
|---|---|
| `d.sync.adAccountFunds[]`: `{ storeId, accountId, name, prepay, accountStatus, remaining (₹ \| null), dailySpend, todaySpend, runwayDays (\| null), active, level ('ok' \| 'low' \| 'out'), watched, checkedAt }` | One row per allowlisted ad account, from the 2-hourly funds check (`/api/cron/meta-funds`, table `cc_ad_account_funds`). `remaining` = spend cap − amount spent; null = no cap (Oorvia-2). |
| `calls()` → `${storeId}-funds-out` (bad), `${storeId}-funds-low` (warn) | Fires only for `watched` accounts with a read under 6 hours old: the account has an ACTIVE campaign (a billing problem without one needs spend in the last 7 days or today). Low = under ₹1,000 left (Vedaant, 2026-11-24), not days of runway; out = ₹0 or a status that stops delivery. The words match the ntfy push (`fundsMessage` in `src/lib/meta/funds-level.ts`). A card-funded account (`prepay` false) says "near/hit its spending limit … Raise the limit in Billing" instead of "Add funds". Replaces the old "out of funds" follow-up. A store whose watched account is out, with no other account holding an ACTIVE campaign, is also in `m.adsStopped()`, so the Home verdict leads with "ads stopped". |
| `m.codShare(storeId, sku)` → `{ value: number \| null, basis: 'sku', n, window: '30d' \| 'lifetime' \| null, orders }` | Always the product's own COD ÷ known-payment orders (Vedaant: every product has its own share): 30 days, else the 70-day snapshot. No sheet default, no store or VXP borrowing, no minimum sample. StoreView shows it per product, beside that product's delivery rates. When there are no known-payment orders, `value` is null and `n` is 0: StoreView shows "—" and "No orders in 70 days", or "No known payment type yet" when `orders` > 0. Breakeven then uses the worse of all-COD and all-prepaid and carries `worstCase: true` (also on the store blend), and `noBreakevenText` says "at the worst-case COD/prepaid mix". |

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
