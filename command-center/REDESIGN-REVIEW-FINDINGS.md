# Redesign review findings (2026-11-21)

For the agent that owns the Home redesign (`HANDOFF-redesign.md`). These came from four Codex reviews of the working
tree, run by the Phase 6–7 (cash, then porting) session on 2026-11-21. Codex reviews the whole tree, so it reviewed the
redesign's uncommitted files too. **None of these are fixed.** That session left them alone because the redesign is yours.

Line numbers are as of 2026-11-21; search by the quoted code if they've moved.

## Findings, most important first

### 1. Store rows overlap at 1024–1100 px (P2, raised in all three reviews)
- **Where:** `src/components/Home.tsx:84`, the `ROW` class (`md:grid-cols-[minmax(7.5rem,1.15fr)_…_5.75rem]`).
- **Problem:** at `lg` the page goes two-column (`Home.tsx:47`, `lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]`), leaving the Stores panel about 650 px. The row still uses seven columns from `md` up, so spend, revenue and profit get about 30–50 px each while their values render at 1.3rem. The figures overlap the next cell.
- **Fix:** keep the stacked two-column row layout until the panel itself is wide enough (container query, or switch at `xl` instead of `md`), or give the row a minimum width inside a horizontal scroller as the old table did.
- **Done when:** at 1024, 1100 and 1280 px wide, no figure in the Stores panel touches its neighbour.

### 2. Live map never updates or removes an order it has shown (P2, all three reviews)
- **Where:** `src/components/LiveMap.tsx:39-44` (`incoming.filter((o) => !seen.current.has(o.id))`, then `setOrders((prev) => [...added, ...prev])`).
- **Problem:** only unseen IDs reach state. When Shopify updates an order's value, payment type or city, or cancels it, the webhook updates `cc_orders` and `/api/orders/live` returns the corrected list, but the map keeps the old version forever. Cancelled orders stay on the map because the endpoint drops them but local state does not.
- **Fix:** treat each poll response as the truth. Replace the order list with the response (keeping the 80 cap), and use unseen IDs only to decide which dots animate in.
- **Done when:** a test feeds two snapshots where order A changes value and order B disappears, and the rendered list matches the second snapshot, with only genuinely new IDs marked fresh.

