---
name: VXP Command Center
description: India at Night. A dark Liquid Glass profit cockpit for three stores, lit by sodium-gold city light.
colors:
  ground: "#060a13"
  raised: "#121c2e"
  raised-2: "#1a2740"
  line: "rgb(150 180 225 / 0.12)"
  line-strong: "rgb(150 180 225 / 0.22)"
  ink: "#eef2f8"
  ink-2: "#b4bfcf"
  ink-3: "#8a96a8"
  good: "#4fd08a"
  bad: "#ff6b5e"
  warn: "#f2b24a"
  revenue: "#6fb6ff"
  spend: "#ff8a4c"
  oorvia: "#e3a33a"
  kaiven: "#9d8cff"
  selnova: "#ef6aa0"
  cod: "#f2b24a"
  prepaid: "#6fb6ff"
  sodium: "#f2b24a"
typography:
  verdict:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.5rem, 2.2vw, 2.1rem)"
    fontWeight: 800
    lineHeight: 1.12
    letterSpacing: "-0.025em"
  hero-figure:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "2.6rem"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "-0.035em"
  store-name:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.6rem"
    fontWeight: 700
    letterSpacing: "-0.02em"
  figure:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.3rem"
    fontWeight: 700
    lineHeight: 1.25
  panel-title:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 700
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
  control:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: "1rem"
    letterSpacing: "0.08em"
rounded:
  panel: "20px"
  row: "14px"
  pill: "12px"
  segment: "9.6px"
  chip: "8px"
spacing:
  base: "4px"
  inset: "20px"
  row-inset: "8px"
  row-pad-x: "12px"
  heading-gap: "12px"
  panel-gap: "12px"
  row-gap: "6px"
components:
  glass-panel:
    backgroundColor: "rgb(40 62 100 / 0.30)"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "16px 20px"
  glass-row:
    backgroundColor: "rgb(80 115 170 / 0.20)"
    textColor: "{colors.ink}"
    rounded: "{rounded.row}"
    padding: "12px"
    height: "72px"
  glass-pill:
    backgroundColor: "rgb(10 16 30 / 0.35)"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.pill}"
    padding: "3px"
  glass-pill-on:
    backgroundColor: "rgb(120 160 220 / 0.32)"
    textColor: "{colors.ink}"
    rounded: "{rounded.segment}"
    height: "30px"
  call-chip-scale:
    textColor: "{colors.good}"
    rounded: "{rounded.chip}"
    width: "84px"
  call-chip-cut:
    textColor: "{colors.bad}"
    rounded: "{rounded.chip}"
    width: "84px"
---

# Design System: VXP Command Center

