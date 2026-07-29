begin;

do $$
begin
  if to_regclass('ss.catalog_offer_policies') is null
    or to_regclass('ss.commerce_quotes') is null
    or to_regclass('ss.checkout_quote_bindings') is null
    or to_regclass('ss.checkout_intents') is null
  then
    raise exception 'canonical commerce and hosted API migrations must be installed first'
      using errcode = '55000';
  end if;
end
$$;

create table ss.catalog_offer_price_lines (
  id uuid primary key default extensions.gen_random_uuid(),
  offer_policy_id uuid not null
    references ss.catalog_offer_policies(id),
  component text not null check (component in ('one_time', 'recurring')),
  catalog_price_id uuid not null references ss.catalog_prices(id),
  stripe_price_ref text not null
    check (char_length(stripe_price_ref) between 3 and 200),
  created_at timestamptz not null default clock_timestamp(),
  unique (offer_policy_id, component),
  unique (offer_policy_id, catalog_price_id),
  unique (stripe_price_ref)
);

create function ss.validate_catalog_offer_price_set()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  target_offer_policy_id uuid;
  policy_record record;
  expected_components text[];
  actual_components text[];
begin
  target_offer_policy_id := case
    when tg_table_name = 'catalog_offer_policies'
      then coalesce(
        nullif(to_jsonb(new) ->> 'id', '')::uuid,
        nullif(to_jsonb(old) ->> 'id', '')::uuid
      )
    else coalesce(
      nullif(to_jsonb(new) ->> 'offer_policy_id', '')::uuid,
      nullif(to_jsonb(old) ->> 'offer_policy_id', '')::uuid
    )
  end;

  select policy.id, policy.plan_id, policy.price_id, policy.tenure_id
  into policy_record
  from ss.catalog_offer_policies policy
  where policy.id = target_offer_policy_id;

  if not found then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  expected_components := case policy_record.tenure_id
    when 'rent' then array['recurring']::text[]
    when 'own' then array['one_time']::text[]
    when 'owned_managed' then array['one_time', 'recurring']::text[]
  end;

  select coalesce(
    array_agg(line.component order by line.component),
    '{}'::text[]
  )
  into actual_components
  from ss.catalog_offer_price_lines line
  where line.offer_policy_id = target_offer_policy_id;

  if actual_components <> (
    select array_agg(component order by component)
    from unnest(expected_components) component
  ) then
    raise exception 'offer price components do not match tenure billing shape'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from ss.catalog_offer_price_lines line
    join ss.catalog_prices price on price.id = line.catalog_price_id
    where line.offer_policy_id = target_offer_policy_id
      and (
        price.plan_id <> policy_record.plan_id
        or (
          line.component = 'one_time'
          and price.cadence <> 'one_time'
        )
        or (
          line.component = 'recurring'
          and price.cadence not in ('month', 'year')
        )
      )
  ) or not exists (
    select 1
    from ss.catalog_offer_price_lines line
    where line.offer_policy_id = target_offer_policy_id
      and line.catalog_price_id = policy_record.price_id
  ) then
    raise exception 'offer price lines do not match the approved plan and primary price'
      using errcode = '23514';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;

create constraint trigger catalog_offer_policy_price_set
after insert or update on ss.catalog_offer_policies
deferrable initially deferred
for each row execute function ss.validate_catalog_offer_price_set();

create constraint trigger catalog_offer_price_line_set
after insert or update or delete on ss.catalog_offer_price_lines
deferrable initially deferred
for each row execute function ss.validate_catalog_offer_price_set();

