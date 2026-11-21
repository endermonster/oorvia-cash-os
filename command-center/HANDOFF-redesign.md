# Handoff: Command Center Home redesign (2026-11-20)

Branch `v2`, nothing committed yet. All changes are in the working tree (`git status`).

**Next design agent: read `HANDOFF-next-tabs.md` first.** The other tabs wait until the backend is finished (decided 2026-11-21).

## Where it stands

The Home tab (`/`) has been rebuilt in a new look: **India at Night**, dark plus Liquid Glass, both pinned by the user.

| Piece | State |
|---|---|
| Layout (verdict strip, store rows with Scale/Hold/Cut call chips, Needs your call, revenue-vs-spend chart, map + latest orders, cash/GST/share footer) | Built, typecheck and lint clean, 423 tests passed before the last batch |
| GPU liquid glass (`LiquidGlass.tsx`) | Built, renders. **Speed not yet confirmed by the user** |
| Live 2D map (`LiveMap.tsx`) | Built, renders, demo orders pop in mock mode. Real-data polling untested |
| Production build | **Not run.** It was started and stopped mid-run |
| Ads / Orders / Money tabs | Not redesigned. They pick up the new colour tokens only |
| DESIGN.md | Stale: it still describes the old preview. Rewrite it once the look is accepted |

## Update 2026-11-21

