# Handoff: carrying the Home look to Ads, Orders, Money (written 2026-11-21, updated 2026-11-22)

For the next design agent. Read this before touching any tab other than Home.

## Start here: the backend is done (2026-11-22)

Phase 7 (porting old Cash OS) is finished on the backend: Ads (7b), Orders (7a), Settings (7c-1), GST and
capital & loans (7c-2), Forecast (7d). Every number on every tab is real now, so the wait in §0 is over. Still ask
Vedaant which tab to start with (§3 suggests an order) and confirm nothing changed since this note.

**Design work waiting, most useful first:**

1. **Gear icon for `/settings` in the top bar.** Full request in `REDESIGN-REVIEW-FINDINGS.md` ("Request: a gear
   icon"). `TopBar` needs a way to render with no tab selected (store and period switches mean nothing on Settings).
   Once it's in, remove the "Settings: bank, vFulfill, costs, GST, loans" link beside the Money heading.
2. **Ads tab** in the Home look (`src/app/ads/page.tsx`, `AdsParts.tsx`). Reuse `Bar` from `Home.tsx` for ROAS
   against breakeven and target.
3. **Orders tab** (`src/app/orders/page.tsx`, `OrdersParts.tsx`).
4. **Money tab**: the most changed. Five panels now, all flat `bg-raised` cards:
   - `CashCard.tsx`: cash on hand, per store or All VXP.
   - `CapitalCard` (`MoneyParts.tsx`): loans owed with days overdue, partner capital. VXP-wide.
   - `GstCard` (`MoneyParts.tsx`): one GSTIN, VXP-wide. A hero cash figure, then one block per unfiled month plus
     the month in progress (output tax, input credit, credit ledger, RCM), with GSTR-1 / 3B due dates that turn
     amber at 3 days and red when late.
   - `PnlTable.tsx`: monthly P&L, per store or All VXP.
   - `ForecastCard` (`MoneyParts.tsx`): running total from Day 1 (opens at Oorvia's pre-GST −₹1,40,108), average
     finished month, profit needed a month (6/12/24), month table. **Wants a chart**: the old Cash OS Forecast page
     had a cumulative line with a zero line, red below and green above, and a dashed projection to break-even
     (`oorvia-cash-os/app/(dashboard)/forecast/page.js`, `CumulativeChart`). Data is in `Forecast.rows`
     (`month`, `net`, `cumulative`, `partial`), `opening`, `breakEven`. No projection line while the average loses
     money (decided 2026-11-22).
5. **Store view** (`StoreView.tsx`), to match Home.
6. **Settings** (`src/app/settings/page.tsx`): long forms and tables (bank, vFulfill upload, products, fixed costs,
   GST, capital & loans). Lowest priority; it works as is.

Open redesign findings 1–8 are in `REDESIGN-REVIEW-FINDINGS.md` (Vedaant chose to skip #8).

## 0. Don't start until the backend for that tab is done

Vedaant decided (2026-11-21) that the backend is finished first, and the remaining tabs are designed after. A tab's
layout depends on the numbers it will hold, and `DATA-LIST.md` only fixes the data for Home and the store view. Before
you design a tab:

1. Ask Vedaant whether that tab's backend is complete, and what it now provides.
2. Read what the backend agent changed for it (its handoff notes, `DATA-LIST.md`, `src/lib/*-load.ts`).
3. If the data still looks unsettled, say so and stop. Don't design around guessed numbers.

## 1. Your job, and how Vedaant works

- **Only how it looks:** layout, type, spacing, colour, motion, the glass. Data, DB rows, fixed costs and loaders
  belong to the backend agent. If you find a data gap, leave a one-line note for them in `HANDOFF-redesign.md` and
  move on. Don't offer to fix data.
- **Devices:** Windows, a Mac, one or two modern iPhones (390–430 px). Nothing smaller. Design and check at about
  390/430 px and 1280–1920 px.
- **Verification to match the change:** a colour or wording change needs only typecheck and tests, with no
  multi-width screenshots. Layout changes do need checking at those widths.
- **Replies:** short, the next action first, numbered steps, and one concrete next step at the end. No recaps or
  pleasantries (ADHD mode is always on).
- **Reviews:** at a review point, start the Codex review yourself in the background. Don't ask, and don't tell him to
  run it:
  `node "C:/Users/Vedaant Priya/.claude/plugins/cache/openai-codex/codex/1.0.6/scripts/codex-companion.mjs" review --scope working-tree ""`
  from `oorvia-cash-os/`. When it returns, show the output verbatim, then a plain-language breakdown table
  (meaning, new or known, impact, fix and time) and a recommendation.
- **Commits:** only when he asks. "Commit" means commit and push. Branch `v2`. The Home redesign is committed (`bd8c310`).

## 2. The look you're carrying over

**India at Night**: dark, Apple-style Liquid Glass. Vedaant has locked this in (`PRODUCT.md`, Brand Commitments). The
system is written up in `DESIGN.md`, with `.impeccable/design.json` alongside. `.impeccable/mocks/home-d.png` is
only a reference: the built Home page is the direction now. Read `DESIGN.md` in full. The rules that matter most:

- **Surfaces:** `.glass` panels, `.glass-row` rows inside list panels, `.glass-pill` controls. `LiquidGlass.tsx`
  paints the backdrop and the frosted glass under every `.glass` with WebGL. New panels only need the class.
- **Spacing (Home):**
  - panel content starts 20 px in
  - list panels inset rows 8 px, and rows pad 12 px
  - 12 px from a heading to its content
  - one control height per row
  - store rows are 72 px tall
  - call chips are all one width
  - side-by-side columns end level
- **Money signs:** + and `good` for gains, − and `bad` for losses, ₹0 in `ink-2`. Use the `tone()` helper in
  `Home.tsx`, plus `Signed` from `bits.tsx`.
- **Figures:** 1.3rem bold. Labels use the `label` class with a small "period · source" line under each column
  header.
- **ROAS against breakeven:** the `Bar` component in `Home.tsx` (fill, red BE tick, green target tick, key underneath).
  The Ads tab should reuse it. Its campaigns are compared against each store's breakeven and target (see the `Later`
  list in `src/app/ads/page.tsx`).
- **Colours:** only tokens from `globals.css` (`--color-*`). The map has its own `--color-map-*`. No hardcoded hex
  values.

Lessons from building Home:

- **Use container queries for tables:** switch a table's layout on the panel's own width, not the screen width. The
  store table at [Home.tsx:90](src/components/Home.tsx#L90) stacks below 50rem, shrinks its figures at 50–60rem and
  goes full size from 60rem, and its money columns have real minimum widths. Tables sized from the screen width
  overlapped on 1024–1440 px screens.
- **In SVG, set colours through `style`, not attributes:** `style={{ fill: 'var(--color-…)' }}`. Safari (his
  iPhone) doesn't reliably resolve `var()` in `fill=` attributes.
- **Animations and Tailwind's `translate-*`:** both use the CSS `translate` property, and the animation wins. Animate
  `transform` instead.
- **Performance is settled:** no SVG `backdrop-filter: url()`, no `background-attachment: fixed`, no CSS blur on large
  areas each frame. Glows use CSS `filter: blur` on their own layer. Vedaant judged Home "fast" and "smooth", so don't
  make it slower.

## 3. Where each surface stands today

All four still use the old look: flat `bg-raised` cards and plain `h2` headings. They only pick up the new colours.

| Surface | File | What's on it now | Notes |
|---|---|---|---|
| Ads | `src/app/ads/page.tsx`, `src/components/AdsParts.tsx` | Stats row, per-store ads table, sortable campaigns table, daily table, month navigation | Real data only (mock shows a placeholder) |
| Orders | `src/app/orders/page.tsx`, `src/components/OrdersParts.tsx` | Stats row, filterable orders table, delivery-rates table, vFulfill import age | Real data only |
| Money | `src/app/money/page.tsx`, `CashCard.tsx`, `MoneyParts.tsx`, `PnlTable.tsx` | Cash, Capital & loans, GST, monthly P&L, Forecast | Real data only. Backend finished 2026-11-22 (see "Start here") |
| Settings | `src/app/settings/page.tsx`, `SettingsForm.tsx` | Forms and tables for everything typed in by hand | Not a tab; reached from Money until the gear exists |
| Store view | `src/components/StoreView.tsx` (Home with `?store=`) | ROAS semicircle gauge, campaigns, per-store detail | Not redesigned either; it should match Home |

Suggested order once the backend is ready: **Ads → Orders → Money → Store view**. Ads is where Vedaant makes spend
decisions. Confirm the order with him first.

## 4. Running and checking it

- **Dev server:** `cd command-center && DATA_SOURCE=supabase npx next dev -p 3100`. These tabs need `supabase`.
  Only one `next dev` can run per folder. Stopping the shell leaves node holding the port, so kill it by port:
  `netstat -ano | grep :3100`, then `taskkill //PID <pid> //F //T`.
- **Stale CSS:** Turbopack sometimes keeps serving an old `globals.css`, or misses new arbitrary classes, even after
  a restart. Stop the server, delete `.next/dev`, start again. If a new class "doesn't work", suspect this first.
- **Screenshots:** use a debug Chrome on port 9333 with its own signed-in profile. Last session's profile and scripts
  were in the scratchpad (`…/2ced57b6-…/scratchpad/cc-capture-profile`, `capture.mjs`; `…/7e59e8bb-…/scratchpad/measure.mjs`
  for overlap and overflow checks). Scratchpads can be wiped, so rebuild them if they're gone: CDP over Node's
  built-in WebSocket. That Chrome window is visible and Vedaant may be using it, so open your own tab
  (`PUT /json/new`) and close it when done. Never drive his tab.
- **Checks:** `npx tsc --noEmit && npx eslint src && npx vitest run` (about 515 tests pass as of 2026-11-22). Run them
  from `cd "/c/Users/..."` (capital C): from a lowercase `c:` path Vitest loads twice and every suite fails with
  "reading 'config'".

## 5. Open items that aren't yours

- ~~vFulfill quarterly fee left out of the VXP breakeven~~ Done 2026-11-22: fixed costs have a `quarterly` frequency,
  the subscription is one (₹42,372.89 ex-GST from 27 Oct), and `monthlyRunRate` counts a third of it a month.
- The vFulfill shipments export last imported was empty, so delivered/RTO and GST output tax lag until Vedaant imports
  a real one. Data, not design.

## 6. Decisions already made (don't reopen them)

- Breakeven (2026-11-21, recorded in the Decision section of https://claude.ai/artifact/QXcEZARuw66kNPYHQwaTqb):
  - Store rows use the product breakeven, and a losing period reads "loss this period".
  - A losing store is always listed in Needs your call.
  - VXP gets its own breakeven: store breakevens weighted by revenue, plus prorated fixed costs.
- The first viewport of Home is accepted as built.
- The footer stays outside the first viewport.
- Kaiven reads "Hold" (between breakeven and target).
- "Resolved: N delivered · N RTO" replaced realised profit.