create table ss.commerce_quote_price_lines (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  quote_id uuid not null,
  position smallint not null check (position between 1 and 32),
  source_kind text not null
    check (source_kind in ('abracadabra_product', 'domain')),
  billing_cadence text not null
    check (billing_cadence in ('one_time', 'month', 'year')),
  catalog_offer_price_line_id uuid
    references ss.catalog_offer_price_lines(id),
  domain_quote_id uuid,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  amount_minor bigint not null check (amount_minor >= 0),
  stripe_price_ref text
    check (
      stripe_price_ref is null
      or char_length(stripe_price_ref) between 3 and 200
    ),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, quote_id)
    references ss.commerce_quotes(organization_id, id) on delete cascade,
  foreign key (organization_id, domain_quote_id)
    references ss.domain_quotes(organization_id, id),
  unique (organization_id, id),
  unique (quote_id, position),
  unique (quote_id, catalog_offer_price_line_id),
  unique (quote_id, domain_quote_id),
  check (
    (
      source_kind = 'abracadabra_product'
      and catalog_offer_price_line_id is not null
      and domain_quote_id is null
      and stripe_price_ref is not null
    )
    or (
      source_kind = 'domain'
      and catalog_offer_price_line_id is null
      and domain_quote_id is not null
      and stripe_price_ref is null
      and billing_cadence = 'one_time'
    )
  )
);

create function ss.validate_commerce_quote_price_line()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if new.source_kind = 'abracadabra_product' then
    if not exists (
      select 1
      from ss.commerce_quotes quote
      join ss.catalog_offer_price_lines offer_line
        on offer_line.offer_policy_id = quote.offer_policy_id
       and offer_line.id = new.catalog_offer_price_line_id
      join ss.catalog_prices price
        on price.id = offer_line.catalog_price_id
      where quote.organization_id = new.organization_id
        and quote.project_id = new.project_id
        and quote.id = new.quote_id
        and price.currency = new.currency
        and price.unit_amount_minor = new.amount_minor
        and price.cadence = new.billing_cadence
        and offer_line.stripe_price_ref = new.stripe_price_ref
    ) then
      raise exception 'quote website price line is not authoritative'
        using errcode = '23514';
    end if;
  elsif not exists (
    select 1
    from ss.commerce_quotes quote
    join ss.domain_quotes domain_quote
      on domain_quote.organization_id = quote.organization_id
     and domain_quote.project_id = quote.project_id
     and domain_quote.id = new.domain_quote_id
    where quote.organization_id = new.organization_id
      and quote.project_id = new.project_id
      and quote.id = new.quote_id
      and domain_quote.status = 'open'
      and domain_quote.expires_at > quote.issued_at
      and domain_quote.currency = new.currency
      and domain_quote.customer_price_minor = new.amount_minor
  ) then
    raise exception 'quote domain price line is not authoritative'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create constraint trigger commerce_quote_price_line_exact
after insert on ss.commerce_quote_price_lines
deferrable initially immediate
for each row execute function ss.validate_commerce_quote_price_line();

create function ss.validate_commerce_quote_price_set()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  target_quote_id uuid;
  quote_record record;
  one_time_total bigint;
  recurring_totals jsonb;
  expected_line_items integer;