Not "Money" (the user's personal finance app). The two share no tokens and this must never be mistaken for it. Product principles live in `PRODUCT.md`; the Home surface brief is `.impeccable/surfaces/src-app-page-tsx.md`.

## Overview

**Creative North Star: "India at Night"**

Binding (user, 2026-11-20): dark colours and Apple-style Liquid Glass. A blue-black night ground, dark blue-smoke glass panels with edge lensing and a thin specular rim, and sodium-gold city light. Ice-blue is prepaid and revenue, orange is spend, gold is COD, green is gain, red is loss, always with a sign or a word. Inter with tabular figures. The approved comp (`.impeccable/mocks/home-d.png`) is now only a reference; the built page is the direction.

Home is the pattern for the rest of the app: a verdict strip leads, store rows give each store a call, a live map of India shows orders landing, a chart and a footer strip close it. Every number states its period and source in the label style (for example "SPEND · 7D · META").

**Key Characteristics:**
- Dark only (`color-scheme: dark`). One night ground, glass panels on it, lighter glass rows on the panels.
- Colour carries meaning only. Status is never colour alone.
- Spacing is the most important system on the page (see Layout).
- One motion moment: a new order landing.

## Colors

One blue-black ground, one cool ink ramp, and a small set of meaning colours. Hex and rgb values in the frontmatter are normative.

### Neutral
- **Night Ground** (`ground`): page background and the colour the backdrop fades to. The WebGL shader hardcodes the same value (6, 10, 19).
- **Raised, Raised 2** (`raised`, `raised-2`): solid surfaces for the sparse places glass is not used.
- **Ink, Ink 2, Ink 3** (`ink`, `ink-2`, `ink-3`): primary text, secondary text, labels and placeholders.
- **Line, Line Strong** (`line`, `line-strong`): hairlines (verdict dividers, list dividers, chip rings), translucent blue-grey.

### Meaning
- **Gain Green** (`good`): gain, above target, Scale, healthy sources. Positive profit shows "+".
- **Loss Red** (`bad`): loss, below breakeven, Cut or fix, the breakeven tick.
- **Warn Amber** (`warn`): missing cost, stale vFulfill (with an icon), warnings.
- **Ice Blue** (`revenue`, `prepaid`): revenue series, prepaid orders, covering-costs zone, Hold chip, focus ring, selection tint.
- **Spend Orange** (`spend`): ad spend series only.
- **Sodium Gold** (`cod`, `sodium`): COD orders and map light.
- **Store dots** (`oorvia`, `kaiven`, `selnova`): small dots beside a store name, nothing else.

### Named Rules
**The Zero Rule.** Zero is neither gain nor loss: ₹0 renders in `ink-2` with no sign. Only a value above 0 is green with "+", only below 0 is red with "−".
**The Never-Alone Rule.** Green and red always travel with a sign, word, icon or tick shape. Chips carry a word; calls carry an icon and a screen-reader word.
**The Gold Share Rule.** `cod`, `sodium` and `warn` are the same hex. COD and a warning never share a component without a label.

## Typography

**Family:** Inter (next/font, weights 400 to 800), falling back to ui-sans-serif, system-ui. Document-wide `font-feature-settings: "tnum" 1, "lnum" 1, "cv11" 1`, so every figure is tabular and lining.

**Character:** a plain grotesque. Weight and size carry hierarchy; there is no second family.

### Hierarchy
- **Verdict** (800, clamp(1.5rem, 2.2vw, 2.1rem), 1.12, -0.025em): the computed sentence, once per page.
- **Hero figure** (800, 2.6rem, 1, -0.035em): projected profit and resolved delivered count in the verdict strip.
- **Store name** (700, 1.6rem, -0.02em): store rows and the VXP total.
- **Figure** (700, 1.3rem): row cells (spend, orders, ROAS, revenue, profit).
- **Panel title** (700, 1.125rem): panel headings.
- **Body / control** (400 / 500, 1rem / 0.875rem): body text; tabs, segments, buttons.
- **Sub-line** (400, 0.75rem or 0.6875rem, `ink-2` or `ink-3`): "7D · Meta" under a column head, "x% COD" under orders, the ROAS key.
- **Label** (600, 0.6875rem, 0.08em, uppercase, `ink-3`): metric, period, source.

### Named Rules
**The Period-and-Source Rule.** Every number is labelled with its period and source: `Projected profit · 7D · All stores`, `Resolved · 7D · vFulfill`, column heads such as "Spend / 7D · Meta". Estimates say "Estimate".

## Layout

Home is a single column up to `lg`, then a 2fr / 1fr grid: stores, Needs your call and the chart on the left; the map with Latest orders on the right. Page max width 1536px, page padding 12px (16px from `sm`), top bar and content separated by 12px.

Spacing is a 4px-base system and the single most important part of this design.

- **Panel gap:** 12px, between every panel, vertical and horizontal.
- **Panel content inset:** content starts 20px from a panel's edge horizontally. Panels with their own padding (verdict, chart, top bar) use `px-5`. List panels (stores, Needs your call, map with Latest orders, footer) use `p-2` (8px) and inset rows by 8px, and rows pad 12px horizontally (`px-3`): 8 + 12 = 20.
- **Heading to content:** 12px (`mt-3`) in every panel.
- **Row gap:** 6px between rows in a list.
- **One control height per row:** top bar segmented pills are 30px inside a 36px group (3px padding); freshness chips, "Sync now" and "Sign out" are 26px.
- **Store rows:** minimum 72px from `md`. Cells share one first baseline: primary figures sit on one line, sub-lines hang below. Column headers are single-line (`whitespace-nowrap`) with a source sub-line.
- **Call chips:** one width (min 5.25rem), so the column aligns.
- **Left column stretches** to end level with the map column; the revenue chart grows to fill the remaining height (min plot 128px).

Responsive: store rows become a two-column card grid below `md` (name and call, ROAS full width, spend and orders, revenue and profit). The footer goes three-up from `md`; source captions appear from `xl`. See Components > Top bar for phone behaviour.

## Elevation & Depth

Depth is optical, not shadowed. A fixed canvas behind the page paints the night, and every `.glass` panel is frosted glass over it: dark blue smoke, edge lensing, a thin specular rim and a pointer sheen. Rows and pills are lighter panes laid on a panel, with only a faint inset highlight and a short drop.

### Glass vocabulary
- **Glass panel** (20px radius): vertical smoke gradient (`rgb(40 62 100 / 0.30)` to `rgb(12 20 38 / 0.46)`), 12px backdrop blur at 180% saturation in the CSS fallback, a 1px gradient rim brightest at top-left (white 0.55 to blue 0.30), inset top highlight `rgb(255 255 255 / 0.28)`, a caustic along the bottom, and `0 24px 50px -20px rgb(0 0 0 / 0.75)` ambient.
- **Glass row** (14px): lighter blue pane (`rgb(80 115 170 / 0.20)` to `rgb(30 50 85 / 0.22)`), same rim at lower strength. Links lift on hover (160ms, ease-out).
- **Glass pill** (12px): recessed (`rgb(10 16 30 / 0.35)`, inset shadow). **Pill on**: raised, lighter gradient, with a drop.
- **WebGL glass:** `LiquidGlass` draws the night and, under each `.glass`, the same light seen through thick glass: frosted in the middle, bent and colour-split in a 34px rim (max displacement 54px), tinted toward blue smoke, with a pointer sheen. It adds `gl-glass` to `<html>`; CSS then removes the panels' `backdrop-filter`, the sheen and the `.night` image. Without WebGL2 the CSS blur is the fallback. Phones use a denser tint (0.42 / 0.58) and 10px blur.
- **Backdrop:** the haze fades to the blue-black ground; only bright cities stay, as soft gold points. A blue glow sits at the top-left.

### Named Rules
**The One Light Rule.** Light comes from the top-left: rims, highlights and the page glow all agree. Never glow a panel in a status colour.
**The Glass Is for Panels Rule.** Only `.glass` panels get lensing. Rows, pills and chips never nest a second lens.

## Shapes

Generous, consistent radii by role: panels 20px, rows 14px, pills and the focus ring 12px or 10px, segments inside pills 9.6px, call chips 8px, ticks and bars fully round. Rims are 1px gradient strokes, not borders. Dots are circles.

## Components

### Top bar
A glass panel: wordmark ("VXP"; the "Command Center" subtitle only from 1360px), tabs (Home, Ads, Orders, Money; icons only on phones), store switcher (All VXP, Oorvia, Kaiven, Selnova with a store dot), period segments. Second row: freshness chips and the controls. Segments are 30px in a 36px recessed pill; the current one is the raised pill. Tabs and periods scroll horizontally if cramped. On phones the switcher and chip row scroll horizontally with an edge fade, and a stale chip moves first.
- **Freshness chips** (Shopify, Meta, vFulfill, 26px): a dot or icon plus source and age. Shopify "live" is green. vFulfill older than 2 days (or never imported) turns amber with a warning icon and a screen-reader "(stale)".
- **Sync now** (26px pill) and **Sign out** (26px, text only). "Mock data" is an amber outlined tag.

### Verdict strip
Glass panel: the computed verdict left; projected profit with its delta (arrow, sign, percent) and resolved delivered / RTO counts right, divided by hairlines. A missing-cost note shows in amber under the verdict.

### Store rows
One glass row per store plus a VXP total row. Name (links to the store view), spend, orders with COD share, ROAS bar, booked revenue, estimated profit, call chip.
- **ROAS bar:** fill coloured by zone: below breakeven red, covering costs blue, above target green. Breakeven tick red, target tick green, each with a thin dark edge so it stays visible on a same-coloured fill. The labels are a key under the bar, BE at the left edge and Target at the right edge, each with a matching mini tick; never centred on the ticks (they collided).
- **Target** = (ex-GST breakeven + 1.5) x 1.18, on Meta's GST-inclusive scale.
- **Call chip** (min 5.25rem, ringed, tinted): Scale (green), Hold (blue), Cut or fix (red), Add cost (amber), No ads / No data (neutral).

### Needs your call
Glass rows, worst first: icon (trend-down red, alert amber, trend-up green), bold title, ink-2 detail, chevron when it links to a store. Empty: "Nothing needs you today."

### Live map
India as an SVG outline (blue glow, dotted land, 55%-opacity rim). One dot per place, sized by order count (9px to 26px), blue prepaid, gold COD, grey unknown; districts map to points (`cities.ts`). It replaced a rejected night-photo map with labelled pins. A new order pops in with two rings and a label (store, city, value, payment) for about 7 seconds, and its row slides into Latest orders. It polls `/api/orders/live` every 20 seconds while the tab is visible. Latest orders shows the newest four as glass rows (payment dot, store and city, product, value, payment, age).

### Revenue chart
Cumulative booked revenue (blue, with a soft fill) against cumulative ad spend (orange), one scale, no dual axis. Hairline gridlines, value tags at the line ends, a dashed crosshair and a glass tooltip. Under 480px wide the ticks shorten (₹60k, ₹1.2L), the end tags go, and the legend carries the end values.

### Footer strip
Three glass cells: Cash (links to Money), GST (month, amount, due date), Your share (50%). Each states period and source from `xl`.

### Focus and inputs
Focus ring: 2px `revenue`, 3px offset. Selection: `revenue` at 40%. Caret: `revenue`. Placeholder: `ink-3`. Scrollbars are thin and translucent blue-grey; swipe rows hide theirs.

## Motion

One moment: a new order landing. Ease is exponential ease-out, `cubic-bezier(0.16, 1, 0.3, 1)`. Dot pop 600ms, rings 1.6s twice, label 7s, Latest orders row slide 600ms. Transform and opacity only. Everything animated sits inside `prefers-reduced-motion: no-preference`. No bounce or elastic easing. The only other movement is a one-time 700ms rise (8px, staggered by `--delay`) as the top panels first load.

## Performance notes

- The map's glow is a CSS blur, and each map layer has its own GPU layer; the old SVG filter caused lag. Dots and labels are HTML so their animation never repaints the outline.
- The WebGL glass draws on scroll, resize, pointer and layout changes, never on a loop. Device pixel ratio capped at 1.5, low-power GPU hint, up to 16 panels per frame.
- With the GPU glass on, CSS backdrop filters, the sheen and the fallback night image are switched off so nothing is paid for twice.

## Do's and Don'ts

### Do:
- **Do** keep content 20px from a panel's edge horizontally, 12px heading to content, 12px between panels.
- **Do** keep one control height per row (30px segments in a 36px group; 26px chips and buttons).
- **Do** label every number with period and source.
- **Do** pair green and red with a sign, word, icon or tick shape.
- **Do** keep all motion on transform and opacity, with the expo ease-out.

### Don't:
- **Don't** reuse any token from "Money", or make this look like it.
- **Don't** treat ₹0 as a gain or a loss.
- **Don't** put labels centred on the ROAS ticks, or make the two ticks the same colour.
- **Don't** nest a lensed panel inside another, or glow a panel in a status colour.
- **Don't** add bounce easing, or a second animated moment.

## Not yet

Ads, Orders and Money are not yet redesigned; they only pick up the colour tokens.
