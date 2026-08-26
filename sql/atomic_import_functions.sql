-- ---------------------------------------------------------------------------
-- Atomic replace helpers for the import pipeline  (bug B8)
--
-- Both importers used to DELETE the existing rows and then INSERT the
-- replacements as two separate PostgREST requests. There is no transaction
-- across those two requests, so if the insert failed — one malformed row, a
-- network blip, a function timeout — the delete had already committed and the
-- data was gone with no undo. order_line_items is what COGS is computed from,
-- so losing it silently zeroes every affected order's product cost.
--
-- These functions do the delete and the insert in one statement block, which
-- runs inside a single implicit transaction: either both happen or neither does.
--
-- Callers:
--   app/api/sync/shopify/route.js    replace_order_line_items, replace_order_costs
--   app/api/import/vfulfill/route.js replace_order_costs
--
-- Both are re-runnable: CREATE OR REPLACE, no state of their own.
-- They run as the caller (security invoker), so existing RLS on order_costs /
-- order_line_items applies exactly as it does to the direct writes they replace.
--
-- Apply in the Supabase SQL Editor. PostgREST picks new functions up from its
-- schema cache — Supabase reloads it automatically after DDL, but if the routes
-- come back with "Could not find the function ... in the schema cache", run:
--   notify pgrst, 'reload schema';
-- ---------------------------------------------------------------------------

-- ── order_costs ─────────────────────────────────────────────────────────────
-- Deletes every row for p_order_names with source = p_source, then inserts
-- p_rows in its place. Scoping the delete by source is what keeps the three
-- writers (vfulfill / fastrr / cashfree) from erasing each other's rows.
-- The inserted rows are forced to p_source so the written scope can never
-- differ from the deleted scope.
-- Returns the number of rows inserted.

create or replace function replace_order_costs(
  p_order_names text[],
  p_source      text,
  p_rows        jsonb default '[]'::jsonb
) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_inserted integer := 0;
begin
  if p_order_names is null or array_length(p_order_names, 1) is null then
    return 0;
  end if;

  if p_source is null then
    raise exception 'replace_order_costs: p_source is required';
  end if;

  delete from order_costs
   where shopify_order_name = any(p_order_names)
     and source = p_source;

  if p_rows is null
     or jsonb_typeof(p_rows) <> 'array'
     or jsonb_array_length(p_rows) = 0 then
    return 0;
  end if;

  insert into order_costs (
    shopify_order_name,
    transaction_head,
    taxable_amt,
    gst_amt,
    total_amt,
    transaction_date,
    nature,
    ratecard_type,
    source
  )
  select
    r.shopify_order_name,
    r.transaction_head,
    r.taxable_amt,
    r.gst_amt,
    r.total_amt,
    r.transaction_date,
    r.nature,
    r.ratecard_type,
    p_source
  from jsonb_to_recordset(p_rows) as r(
    shopify_order_name text,
    transaction_head   text,
    taxable_amt        numeric,
    gst_amt            numeric,
    total_amt          numeric,
    transaction_date   date,
    nature             text,
    ratecard_type      text
  );

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

-- ── order_line_items ────────────────────────────────────────────────────────
-- Deletes every line item for p_order_names, then inserts p_rows in its place.
-- Unlike order_costs there is no source column — the Shopify sync is the only
-- writer, so the whole set for those orders is replaced.
-- Returns the number of rows inserted.

create or replace function replace_order_line_items(
  p_order_names text[],
  p_rows        jsonb default '[]'::jsonb
) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_inserted integer := 0;
begin
  if p_order_names is null or array_length(p_order_names, 1) is null then
    return 0;
  end if;

  delete from order_line_items
   where shopify_order_name = any(p_order_names);

  if p_rows is null
     or jsonb_typeof(p_rows) <> 'array'
     or jsonb_array_length(p_rows) = 0 then
    return 0;
  end if;

  insert into order_line_items (
    shopify_order_name,
    sku,
    qty,
    unit_price
  )
  select
    r.shopify_order_name,
    r.sku,
    r.qty,
    r.unit_price
  from jsonb_to_recordset(p_rows) as r(
    shopify_order_name text,
    sku                text,
    qty                integer,
    unit_price         numeric
  );

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

-- These are called only from server routes using the SERVICE ROLE key. Postgres
-- grants EXECUTE to PUBLIC on new functions by default, so revoke that first —
-- the anon key ships to the browser and has no reason to reach these.
-- NOTE: "revoke ... from public" is not enough on Supabase. Its default
-- privileges grant EXECUTE to anon and authenticated by name, so those two must
-- be revoked explicitly or they survive.
revoke execute on function replace_order_costs(text[], text, jsonb)   from public, anon, authenticated;
revoke execute on function replace_order_line_items(text[], jsonb)    from public, anon, authenticated;
grant  execute on function replace_order_costs(text[], text, jsonb)   to service_role;
grant  execute on function replace_order_line_items(text[], jsonb)    to service_role;

-- ── Verification ────────────────────────────────────────────────────────────
-- Both functions should be listed, and a no-op call should return 0 without
-- touching anything.

select p.proname, pg_get_function_identity_arguments(p.oid) as args
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('replace_order_costs', 'replace_order_line_items')
 order by p.proname;

select replace_order_costs(array[]::text[], 'vfulfill', '[]'::jsonb) as noop_costs,
       replace_order_line_items(array[]::text[], '[]'::jsonb)        as noop_line_items;