begin
  target_quote_id := case
    when tg_table_name = 'commerce_quotes'
      then coalesce(
        nullif(to_jsonb(new) ->> 'id', '')::uuid,
        nullif(to_jsonb(old) ->> 'id', '')::uuid
      )
    else coalesce(
      nullif(to_jsonb(new) ->> 'quote_id', '')::uuid,
      nullif(to_jsonb(old) ->> 'quote_id', '')::uuid
    )
  end;

  select quote.*
  into quote_record
  from ss.commerce_quotes quote
  where quote.id = target_quote_id;

  if not found then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if exists (
    (
      select line.id
      from ss.catalog_offer_price_lines line
      where line.offer_policy_id = quote_record.offer_policy_id
      except
      select quote_line.catalog_offer_price_line_id
      from ss.commerce_quote_price_lines quote_line
      where quote_line.quote_id = target_quote_id
        and quote_line.source_kind = 'abracadabra_product'
    )
    union all
    (
      select quote_line.catalog_offer_price_line_id
      from ss.commerce_quote_price_lines quote_line
      where quote_line.quote_id = target_quote_id
        and quote_line.source_kind = 'abracadabra_product'
      except
      select line.id
      from ss.catalog_offer_price_lines line
      where line.offer_policy_id = quote_record.offer_policy_id
    )
  ) then
    raise exception 'quote does not contain the complete approved offer price set'
      using errcode = '23514';
  end if;

  select coalesce(sum(line.amount_minor), 0)
  into one_time_total
  from ss.commerce_quote_price_lines line
  where line.quote_id = target_quote_id
    and line.billing_cadence = 'one_time';

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'amountMinor', grouped.amount_minor,
        'currency', grouped.currency,
        'interval', grouped.billing_cadence
      )
      order by grouped.billing_cadence
    ),
    '[]'::jsonb
  )
  into recurring_totals
  from (
    select
      line.billing_cadence,
      min(line.currency) as currency,
      sum(line.amount_minor) as amount_minor
    from ss.commerce_quote_price_lines line
    where line.quote_id = target_quote_id
      and line.billing_cadence in ('month', 'year')
    group by line.billing_cadence
  ) grouped;

  if quote_record.totals #>> '{oneTime,currency}' <>
      quote_record.currency
    or (quote_record.totals #>> '{oneTime,amountMinor}')::bigint <>
      one_time_total
    or coalesce(quote_record.totals -> 'recurring', '[]'::jsonb) <>
      recurring_totals
  then
    raise exception 'quote totals do not equal its authoritative price lines'
      using errcode = '23514';
  end if;

  select 1 + count(*)
  into expected_line_items
  from ss.commerce_quote_price_lines line
  where line.quote_id = target_quote_id
    and line.source_kind = 'domain';

  if jsonb_array_length(quote_record.line_items) <> expected_line_items then
    raise exception 'quote display lines do not match its price sources'
      using errcode = '23514';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;

create constraint trigger commerce_quote_price_set_from_quote
after insert on ss.commerce_quotes
deferrable initially deferred
for each row execute function ss.validate_commerce_quote_price_set();

create constraint trigger commerce_quote_price_set_from_line
after insert or update or delete on ss.commerce_quote_price_lines
deferrable initially deferred
for each row execute function ss.validate_commerce_quote_price_set();

create trigger commerce_quote_price_lines_no_update
before update or delete on ss.commerce_quote_price_lines
for each row execute function ss.reject_update();

create table ss.checkout_intent_price_lines (
  organization_id uuid not null,
  project_id uuid not null,
  checkout_intent_id uuid not null,
  quote_price_line_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (checkout_intent_id, quote_price_line_id),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, checkout_intent_id)
    references ss.checkout_intents(organization_id, id) on delete cascade,
  foreign key (organization_id, quote_price_line_id)
    references ss.commerce_quote_price_lines(organization_id, id),
  unique (organization_id, checkout_intent_id, quote_price_line_id)
);

create function ss.validate_checkout_intent_price_set()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  target_checkout_id uuid;
  checkout_record record;
  binding_record record;
  amount_due_now bigint;
