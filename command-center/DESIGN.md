---
name: VXP Command Center
description: A quiet profit cockpit for three stores. One loud number, colour only where it means something.
colors:
  ground: "#0b0d10"
  raised: "#12151a"
  raised-2: "#171b21"
  line: "#1e232b"
  line-strong: "#2b323c"
  ink: "#eef1f4"
  ink-2: "#aab3be"
  ink-3: "#818a96"
  good: "#3ecf8e"
  bad: "#f0605a"
  warn: "#e0a32e"
  revenue: "#3987e5"
  spend: "#d95926"
  oorvia: "#c98500"
  kaiven: "#9085e9"
  selnova: "#d55181"
  cod: "#c98500"
  prepaid: "#3987e5"
typography:
  family: "Manrope (next/font, self-hosted), tabular + lining numerals everywhere"
  hero: "clamp(3.5rem, 8vw, 6rem) / 800 / -0.04em"
  gauge-number: "68px / 800 / -0.04em"
  stat: "2.25rem / 800"
  verdict: "1.5rem / 600"
  section-title: "1rem / 600"
  body: "1rem / 400"
  label: "0.75rem / 600 / 0.08em / uppercase / ink-3. Names metric · period · source."
---

# VXP Command Center: design system

Not "Money" (the personal finance app). The two apps share no tokens on purpose.

## Principles
- **One loud thing per screen.** Home: projected profit. Store view: the ROAS gauge. Everything else is visibly smaller.
- **A sentence before the numbers.** The verdict line ("Kaiven is paying for itself. Selnova isn't, yet.") is computed from data, never typed in.
- **Space, not boxes.** Sections split by spacing and a single 1px `line` rule. Panels (`raised`) only for "Needs your call" cards, the no-ads state and tooltips. No nested cards, no glow, no gradient text, no coloured side borders.
- **Colour carries meaning only.** `good` / `bad` / `warn` for status, always with an icon, sign or word. `revenue` / `spend` for chart series. Store colours only as small dots beside the store name.
- **Every number says its period and source** (`label` style). Estimates say "estimate"; assumed inputs say what they were assumed from.

## Components
- **Top bar:** wordmark, tabs (Home · Ads · Orders · Money, underline for current), store switcher (segmented, `raised`), period presets, sync dot, amber "Mock data" tag while mock data drives the screen.
- **Needs your call:** 0–3 facts, worst first. Icon tile tinted by tone. Empty: "Nothing needs you today."
- **Pace chart:** two stacked panels sharing dates. Top: cumulative booked revenue (`revenue`), ad spend (`spend`), previous period (dashed `ink-3`). Bottom: cumulative profit on its own scale with a zero line, green fill above and red below. Direct end labels, crosshair tooltip with "this day/hour" and "so far". Never a dual axis.
- **ROAS bar (scoreboard) and gauge (store view):** three zones on Meta's GST-inclusive scale: below breakeven (`bad`), covering costs (`warn`), above target (`good`). Breakeven tick in `ink-2`, target tick in `ink`. Target = (ex-GST breakeven + 1.5) × 1.18.
- **Scoreboard:** table on desktop, stacked list under `md`. VXP total row in 800 weight.
- **Order dots:** 14px rounded squares, `prepaid` blue / `cod` ochre, with a counted legend.

## Palette checks
Chart series (revenue, spend) and store colours pass the dataviz validator (all pairs, dark mode, on `ground`). `cod` reuses Oorvia's ochre; the two never appear in the same component without labels.
