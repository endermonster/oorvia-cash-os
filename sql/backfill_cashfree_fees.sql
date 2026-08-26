-- ---------------------------------------------------------------------------
-- Backfill Cashfree payment gateway fees into order_costs  (bug B4)
--
-- Cashfree charges 2.5% of order value on every prepaid order, plus 18% GST on
-- that fee. Nothing ever wrote it to order_costs (source='cashfree' had 0 rows),
-- so the fee was missing from headline P&L cost and its GST input credit — about
-- ₹1,297 across the delivered Cashfree orders — was never claimed.
--
-- app/api/sync/shopify/route.js now writes this row going forward. This script
-- writes it for the orders already in the database.
--
-- Scope: EVERY order with payment_type = 'prepaid_cashfree' and order_value > 0,
-- not only the delivered ones. The gateway takes its cut when the payment is
-- captured, which happens regardless of what the shipment later does — the same
-- rule the sync route applies. (The delivered subset is 192 orders; the total
-- will be that or slightly more. The breakdown query at the bottom shows both.)
--
-- Arithmetic matches the JS in the sync route exactly:
--   taxable = round(order_value * 0.025, 2)
--   gst     = round(taxable * 0.18, 2)
--   total   = taxable + gst
--
-- IDEMPOTENT: every source='cashfree' row is deleted before reinserting, so
-- running this twice produces the same result as running it once. The sync
-- route's own replace is scoped to source='cashfree' too, so the two agree.
--
-- Apply in the Supabase SQL Editor. Not run by any code.
-- ---------------------------------------------------------------------------

begin;

-- Clear the slate — makes a re-run a no-op rather than a doubling.
delete from order_costs
 where source = 'cashfree';

insert into order_costs (
  shopify_order_name,
  transaction_head,
  taxable_amt,
  gst_amt,
  total_amt,
  transaction_date,
  nature,
  source
)
select
  f.shopify_order_name,
  'Payment Gateway Fee',
  f.taxable,
  round(f.taxable * 0.18, 2),
  f.taxable + round(f.taxable * 0.18, 2),
  f.order_date,
  'debit',
  'cashfree'
from (
  select
    o.shopify_order_name,
    o.order_date,
    round(o.order_value::numeric * 0.025, 2) as taxable
  from orders o
  where o.payment_type = 'prepaid_cashfree'
    and coalesce(o.order_value, 0) > 0
) f;

commit;

-- ── Verification ────────────────────────────────────────────────────────────

-- Headline: how many rows landed and how much GST is now claimable.
select
  count(*)          as rows_inserted,
  sum(taxable_amt)  as total_fee_taxable,
  sum(gst_amt)      as total_gst_claimable,
  sum(total_amt)    as total_cost_added
from order_costs
where source = 'cashfree';

-- Breakdown by order status — the 'delivered' line is the ~192 orders / ~₹1,297
-- of input credit this was written to recover.
select
  o.status,
  count(*)         as rows_inserted,
  sum(c.gst_amt)   as gst_claimable,
  sum(c.total_amt) as cost_added
from order_costs c
join orders o on o.shopify_order_name = c.shopify_order_name
where c.source = 'cashfree'
group by o.status
order by o.status;

-- Should return 0 rows: every prepaid_cashfree order with value now has a fee row.
select o.shopify_order_name, o.order_value, o.status
from orders o
where o.payment_type = 'prepaid_cashfree'
  and coalesce(o.order_value, 0) > 0
  and not exists (
    select 1 from order_costs c
     where c.shopify_order_name = o.shopify_order_name
       and c.source = 'cashfree'
  );
