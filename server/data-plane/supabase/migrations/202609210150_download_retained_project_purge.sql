-- Migration 150: erase project content without cascading retained Download
-- payment, access, and risk evidence. No provider reconciliation is implied.
begin;

do $$
begin
  if to_regclass('ss.commerce_v2_download_dispute_dossiers') is null then
    raise exception 'Download protection migration 143 is required';
  end if;
end
$$;

create function ss.download_project_evidence_retained(tenant uuid, project uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, ss
as $$
  select exists (select 1 from ss.commerce_v2_download_checkout_attempts
      where organization_id = tenant and project_id = project)
    or exists (select 1 from ss.commerce_v2_download_dispatches
      where organization_id = tenant and project_id = project)
    or exists (select 1 from ss.commerce_v2_download_payment_receipts
      where organization_id = tenant and project_id = project)
$$;

create or replace function ss.activate_commerce_v2_purge()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
declare
  inventory jsonb;
  removed jsonb;
begin
  if new.state = 'purging' then
    if exists (
      select 1 from ss.commerce_v2_download_dispatches
      where organization_id = new.organization_id and project_id = new.project_id
        and state in ('dispatching', 'ready', 'effect_unknown')
    ) then
      raise exception 'resolve pending Download Checkout before project deletion'
        using errcode = 'PSS01';
    end if;
    perform set_config(
      'app.terminal_purge_project_id',
      new.project_id::text,
      true
    );
    inventory := jsonb_build_object(
        'commerceV2Commands', (
          select count(*)
          from ss.commerce_v2_commands
          where organization_id = new.organization_id
            and project_id = new.project_id
        ),
        'commerceV2DownloadQuotes', (
          select count(*)
          from ss.commerce_v2_download_quotes
          where organization_id = new.organization_id
            and project_id = new.project_id
        ),
        'commerceV2CheckoutPreparations', (
          select count(*)
          from ss.commerce_v2_checkout_preparations
          where organization_id = new.organization_id
            and project_id = new.project_id
        ),
        'commerceV2DownloadDispatches', (
          select count(*)
          from ss.commerce_v2_download_dispatches
          where organization_id = new.organization_id
            and project_id = new.project_id
        ),
        'commerceV2DownloadStripeEvents', (
          select count(*)
          from ss.commerce_v2_download_stripe_events
          where organization_id = new.organization_id
            and project_id = new.project_id
        ),
        'commerceV2DownloadPaymentReceipts', (
          select count(*)
          from ss.commerce_v2_download_payment_receipts
          where organization_id = new.organization_id
            and project_id = new.project_id
        ),
        'commerceV2ProjectEntitlements', (
          select count(*)
          from ss.commerce_v2_project_entitlements
          where organization_id = new.organization_id
            and project_id = new.project_id
        ),
        'commerceV2DownloadReversalEvents', (
          select count(*)
          from ss.commerce_v2_download_reversal_events
          where organization_id = new.organization_id
            and project_id = new.project_id
        )
      );
    if ss.download_project_evidence_retained(new.organization_id, new.project_id) then
      select jsonb_object_agg(key, 0) into removed from jsonb_each(inventory);
      new.removal_counts := coalesce(new.removal_counts, '{}'::jsonb) || removed
        || jsonb_build_object('retainedDownloadEvidence', inventory || jsonb_build_object(
          'commerceV2DownloadCheckoutAttempts', (select count(*)
            from ss.commerce_v2_download_checkout_attempts
            where organization_id = new.organization_id and project_id = new.project_id),
          'commerceV2DownloadAccessEvents', (select count(*)
            from ss.commerce_v2_download_access_events
            where organization_id = new.organization_id and project_id = new.project_id),
          'commerceV2DownloadFraudWarningEvents', (select count(*)
            from ss.commerce_v2_download_fraud_warning_events
            where organization_id = new.organization_id and project_id = new.project_id),
          'commerceV2DownloadDisputeDossiers', (select count(*)
            from ss.commerce_v2_download_dispute_dossiers
            where organization_id = new.organization_id and project_id = new.project_id)
        ));
    else
      new.removal_counts := coalesce(new.removal_counts, '{}'::jsonb) || inventory;
    end if;
  end if;
  return new;
end
$$;

create or replace function ss.purge_commerce_v2_on_project_seal()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
begin
  if new.state = 'purging' then
    if nullif(current_setting('app.terminal_purge_project_id', true), '')::uuid
      is distinct from new.project_id then
      raise exception 'commerce v2 purge requires the sealed deletion boundary'
        using errcode = '42501';
    end if;
    if not ss.download_project_evidence_retained(new.organization_id, new.project_id) then
      delete from ss.commerce_v2_checkout_preparations
        where organization_id = new.organization_id and project_id = new.project_id;
      delete from ss.commerce_v2_download_quotes
        where organization_id = new.organization_id and project_id = new.project_id;
      delete from ss.commerce_v2_commands
        where organization_id = new.organization_id and project_id = new.project_id;
    end if;
  end if;
  return new;
end
$$;

-- Only three content-version FKs change. All project, tenant, receipt,
-- preparation, quote, and immutable evidence links remain in force.
-- Their historical version IDs survive after the content row is removed.
do $$
declare
  constraint_row record;
  replaced integer := 0;
begin
  for constraint_row in
    select conrelid::regclass as relation, conname, conkey, confkey
    from pg_constraint
    where contype = 'f' and confrelid = 'ss.site_versions'::regclass
      and conrelid in ('ss.commerce_v2_download_quotes'::regclass,
        'ss.commerce_v2_checkout_preparations'::regclass,
        'ss.commerce_v2_download_payment_receipts'::regclass)
  loop
    if (select array_agg(attname::text order by ordinality)
        from unnest(constraint_row.conkey) with ordinality as keys(attnum, ordinality)
        join pg_attribute a on a.attrelid = constraint_row.relation and a.attnum = keys.attnum)
        <> array['organization_id', 'project_id', 'version_id']
      or (select array_agg(attname::text order by ordinality)
        from unnest(constraint_row.confkey) with ordinality as keys(attnum, ordinality)
        join pg_attribute a on a.attrelid = 'ss.site_versions'::regclass and a.attnum = keys.attnum)
        <> array['organization_id', 'project_id', 'id'] then
      raise exception 'unexpected Download version foreign key';
    end if;
    execute format('alter table %s drop constraint %I', constraint_row.relation, constraint_row.conname);
    replaced := replaced + 1;
  end loop;
  if replaced <> 3 then
    raise exception 'expected exactly three Download version foreign keys, found %', replaced;
  end if;
end
$$;

-- Keep live writes equivalent to the removed FKs, including the key-share
-- lock that prevents content deletion racing a new quote/preparation/receipt.
create function ss.require_download_live_version()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
begin
  perform 1 from ss.site_versions
    where organization_id = new.organization_id and project_id = new.project_id
      and id = new.version_id for key share;
  if not found then
    raise exception 'Download evidence requires a live version when created'
      using errcode = '23503';
  end if;
  return new;
end
$$;

create trigger download_quote_live_version
before insert or update of organization_id, project_id, version_id
on ss.commerce_v2_download_quotes
for each row execute function ss.require_download_live_version();
create trigger download_preparation_live_version
before insert or update of organization_id, project_id, version_id
on ss.commerce_v2_checkout_preparations
for each row execute function ss.require_download_live_version();
create trigger download_receipt_live_version
before insert or update of organization_id, project_id, version_id
on ss.commerce_v2_download_payment_receipts
for each row execute function ss.require_download_live_version();

create function ss.guard_download_version_removal()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
begin
  if tg_op = 'UPDATE' and new.organization_id = old.organization_id
    and new.project_id = old.project_id and new.id = old.id then
    return new;
  end if;
  if exists (select 1 from ss.commerce_v2_download_quotes
      where organization_id = old.organization_id and project_id = old.project_id
        and version_id = old.id)
    or exists (select 1 from ss.commerce_v2_checkout_preparations
      where organization_id = old.organization_id and project_id = old.project_id
        and version_id = old.id)
    or exists (select 1 from ss.commerce_v2_download_payment_receipts
      where organization_id = old.organization_id and project_id = old.project_id
        and version_id = old.id) then
    if tg_op <> 'DELETE'
      or nullif(current_setting('app.terminal_purge_project_id', true), '')::uuid
        is distinct from old.project_id
      or not exists (select 1 from ss.deletion_requests
        where organization_id = old.organization_id and project_id = old.project_id
          and state = 'purging') then
      raise exception 'referenced Download version requires sealed terminal deletion'
        using errcode = '23503';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;

create trigger download_version_removal_guard
before delete or update of organization_id, project_id, id on ss.site_versions
for each row execute function ss.guard_download_version_removal();

create function ss.hosted_runtime_contract_v150()
returns text
language sql
immutable
set search_path = pg_catalog
as $$ select 'canonical-ss-v150-download-retained-project-purge'::text $$;

revoke all on function
  ss.download_project_evidence_retained(uuid, uuid),
  ss.require_download_live_version(), ss.guard_download_version_removal(),
  ss.hosted_runtime_contract_v150()
from public, anon, authenticated;
grant execute on function
  ss.download_project_evidence_retained(uuid, uuid),
  ss.require_download_live_version(), ss.guard_download_version_removal(),
  ss.hosted_runtime_contract_v150()
to service_role;

commit;
