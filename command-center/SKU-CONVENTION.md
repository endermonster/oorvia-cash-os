# SKU convention: Oorvia, Kaiven, Selnova

The Command Center files every order, cost and delivery under a product's **store + SKU**. A
missing, changed or reused SKU breaks that product's profit and breakeven. These rules keep it clean.

## The format

`STORE-PRODUCT`, plus `-VARIANT` only when the product has variants.

| Part | Rule | Examples |
|---|---|---|
| Store | `OV` Oorvia · `KV` Kaiven · `SN` Selnova | `OV`, `KV`, `SN` |
| Product | 3–4 capital letters from the product name. Unique in that store, never reused | `DHS` (Deoxyribose Scalp Serum), `PDRN` |
| Variant | Only if the product has variants. 2–4 capital letters | `BLK`, `PNK`, `2PK` |

Full examples: `KV-DHS`, `SN-PDRN`, `OV-YUBI-BLK`, `OV-YUBI-PNK`.

Capitals, letters and digits only, hyphens between parts. No spaces, no dates, no ad names.

## Before the first ad: checklist

Do all five in Shopify before launching a campaign:

1. **Create the product** and note its handle. Every ad must link to `/products/{handle}`, because that's how the dashboard knows which product a campaign sells.
2. **Set the SKU** on every variant, in the format above.
3. **Set "Cost per item"** to the landed cost, **ex-GST**.
4. **Set the weight** to the packed weight (box included). vFulfill charges shipping by 500 g slab. If it's left at 0, the dashboard assumes 500 g.
5. **Set the stage to Testing** in the Command Center. Switch it to Live once stock lands in India.

## Never

- **Rename a live SKU.** Past orders keep the old SKU, so the product's history splits in two. If it really must change, create a new product.
- **Reuse a SKU** for a different product, even after the old one is dead.
- **Leave the SKU blank.** The dashboard then can't cost the order, and the store page shows a warning.
- **Change the cost on an old date.** When cost changes, add a new cost entry from today. Past orders keep the cost they were bought at.

## Current SKUs (2026-11-18)

| Store | Product | SKU | Status |
|---|---|---|---|
| Oorvia | Microinfusion System | `OMS-1M` | Predates this convention. **Keep as is**: renaming would split its history |
| Kaiven | Medicube Deoxyribose Scalp Serum | `KV-DHS` | Fits |
| Selnova | PDRN Pink Vitamin Glow Ampoule | **none in Shopify** | **To do:** set SKU `SN-PDRN` and its cost per item |

All three products have weight 0 in Shopify, so the dashboard uses 500 g until a real packed weight is set.
