# Command Center data list: Home and store view

Status: **decisions settled, 2026-11-18. Awaiting sign-off.** Once signed off, this is the backend spec. The backend must produce
every number below, from the named source, by the named formula. The formulas already run in
`src/lib/metrics.ts` and `src/lib/calculator.ts` against mock data. The backend replaces `src/lib/mock.ts`
and nothing else: same shapes as `src/lib/types.ts` (`OrderDay`, `CampaignDay`, `ResolvedDay`, plus their hourly forms).

Settled decisions behind this list: `../../PLAN-vxp-command-center.md` §7b and §8.

---

## Decisions (all settled 2026-11-18)

| # | Question | Recommendation | Why it matters |
|---|---|---|---|
| D1 ✅ | Which Shopify orders count? | **Settled:** every order placed, minus cancelled (`cancelledAt` set) and test orders. Old Cash OS counted paid + fulfilled only. Ignore the `WGMN_Order_Cancelled` tag: of 20 Oorvia orders carrying it, only 10 are cancelled in Shopify and 11 shipped. | A COD order is unpaid until delivery and unfulfilled for a day. The old filter would hide today's orders from a live screen. |
| D2 ✅ | Where do a campaign's orders come from? | **Settled: Shopify orders are the true count** (Meta misses orders behind ad and script blockers). **Verified 2026-11-18:** the Fastrr checkout writes the click's details onto every order as `customAttributes`. One of them, `landing_page_url`, carries `campaign_id`, `ad_id` and the `/products/{handle}` path. So each order gives its campaign, ad and SKU. Read `campaign_id` from that URL, falling back to `utm_id`. Don't read `utm_medium`: on some ads it says "paid". An order with no campaign ID counts for its SKU but no campaign. | A SKU can have several campaigns, so the SKU alone can't say which one sold the order. The ID is in the link, so blockers don't strip it. |
| D3 ✅ | Which orders feed the delivery rate? | **Settled: several windows.** Proposed: count shipments by the date they **closed** (delivered or RTO). Show three windows per SKU: last 7 days, last 30 days, lifetime. The profit estimate uses the 30-day rate. | Counting by close date doesn't overstate the rate: a recent order's delivery and its RTO are each counted only once they happen. 7 days shows a sudden RTO jump; lifetime is the long-run rate. |
| D4 ✅ | What is "realised so far"? | **Dropped 2026-11-18.** The store page shows only profit (est.). Actual profit, from delivered orders and real vFulfill charges, lives in Money's monthly P&L (old Cash OS `/api/pnl` logic). | The work is in the backend (actual charges per order) for a number checked about once a month. |
| D5 ✅ | Customer city and state | **Verified 2026-11-18:** the Shopify API returns city, state and PIN code on orders from all three stores. It needs `read_orders` plus access to protected customer data (addresses), which the backend's own app must request. GST takes the state from Shopify, falling back to the vFulfill shipments export's `Customer state`. | GST's place of supply is the state. Old Cash OS's n8n relay got no province, most likely because its app lacked that access. |

---

## Conventions

- **Money:** integer paise in the database, ₹ with Indian grouping on screen.
- **Time:** IST. A day runs 00:00 to 23:59 IST.
- **Revenue is GST-inclusive**: what the customer pays, Shopify `current_total_price`.
- **Spend is Meta's reported spend, ex-GST.** The 18% GST Meta charges is claimed back as ITC, so it isn't a cost.
- **Periods and comparisons:**

  | Period | Comparison |
  |---|---|
  | Today | Yesterday up to the same hour |
  | 7D | The previous 7 days |
  | 30D | The previous 30 days |
  | Month (to date) | The same days of last month |

- **Product = (store, SKU).** Two stores may use the same SKU; lookups, rates and caches always key on both.
- **Order → SKU:** an order belongs to the SKU of its highest-value line item, and its whole value counts there. Its **costs cover every line item**: each unit's COGS at the cost effective on the order date (`cogs_history`), and shipping slabs from the whole order's packed weight. A 2-unit order pays for 2 units.
- **Order → store:** the Shopify store whose webhook sent it.
- **Spend → store:** the ad account it was spent in.
- **Spend → SKU:** the campaign's SKU (below).
- **Orders → campaign:** the `campaign_id` in the order's `landing_page_url` (D2). Orders without one count for their SKU but no campaign.
- **Small samples:** a rate needs **30** orders behind it (`MIN_SAMPLE`). Below that it falls back one level: SKU → store → VXP → Pricing Master sheet default. The screen names the level it used.