- Build, typecheck, lint, tests all pass. Glass speed confirmed "fast"; bottom-of-page lag fixed (map glow moved from SVG filter to CSS blur, map layers on their own GPU layer) and confirmed "smooth".
- Live map tested on real data: polling works, `/api/orders/live` 401s without a session. `cities.ts` now maps districts (Shopify often stores the district) and normalises messy names: 56 of the newest 60 orders get a dot (was ~28).
- Polish: verdict one line at 1280–1536 (real data), top bar one row at 1280, phone top bar 272 → 178 px, "1 day ago".
- Spacing system on Home: every panel's content starts 20 px in; list panels inset rows 8 px, rows pad 12 px; heading → content 12 px; one control height per row; store rows 72 px; call chips one width; chart fills so both columns end level. ROAS ticks: BE red, Target green, with a key under the bar (not labels on the ticks).
- First viewport: re-scored 58% (mock data). **User accepted it by eye and said the comp is only a reference now** (built page is the direction, including the live map and spacing). The impeccable tool refused the force-advance three times on its wording check, so the `hero` phase stays open in `state.json`; the decision is recorded there as notes. Don't re-litigate it.
- Finish review (fresh reviewer, degraded procedure): disposition `fix`. Fixed: blue-black ground + bluer glass (shader), store rows share one baseline + single-line headers, ₹0 shown neutral, "vs ₹0 previous", phone chart full width with values in the legend, phone scroll rows fade at the edge, stale vFulfill chip goes first on phones. Declined by user: footer in first viewport.
- **Open decision, parked by the user:** which breakeven drives the ROAS bar, call chip and Needs your call (Oorvia shows "Hold" and "−₹1,035 below breakeven" at once). Written up with options A/B/C: https://claude.ai/artifact/QXcEZARuw66kNPYHQwaTqb
- DESIGN.md rewritten from the built page (Sonnet agent) + new sidecar `.impeccable/design.json`. Small code gaps it found, not yet fixed: the projected-profit headline shows no "+" and renders ₹0 in `ink` (rule: `ink-2`); "Your share" ignores the sign rule; tabs and period groups lack the phone edge fade; map colours are hardcoded hexes outside the tokens.
- Still open: verdict wraps to 2 lines with *mock* numbers at 1536 (the "+22% vs previous 7 days" delta widens the profit column). Next: finish review, then rewrite DESIGN.md, then carry the world to Ads/Orders/Money.
- Screenshot tooling: `capture.mjs` (scratchpad, CDP over Node's WebSocket) against a debug Chrome on port 9333 with its own profile; the user signs in once per profile.

## Update 2026-11-21 (later session)

- Codex review of the working tree: 4 × P2, all fixed. LiveMap: each poll replaces the list (edited/cancelled orders correct themselves); arrival labels open toward the wider side, are capped to that room and truncate the city (the `map-tag` keyframes animated `translate`, which overrode Tailwind's side offset, now `transform`). LiquidGlass: a disposed flag + cancelled follow loop so a late texture load can't reattach the canvas. Stores table: container query on the table, not the viewport: stacked below 50rem, compact figures 50–60rem (1280–1440 screens), full size from 60rem; money columns have real minimums. Verified with `measure.mjs` (scratchpad) at 375/1024/1100/1280/1366/1536/1920.
- Breakeven decision (doc linked above, "Decision" section): store rows stay on product breakeven; "loss this period" under a negative profit; a losing store is always in Needs your call (`<id>-loss`); VXP (total) row has its own bar: revenue-weighted store breakevens + prorated fixed costs (`portfolio().total.breakeven`, `Data.fixedCostsRunRate` from `pnl.monthlyRunRate`). `fixedCostsMonthly` is untouched, so "Your share" is still off.
- **Done 2026-11-22 (backend):** quarterly frequency added; the subscription is a quarterly fixed cost and the run rate counts a third a month. Original note: vFulfill is now a QUARTERLY fee (was monthly). `cc_fixed_costs` has it as one-time rows for Jun–Aug and nothing after, and `FixedCost.frequency` has no quarterly value. `pnl.monthlyRunRate` counts only `monthly` rows, so the VXP breakeven leaves vFulfill out until that is modelled.
- Home visual gaps from the DESIGN.md pass, closed: projected-profit headline and "Your share" follow the sign rule (+/green, −/red, ₹0 ink-2); map colours are tokens (`--color-map-*` in globals.css, applied via `style` so Safari resolves `var()` in SVG); VXP bar goes grey ("Incomplete: X has no cost") when a store with sales has no cost (Codex). Tabs/period groups need no phone fade: they fit at 390 and 430 px (only Store overflows, and it fades). Skipped by Vedaant: chart clipping at 320 px (no tiny phones in use). Left as is: the 1536 verdict wrap happens with mock numbers only; real data fits on one line.
- Measuring gotcha: the debug Chrome (port 9333, profile in the 2ced57b6… scratchpad) is visible and Vedaant may be using it; scripts open their own tab via `/json/new` and close it.

## User decisions on record

- Full creative control over the front end. Dark plus Apple-style Liquid Glass is binding (PRODUCT.md, Brand Commitments).
- Direction **India at Night**, layout **D** ("decision first"). Approved comp: `.impeccable/mocks/home-d.png`.
- The first map (a photo with 4 pins) was rejected as redundant. They want a 2D map of India where live orders pop up as a coloured dot. Done; awaiting their check.
- They called the first glass version "really slow". That version used SVG `backdrop-filter: url()` filters, which Chrome renders on the CPU every frame, plus a `background-attachment: fixed` sheen. It was replaced with a single WebGL shader (below). **The first thing to do is have the user confirm the speed.**
- Kaiven's chip reads "Hold" rather than the comp's "Scale" because 3.67× is above breakeven but below target. "Realised ₹" became "Resolved: N delivered · N RTO", because no realised-profit metric exists. Both were flagged; the user did not object.

## Files

New:
- `src/components/LiquidGlass.tsx`: a fixed WebGL2 canvas behind the page. It paints the night backdrop and, under every `.glass` element, frosted glass with a refracting, colour-split rim and a pointer sheen. It draws only on scroll, resize, pointer or layout changes, never on a loop. When it runs it adds `gl-glass` to `<html>`, and CSS then turns off the panels' backdrop-filter. Without WebGL2 the CSS blur fallback applies.
- `src/components/LiveMap.tsx`: India as an SVG outline, one dot per city sized by order count and coloured by payment. New orders pop with rings, a label for about 7 s, and slide into the list. It polls `/api/orders/live` every 20 s while the tab is visible. In mock mode a demo order arrives every 6.5 s.
- `src/app/api/orders/live/route.ts`: the newest 60 orders. Session-checked (`allowedUser`); mock data unless `DATA_SOURCE=supabase`.
- `src/lib/india-map.ts`: generated. India's outline (datameet/maps `india-composite.geojson`, Survey of India boundaries), projected and simplified to about 35 KB. Generator: scratchpad `make-india.cjs` (not in the repo).
- `src/lib/cities.ts`: city name to lon/lat (about 130 cities) to map coordinates. An unknown city gets no dot; the page notes "N without a known city".
- `src/components/RevenueChart.tsx`: single-panel cumulative revenue vs spend chart with end labels and hover.
- `assets/plates/map.png`: a generated night-lights image of India, with its prompt embedded. Now used only as the glass backdrop texture.

Changed:
- `src/app/globals.css`: night palette tokens (same token names as before), `.glass`, `.glass-row`, `.glass-pill`, `.night` backdrop, map animations, `.gl-glass` overrides.
- `src/app/layout.tsx`: Inter instead of Manrope; `.night` backdrop image; mounts `<LiquidGlass />`.
- `src/components/Home.tsx`: full rewrite. It keeps the exported `verdict`, `missingCosts` and `laterParts`, which tests use. `HomeView` now takes `now` and `mock`.
- `src/components/TopBar.tsx`: two-row glass bar with freshness chips (Shopify / Meta / vFulfill, stale over 2 days).
- `src/app/page.tsx`: passes `now` and `mock` to HomeView.
- `src/lib/metrics.ts`: added `resolvedCounts(storeIds, period)` (vFulfill delivered/RTO counts, no money).
- `src/lib/load.ts`: `RECENT_LIMIT` 20 → 60; added `loadRecentOrders()`; `mapRecentOrder` takes `Pick<Product,'storeId'|'sku'|'name'>[]`.
- `PRODUCT.md`: refreshed (live backend, Cash OS being replaced, dark + Liquid Glass pinned).

Removed: `src/components/IndiaMap.tsx`. `PaceChart.tsx` stays because StoreView and tests use it.

## Next steps, in order

1. `cd command-center && npx tsc --noEmit && npx vitest run && npx next build`. Fix anything that fails. The build had never completed with these changes.
2. Run `DATA_SOURCE=mock npx next dev -p 3100`, open `localhost:3100` in your normal Chrome (you're already signed in on localhost), and ask the user to judge the speed with the window in front. If it's still slow:
   - cap the shader at DPR 1;
   - drop the dispersion samples, which take 3 of the 4 texture reads per pixel;
   - or keep the glass only on the top bar.
   Check frame times with the Performance panel in the user's real Chrome: headless numbers don't reflect GPU cost.
3. Test the live map against real data (`DATA_SOURCE=supabase`). Check that `cc_orders.city` values match the names in `cities.ts`, and add missing cities.
4. Polish left on Home:
   - the verdict wraps to 2 lines at 1536 px (the comp has 1);
   - the phone top bar is tall (about 230 px).
5. Finish the impeccable flow (`.impeccable/build/state.json`, phase `hero`):
   - the hero gate scored 67% (target 72%) before the user's glass/map changes;
   - the user has not formally accepted the first viewport;
   - after acceptance: independent finish review, then rewrite DESIGN.md from the built world.
6. Carry the world to Ads, Orders and Money.
7. Commit (the user asks for commits explicitly). Per the user's CLAUDE.md, code written by Opus should be reviewed with `/codex:review`.

## Gotchas

- Login gate: every page needs a session. For automated screenshots, a Chrome launched with `--remote-debugging-port` plus its own `--user-data-dir` needs the user to sign in once. Copied profiles lose the session (app-bound cookie encryption).
- Chrome throttles timers and requestAnimationFrame in windows hidden behind others, so measuring there gives false slowness and demo orders arrive late.
- Turbopack (via the `@tailwindcss/turbopack` loader) can keep serving an old `globals.css` after an edit, even across dev-server restarts. Fix: stop the server, delete `.next/dev`, start again. `.tsx` edits are not affected.
- Only one `next dev` may run per folder (Next 16). Stopping the background shell leaves the node process on the port; kill it by port.
- The impeccable decision and review pages (`serve-question`) closed unanswered twice. The AskUserQuestion fallback worked.
