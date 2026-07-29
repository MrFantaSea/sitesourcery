begin;

do $$
begin
  if to_regclass('ss.checkout_quote_bindings') is null
    or to_regclass('ss.subscription_cancellation_previews') is null
    or to_regclass('ss.subscription_cancellation_acceptances') is null
    or to_regclass('ss.export_download_authorizations') is null
    or to_regprocedure(
      'ss.begin_terminal_project_purge(uuid,text,uuid)'
    ) is null
  then
    raise exception 'hosted API and terminal purge migrations must be installed first'
      using errcode = '55000';
  end if;
end
$$;

-- The purge function in migration 004 predates the hosted API edge tables in
-- migration 007. This transaction-local capability is created only when the
-- service-role deletion boundary has already sealed a purging request.
create function ss.activate_hosted_edge_purge()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
begin
  if new.state = 'purging' then
    perform set_config(
      'app.terminal_purge_project_id',
      new.project_id::text,
      true
    );
    new.removal_counts := coalesce(new.removal_counts, '{}'::jsonb)
      || jsonb_build_object(
        'commerceQuotes', (
          select count(*) from ss.commerce_quotes
          where project_id = new.project_id
        ),
        'checkoutQuoteBindings', (
          select count(*) from ss.checkout_quote_bindings
          where project_id = new.project_id
        ),
        'cancellationPreviews', (
          select count(*) from ss.subscription_cancellation_previews
          where project_id = new.project_id
        ),
        'cancellationAcceptances', (
          select count(*) from ss.subscription_cancellation_acceptances
          where project_id = new.project_id
        ),
        'exportDownloadAuthorizations', (
          select count(*) from ss.export_download_authorizations
          where project_id = new.project_id
        )
      );
  end if;
  return new;
end
$$;

revoke all on function ss.activate_hosted_edge_purge()
from public, anon, authenticated;

create trigger deletion_requests_activate_hosted_edge_purge
before insert or update of state on ss.deletion_requests
for each row execute function ss.activate_hosted_edge_purge();

-- Immutable rows stay immutable during every ordinary transaction. The only
-- delete exception is the exact project whose sealed deletion request is
-- already in `purging` state in this same transaction.
create or replace function ss.reject_update()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  row_project_id uuid;
begin
  if tg_op = 'DELETE' then
    row_project_id :=
      nullif(to_jsonb(old) ->> 'project_id', '')::uuid;
    if row_project_id is not null
      and nullif(
        current_setting('app.terminal_purge_project_id', true),
        ''
      )::uuid = row_project_id
      and exists (
        select 1
        from ss.deletion_requests request
        where request.project_id = row_project_id
          and request.state = 'purging'
      )
    then
      return old;
    end if;
  end if;

  raise exception '% is immutable', tg_table_schema || '.' || tg_table_name
    using errcode = '55000';
end
$$;

create function ss.purge_checkout_binding_before_intent_delete()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
begin
  delete from ss.checkout_quote_bindings
  where organization_id = old.organization_id
    and checkout_intent_id = old.id;
  return old;
end
$$;

revoke all on function ss.purge_checkout_binding_before_intent_delete()
from public, anon, authenticated;

create trigger checkout_intents_purge_quote_binding
before delete on ss.checkout_intents
for each row execute function ss.purge_checkout_binding_before_intent_delete();

create function ss.purge_hosted_edges_on_project_seal()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
begin
  if old.lifecycle <> 'deleting' and new.lifecycle = 'deleting' then
    if nullif(
      current_setting('app.terminal_purge_project_id', true),
      ''
    )::uuid is distinct from new.id
      or not exists (
        select 1
        from ss.deletion_requests request
        where request.project_id = new.id
          and request.state = 'purging'
      )
    then
      raise exception 'hosted edge purge requires the sealed deletion boundary'
        using errcode = '42501';
    end if;

    delete from ss.subscription_cancellation_acceptances
    where project_id = new.id;
    delete from ss.subscription_cancellation_previews
    where project_id = new.id;
    delete from ss.checkout_quote_bindings
    where project_id = new.id;
    delete from ss.commerce_quotes
    where project_id = new.id;
  end if;
  return new;
end
$$;

revoke all on function ss.purge_hosted_edges_on_project_seal()
from public, anon, authenticated;

create trigger projects_purge_hosted_edges
before update of lifecycle on ss.projects
for each row execute function ss.purge_hosted_edges_on_project_seal();

commit;
