---
name: VXP Command Center
description: Lime. A matte charcoal profit cockpit for three stores (and more), with one luminous lime used as a solid fill where it matters.
colors:
  ground: "#08090a"
  panel: "#121416"
  raised: "#181b1e"
  raised-2: "#22262a"
  line: "#1e2124"
  line-strong: "#2a2e33"
  ink: "#eceef0"
  ink-2: "#aeb3b9"
  ink-3: "#8b9097"
  ink-4: "#7e838a"
  lime: "#b8f23a"
  on-lime: "#0b0c0d"
  good: "#b8f23a"
  bad: "#ff5a4e"
  warn: "#f2b24a"
  revenue: "#b8f23a"
  spend: "#c3c7cc"
  prepaid: "#b8f23a"
  cod: "#eceef0"
  map-dots: "#2c3035"
typography:
  verdict:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.6rem, 2.5vw, 2.4rem)"
    fontWeight: 700
    lineHeight: 1.12
    letterSpacing: "-0.035em"
  hero-figure:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2.5rem, 3.4vw, 3.25rem)"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.04em"
  overview-figure:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.03em"
  store-name:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.3rem"
    fontWeight: 600
    letterSpacing: "-0.015em"
  panel-title:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: "1rem"
    letterSpacing: "0.1em"
rounded:
  panel: "16px"
  tray: "12px"
  pill: "11px"
  segment: "9.6px"
  chip: "8px"
  square: "3px"
spacing:
  base: "4px"
  panel-gap: "12px"
  tray-gap: "10px"
  panel-pad: "10px"
components:
  panel:
    backgroundColor: "{colors.panel}"
    border: "1px {colors.line}"
    rounded: "{rounded.panel}"
  tray:
    backgroundColor: "{colors.raised}"
    border: "1px #23272b"
    rounded: "{rounded.tray}"
  pill-on:
    backgroundColor: "{colors.raised-2}"
  pill-lime:
    backgroundColor: "{colors.lime}"
    textColor: "{colors.on-lime}"
---

# Design System: VXP Command Center

Not "Money" (the user's personal finance app). The two share no tokens and this must never be mistaken for it. Product principles live in `PRODUCT.md`.

## Overview

**North Star: "Lime"** (chosen by the user 2026-11-27 from their own references; it replaced "India at Night", the Liquid Glass look, and the WebGL glass and city-light backdrop that went with it).

Matte, not glass. A flat near-black ground, charcoal panels with a 1px edge, slightly lighter trays inside them, and no blur, shine or glow anywhere. One luminous lime (#b8f23a) is the only accent, and it is loudest as a **solid fill with black text**: the verdict block, the tab you are on, Sync now, the cell arrows, a Scale call, the revenue end tag. Everything else is greys.

Home's layout is unchanged from India at Night (overview strip, verdict strip, stores, Needs your call, chart, map with Latest orders, footer). The signature interaction is the **linked highlight** (below).

## Colors

- **Neutrals:** `ground` page, `panel` panels, `raised` trays, `raised-2` selected pills and icon tiles, `line` / `line-strong` edges and rules, `ink` → `ink-4` text from primary to faint.
- **Lime** (`lime`, also `good`, `revenue`, `prepaid`): the accent, gain (always with "+"), the revenue line, prepaid orders.
- **Loss red** (`bad`): loss (with "−"), Cut or fix, the breakeven tick.
- **Warn amber** (`warn`): stale data, missing costs, with an icon.
- **COD white** (`cod`): COD orders. Prepaid is lime because it is money already in hand (user, 2026-11-27).
- **Spend** (`spend`): a quiet light grey, dashed in charts.
- Store colours (`oorvia`, `kaiven`, `selnova`) are no longer used on Home or in the store switcher: the dots repeated the name. Ads, Orders and Settings still show them until those tabs are redone.

**The Zero Rule** and **the Never-Alone Rule** still hold: ₹0 is neither gain nor loss, and lime/red always travel with a sign, word, icon or tick.

## Surfaces

- **Panel** (`.glass`, name kept so every tab follows): `panel` fill, 1px `line`, 16px radius.
- **Tray** (`.glass-row`): `raised` fill, 1px #23272b, 12px radius; hover brightens the edge. Trays sit 10px apart inside a panel with 10px padding.
- **Pill** (`.glass-pill`): #0c0d0f, 1px `line`. Selected segment `.glass-pill-on` is `raised-2`; the current tab is `.pill-lime`.
- **Hatch** (`.hatch`): diagonal stripes for "nothing here" (No ads running).
- Background: flat `ground` with a faint lime haze along the bottom edge. Nothing else.

## Components (Home)

- **Overview strip:** one panel, four trays (revenue, orders, AOV, ad spend). Label with period and source, a lime arrow link to the tab behind it, the figure, the change in a small tinted chip, and a **square-cell column chart** (`SquareBars`): one column of stacked 5px squares per bucket, merged to at most 30 columns; revenue lime, the rest grey.
- **Verdict strip:** the verdict on a solid lime block in black, a sentence about a store not paying its way reversed (lime on black). Projected profit and Resolved sit in trays beside it.
- **Store rows:** trays, no store dot. ROAS on a segmented track with three zones: track faintly red below breakeven, white from breakeven to target, lime past target; the fill and figure take the zone's colour (red also when the store lost money this period). Breakeven tick red, target tick lime. Calls: Scale solid lime, Hold grey, Cut or fix red-tinted, Add cost amber, No ads outlined.
- **Needs your call:** trays with a tinted icon tile.
- **Revenue chart:** cumulative revenue (lime, faint fill) against cumulative spend (grey, dashed). End tags: revenue solid lime, spend grey.
- **Live map:** India as a field of grey dots; orders as small squares, prepaid lime, COD white, sized by count. A new order pops with a square ring and a solid tag.
- **Footer:** three trays (cash, GST, partner share) with icon tiles.

## Linked highlight

Hover anything that belongs to a store (its row, its map squares, its orders, its calls, its sentence in the verdict) and that store is traced across Home; everything else drops to about 20%. Click or tap a store row or a map square to pin it; the × in the Stores header or Esc releases it. While traced:

- the overview shows the store's own figures, its share of VXP and its own columns;
- the profit tray shows the store's estimated profit "of" VXP's;
- the store's row gets a lime edge and the switcher outlines its name;
- the chart greys VXP's lines and draws the store's revenue band and spend line;
- the map rings the store's squares and fades the rest.

Built in `LinkedHighlight.tsx`: server parts opt in with `data-s`, `data-hl-for` and `data-peek`; the map and chart read `useHighlight()`. A 140ms grace on leaving stops the page flashing back between rows.

## Motion

Ease-out expo, transform and opacity only, all inside `prefers-reduced-motion: no-preference`: the new-order pop (600ms), ring (1.6s ×2), tag (7s), row slide (600ms); the first-load rise (700ms); highlight fades (220ms). No bounce.

## Do's and Don'ts

- **Do** keep lime for solid fills and meaning; never as a glow, gradient or decoration.
- **Do** keep every number labelled with its period and source.
- **Don't** bring back blur, glass, shine or a picture behind the panels.
- **Don't** colour stores; the name is the identity.
- **Don't** reuse any token from "Money".

## Not yet

Ads, Orders and Money pick up the colours and matte panels but are not redesigned: they still show store dots and their own chip styles.