### 3. Long city labels push the page sideways on phones (P2, new in the third review)
- **Where:** `src/components/LiveMap.tsx:135-142`, the arrival labels.
- **Problem:** labels can't wrap and are placed only from the city's midpoint, with no clamping or clipping. A long name such as Thiruvananthapuram runs past the map edge and adds horizontal page scroll while the label shows.
- **Fix:** cap the label width, and clamp its position inside the map box (or flip it to the dot's left side near the right edge); `overflow: hidden` on the map container as a backstop.
- **Done when:** at 360 px wide, a demo arrival in Thiruvananthapuram causes no horizontal scroll.

### 4. Glass texture callback runs after cleanup (P2, new in the third review)
- **Where:** `src/components/LiquidGlass.tsx:173` (`img.onload = …`) and the cleanup at `:202`.
- **Problem:** if the effect cleans up before the texture loads (React Strict Mode's mount-unmount-mount in dev, or a hot reload), `onload` still fires. It re-appends the removed canvas, re-adds `gl-glass` to `<html>`, and starts rendering with no listeners attached, leaving orphaned WebGL canvases. Dev-only in practice, but it can also make the speed check misleading.
- **Fix:** in cleanup set `img.onload = null` (or a `disposed` flag that `onload` checks first).
- **Done when:** in `next dev`, after the page mounts and a hot reload, `document.querySelectorAll('canvas').length` is 1.

### 5. Home cash line can hide what's missing (P2, first review; now low impact)
- **Where:** `src/components/Home.tsx:248`, the ternary `c.bank && c.coversDays !== null ? 'covers N days…' : c.missing.length ? 'without …' : 'cash on hand'`.
- **Problem:** when the runway shows, `c.missing` is dropped, so a total that leaves out a source looks complete. The pre-redesign Home showed both.
- **Why it's lower now:** since `b2ec407`, gateway settlements are always read (estimated from Shopify), so in production `missing` is empty whenever a bank balance exists. It can still happen with mock data or if a source is added later.
- **Fix:** render the "without …" text alongside the runway, not instead of it.

### 6. Home's COD share counts unknown payments as prepaid (P2, fourth review, 2026-11-21)
- **Where:** `src/components/Home.tsx:117`, the COD share in the store rows.
- **Problem:** it divides COD orders by all orders. Unknown-payment orders (old history where the gateway was unrecognised) are counted as non-COD. Example: 10 COD, 10 prepaid, 80 unknown displays 10% COD instead of 50% of known payments.
- **Fix:** divide by `s.orders - s.unknownPayOrders`, and omit the percentage when no payment is known.

### 7. Revenue chart stays at its default width if it first mounts empty (P2, fourth review)
- **Where:** `src/components/RevenueChart.tsx:32-35`, the mount-only `ResizeObserver` effect.
- **Problem:** when the period has no points (Today before any order), the component renders its empty-state paragraph, so the effect finds no wrapper and never observes. When a period change or Sync brings points in, the plot keeps its 900 px default and clips in narrower panels.
- **Fix:** keep the observed wrapper mounted in both states, or re-run the effect when the empty/non-empty state changes.

### 8. Revenue chart clips its newest day on narrow phones (P2, fifth review, 2026-11-21)
- **Where:** `src/components/RevenueChart.tsx:36`, the `ResizeObserver` callback that clamps the width to at least 300 px.
- **Problem:** at a 320 px viewport, Home's padding leaves about 256 px for the chart, but the SVG is forced to 300 px. The latest point lands at x≈286, outside the parent's `overflow-hidden`, so the newest data point and the last date label are cut off.
- **Fix:** use the measured width as is (drop the 300 px floor), or draw into a fixed `viewBox` that scales to the container.
- **Done when:** at 320 px wide, today's point and the final date label are fully visible on Home.

## What changed under you (Phase 6, committed on `v2`)

- `95e16ce`, `b2ec407`, `f7664bf`. All are deployed to production from clean worktrees, so none of your files have gone out.
- **`src/lib/load.ts`:** the Phase 6 changes to `mapCash` and `readCash` are committed. `git diff` on this file now shows only your hunks (recent orders, `loadRecentOrders`). When you commit, nothing extra is needed.
- **`CashPosition`** (`src/lib/types.ts`):
  - `settlements` entries gained `orders`, and it's now an estimate from Shopify prepaid orders (`src/lib/settlements.ts`).
  - The new `codDueByStore` field holds COD due per store.
  - In production, `m.cash().missing` no longer lists "gateway settlements".
- **`src/components/CashCard.tsx`:** takes an optional `store` and shows store-only cash (COD due + settlements) in a store view. If you carry the new look to Money, keep that behaviour: bank and the vFulfill wallet count in All VXP only.
- **Phase 7 is building Ads, Orders and a new `/settings` page now** (decided by Vedaant 2026-11-21): working pages in today's components and colour tokens, which you restyle afterwards. Expect new files under `src/app/orders`, `src/app/ads`, `src/app/settings` and new components; coordinate before rewriting those pages wholesale.
- **`ViewState.keep`** (`src/lib/nav.ts`): a page can pass its own query (Orders passes month and filters) and `href()` adds it only to links to that same path. Your TopBar needs no change for this; keep building store links as `href(tabPath, { ...view, store })` so it keeps working.
- **Request: a gear icon for `/settings` in the top bar** (Vedaant, 2026-11-21; Phase 7c). `/settings` (bank balance, vFulfill CSV upload, product costs and stages, fixed costs) exists now, reached for the moment from a "Settings" link next to the Money heading. Please add a gear (lucide `Settings`) to `TopBar.tsx`, not a tab: tabs stay Home, Ads, Orders, Money. `TopBar` needs a `Tab`, so `/settings` currently passes `tab="money"`; give it a way to render with no tab selected (store and period switches mean nothing there and can hide). Once the gear is in, the Money link can go.
- **`next.config.ts`** gained `experimental.serverActions.bodySizeLimit: '4.5mb'` for the CSV upload (Phase 7c). Editing it restarts the dev server once.
- **Deploy rule:** production is deployed from a worktree of a commit (`git worktree add --detach`, copy `.vercel/project.json`, `npx vercel --prod --yes`). Never run `vercel --prod` from the working tree.