---

## 1. Inputs the backend stores

| Input | Source | Fields used | Refresh |
|---|---|---|---|
| Stores | Typed in once | name, Shopify domain, order prefix, Meta ad account ID, gateway fee %, live since, owner split | By hand |
| Products | Shopify products API, plus a manual field | sku, store, name, price (COD list, incl. GST), handle, packed weight; **stage** (manual: Testing / Live / Out of stock / Failed) | On product update |
| COGS | `cogs_history`, time-versioned, **ex-GST** (Shopify "cost per item") | store, sku, cogs, effective from/to. Past orders take the cost on their order date; breakeven takes today's | When cost changes |
| Orders | Shopify webhooks `orders/create` and `orders/updated`, per store, with HMAC check | name, store, placed at, `current_total_price`, payment type (gateway → `cod` / `prepaid`), line items (sku, qty, price), cancelled at, test flag, city and state (D5), `customAttributes.landing_page_url` (campaign ID, D2) | Instant |
| Ad spend | Meta Insights API, each ad account, **campaign × day**; **campaign × hour** for today and yesterday. Stored per campaign, never pre-split by SKU | spend, impressions, `inline_link_clicks`, purchases; plus **attributed orders**: count of Shopify orders carrying that `campaign_id` | Once a day (cron) + **Sync now** button |
| Campaign → SKU | The landing URL of the campaign's ads: `/products/{handle}` → product with that handle in that store | campaign ID, SKU | When a new campaign appears |
| Shipment status | vFulfill shipments CSV, stored as daily counts per SKU × payment type by `Closed On` (`ResolvedDay`) | order name, Shipment Status, Closed On | Import, twice a week |
| vFulfill charges, wallet, COD due | vFulfill transaction CSV (existing importer) | per-order fees, wallet balance, COD remittances due | Import, twice a week |
| Gateway settlements due | Razorpay, PayU and Cashfree APIs | amount captured but not yet settled, per gateway × store | Hourly |
| Bank balance | Typed in | amount, entered at | By hand |
| Fixed costs | `fixed_costs` | monthly equivalent | By hand |
| Sync runs | Every sync writes one row | source, store, finished at, ok/failed | Each sync |

**Every ad lands on a product page** (Vedaant: no homepage or collection ads). Mapping can still break if a
product's handle changes or a new product isn't synced yet. That spend stays on the store, the store page
shows a warning to check the handle, and the backend never guesses the SKU.

---

## 2. Derived numbers, per SKU

| Number | Formula | Window | Fallback below 30 |
|---|---|---|---|
| Delivery rate, COD | delivered ÷ (delivered + RTO), COD orders only | Shipments closed in the last 30 days (D3); 7-day and lifetime shown beside it | store → VXP → 90% |
| Delivery rate, prepaid | Same, prepaid orders only | Same | store → VXP → 90% |
| COD share | COD orders ÷ all orders | Last 30 days | store → VXP → 70% |
| Breakeven CPA | Pricing Master formula (`blendedBreakeven`) using the SKU's price, COGS and weight, the store's gateway fee, the SKU's COD share and both delivery rates. Other fees come from the sheet's Assumptions tab | — | — |
| Breakeven ROAS | Average price paid ÷ breakeven CPA. This is Meta's scale, because revenue includes GST | — | — |
| Target ROAS | (breakeven ROAS ÷ 1.18 + 1.5) × 1.18 | — | — |
| Store breakeven | Each SKU's breakeven CPA and average price paid, weighted by that SKU's orders in the last 30 days | Last 30 days | Equal weights if no orders |
| Profit before ads, for a set of orders | For each product × payment type: orders × breakeven CPA, using that group's actual average price paid, its delivery rate, and its **own** costs per order (COGS of every line item at order date, average shipping slabs). `profitBeforeAds` | The orders in view | — |
| Profit (est.) | Profit before ads − spend | The period | — |

Shipping and vFulfill fees in the estimate come from the sheet's rate card, not actual charges. Actual
charges feed only Money's monthly P&L (D4).

Shipment statuses map like this: Delivered → delivered; Returned, RTO In-Transit and Lost → RTO; NDR and
In Transit → still open. Payment type always comes from Shopify, never from vFulfill's column.

---

## 3. Home (All VXP)

