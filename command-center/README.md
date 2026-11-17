# VXP Command Center

Front end only, on **mock data** (`src/lib/mock.ts`). Plan: `../PLAN-vxp-command-center.md`. Design: `DESIGN.md`.

```bash
npm run dev     # http://localhost:3000
npx vitest run  # calculator matches the Pricing Master sheet
```

- `src/lib/calculator.ts`: port of the "Oorvia Pricing Master" sheet (breakeven CPA/ROAS, target = ex-GST breakeven + 1.5).
- `src/lib/types.ts`: the data contract the backend must fill.
- `src/lib/metrics.ts`: everything the screen shows, as pure functions over that contract.
- URL state: `?store=kaiven|selnova|oorvia` and `?period=today|30d|month` (default All VXP, 7D).