begin
  target_checkout_id := case
    when tg_table_name = 'checkout_intents'
      then coalesce(
        nullif(to_jsonb(new) ->> 'id', '')::uuid,
        nullif(to_jsonb(old) ->> 'id', '')::uuid
      )
    else coalesce(
      nullif(to_jsonb(new) ->> 'checkout_intent_id', '')::uuid,
      nullif(to_jsonb(old) ->> 'checkout_intent_id', '')::uuid
    )
  end;

  select checkout.*
  into checkout_record
  from ss.checkout_intents checkout
  where checkout.id = target_checkout_id;

  if not found then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  select binding.*
  into binding_record
  from ss.checkout_quote_bindings binding
  where binding.checkout_intent_id = target_checkout_id;

  if not found then
    raise exception 'checkout requires an accepted quote binding'
      using errcode = '23514';
  end if;

  if exists (
    (
      select line.id
      from ss.commerce_quote_price_lines line
      where line.quote_id = binding_record.quote_id
      except
      select checkout_line.quote_price_line_id
      from ss.checkout_intent_price_lines checkout_line
      where checkout_line.checkout_intent_id = target_checkout_id
    )
    union all
    (
      select checkout_line.quote_price_line_id
      from ss.checkout_intent_price_lines checkout_line
      where checkout_line.checkout_intent_id = target_checkout_id
      except
      select line.id
      from ss.commerce_quote_price_lines line
      where line.quote_id = binding_record.quote_id
    )
  ) then
    raise exception 'checkout does not bind the complete quote price set'
      using errcode = '23514';
  end if;

  select coalesce(sum(line.amount_minor), 0)
  into amount_due_now
  from ss.commerce_quote_price_lines line
  where line.quote_id = binding_record.quote_id;

  if checkout_record.amount_minor <> amount_due_now
    or exists (
      select 1
      from ss.commerce_quote_price_lines line
      where line.quote_id = binding_record.quote_id
        and line.currency <> checkout_record.currency
    )
    or not exists (
      select 1
      from ss.commerce_quotes quote
      join ss.catalog_offer_policies policy
        on policy.id = quote.offer_policy_id
      join ss.commerce_quote_price_lines line
        on line.quote_id = quote.id
      join ss.catalog_offer_price_lines offer_line
        on offer_line.id = line.catalog_offer_price_line_id
      where quote.id = binding_record.quote_id
        and offer_line.catalog_price_id = checkout_record.catalog_price_id
        and offer_line.catalog_price_id = policy.price_id
    )
  then
    raise exception 'checkout amount or primary price is not authoritative'
      using errcode = '23514';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;

create constraint trigger checkout_intent_price_set_from_checkout
after insert on ss.checkout_intents
deferrable initially deferred
for each row execute function ss.validate_checkout_intent_price_set();

create constraint trigger checkout_intent_price_set_from_line
after insert or update or delete on ss.checkout_intent_price_lines
deferrable initially deferred
for each row execute function ss.validate_checkout_intent_price_set();

create trigger checkout_intent_price_lines_no_update
before update or delete on ss.checkout_intent_price_lines
for each row execute function ss.reject_update();

alter table ss.catalog_offer_price_lines enable row level security;
alter table ss.catalog_offer_price_lines force row level security;
create policy catalog_offer_price_lines_authenticated_read
on ss.catalog_offer_price_lines for select
using (ss.current_user_id() is not null);

alter table ss.commerce_quote_price_lines enable row level security;
alter table ss.commerce_quote_price_lines force row level security;
create policy commerce_quote_price_lines_tenant_read
on ss.commerce_quote_price_lines for select
using (ss.can_access_org(organization_id));

alter table ss.checkout_intent_price_lines enable row level security;
alter table ss.checkout_intent_price_lines force row level security;
create policy checkout_intent_price_lines_tenant_read
on ss.checkout_intent_price_lines for select
using (ss.can_access_org(organization_id));

revoke all on
  ss.catalog_offer_price_lines,
  ss.commerce_quote_price_lines,
  ss.checkout_intent_price_lines
from public, anon, authenticated;

grant select on
  ss.catalog_offer_price_lines,
  ss.commerce_quote_price_lines,
  ss.checkout_intent_price_lines
to authenticated;

grant all privileges on
  ss.catalog_offer_price_lines,
  ss.commerce_quote_price_lines,
  ss.checkout_intent_price_lines
to service_role;

revoke all on function ss.validate_catalog_offer_price_set()
from public, anon, authenticated;
revoke all on function ss.validate_commerce_quote_price_line()
from public, anon, authenticated;
revoke all on function ss.validate_commerce_quote_price_set()
from public, anon, authenticated;
revoke all on function ss.validate_checkout_intent_price_set()
from public, anon, authenticated;

grant execute on function ss.validate_catalog_offer_price_set()
to service_role;
grant execute on function ss.validate_commerce_quote_price_line()
to service_role;
grant execute on function ss.validate_commerce_quote_price_set()
to service_role;
grant execute on function ss.validate_checkout_intent_price_set()
to service_role;

commit;