| # | On screen | Formula | Source |
|---|---|---|---|
| H1 | **Revenue** + change % | Σ order value in the period, vs the comparison period | Shopify |
| H2 | **Ad spend** + change % (grey, neither good nor bad) | Σ spend across all ad accounts | Meta |
| H3 | Orders | Count of orders (D1) | Shopify |
| H4 | Blended ROAS | H1 ÷ H2. Includes organic orders | Derived |
| H5 | Profit (est.) | Σ over stores of profit (est.) | Derived, §2 |
| H6 | Verdict sentence | Each store that spent: profit (est.) ≥ 0 → "paying for itself", else "isn't" | Derived |
| H7 | Borrowed-rates note | Stores where any SKU's delivery rate uses VXP or the sheet | Derived, §2 |
| H8 | Needs your call (0–3 cards) | Rules in §5 | Derived |
| H9 | Pace chart | Cumulative revenue and cumulative spend per hour (Today) or per day; dashed line for the comparison period's cumulative revenue; a profit panel below with a zero line | Shopify + Meta |
| H10 | Latest orders (5) | Newest 5 across stores: store, city (D5), product, value, COD/Prepaid, minutes ago | Shopify |
| H11 | Store scoreboard | Per store: spend, orders, COD %, ROAS on a bar with breakeven and target ticks, zone word, revenue, profit (est.). Sorted by profit. VXP total row. Zone: below breakeven / covering costs / above target | Derived |
| H12 | Cash + "covers N days" | bank + settlements due + vFulfill wallet + COD due. Days = cash ÷ average daily spend over the last 7 full days | Bank, gateways, vFulfill, Meta |
| H13 | GST this month + due date | Output tax − input credit, month to date (old Cash OS `/api/gst` logic). Due on the 20th of next month (GSTR-3B) | Derived |
| H14 | Your share (50%) this month | (Month profit (est.) − monthly fixed costs × days elapsed ÷ days in month) × owner split | Derived + `fixed_costs` |

## 4. Store view (one store selected)

| # | On screen | Formula | Source |
|---|---|---|---|
| S1 | Product line | Each SKU with orders or spend in the period: name, price, stage tag. "Store live since" | Products |
| S2 | **Revenue**, **Ad spend** + change % | As H1 and H2, this store only | Shopify, Meta |
| S3 | Orders · profit (est.) | As H3 and H5. A warning appears only if some spend's handle matches no product | Derived |
| S4 | ROAS gauge | ROAS = revenue ÷ spend, against store breakeven and target. Shows zone and "X short of target". With no spend: a "No ads ran" card with organic orders and the breakeven | Derived |
| S5 | CPA | Spend ÷ Shopify orders (organic included), with the breakeven CPA under it | Derived |
| S6 | CPM + change % | Spend ÷ impressions × 1000. Going up is shown as bad | Meta |
| S7 | CTR | Link clicks ÷ impressions, with the link-click count | Meta |
| S8 | Pace chart | As H9, this store only | Shopify + Meta |
| S9 | Campaigns | Each campaign that spent: name, its own spend, its attributed Shopify orders (D2), CPA = spend ÷ attributed orders. Flagged red when CPA is above its SKU's breakeven CPA, or when it has **0 orders and has spent more than one breakeven CPA** ("₹X spent, no orders") | Meta + Shopify |
| S10 | Order dots | One dot per order, coloured COD or prepaid, first 120, plus counts | Shopify |
| S11 | Per SKU: COD share; delivered COD and delivered prepaid | §2. The headline rate is the 30-day one, with its basis ("62 closed orders", "VXP average · under 30 yet"). The 7-day and lifetime rates sit under it, for reading only: they show the SKU's own figure, or "under 30 closed", and never borrow another level's | Derived |

## 5. "Needs your call" rules

At most 3, worst first: bad, then warn, then good. Nothing showing is a valid answer.

| Rule | Fires when | Tone |
|---|---|---|
| Below breakeven | All 3 previous full days have data, spend > 0, and their combined ROAS < the store's breakeven ROAS | bad |
| Cash low | Cash covers fewer than 10 days of spend | bad |
| CPM up | Period CPM > comparison CPM × 1.2 | warn |
| vFulfill stale | Last shipments import more than 3 days old | warn |
| Above target | Period ROAS ≥ target ROAS and at least 10 orders | good |

## 6. Header

| On screen | Formula | Source |
|---|---|---|
| "Synced N min ago" + **Sync now** button | Time since the last successful Meta sync; the button runs the Meta sync on demand. The hover shows Meta, Shopify (last webhook) and vFulfill (last import) separately | `sync_runs` |
| Mock data badge | Removed once the backend is live | — |
