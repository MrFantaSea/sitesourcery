begin;

do $$
begin
  if to_regprocedure('ss.hosted_runtime_contract_v54()') is null
    or ss.hosted_runtime_contract_v54() <>
      'canonical-ss-v54-durable-mail-lifecycle'
    or to_regclass('ss.hosted_registration_requests') is null
    or to_regclass('ss.hosted_recovery_tokens') is null
    or to_regclass('ss.hosted_recovery_delivery_requests') is null
  then
    raise exception
      'durable mail and hosted identity foundations must be applied first'
      using errcode = '55000';
  end if;
end
$$;

alter table ss.hosted_registration_requests
  add column mail_delivery_id uuid unique
    references ss.hosted_mail_deliveries(id),
  add column provider_accepted_at timestamptz,
  add column delivery_lineage_version text,
  add column possession_evidence_digest ss.sha256_hex,
  add column possession_proven_at timestamptz;

alter table ss.hosted_recovery_delivery_requests
  add column recovery_token_id uuid unique
    references ss.hosted_recovery_tokens(id),
  add column mail_delivery_id uuid unique
    references ss.hosted_mail_deliveries(id),
  add column provider_accepted_at timestamptz,
  add column delivery_lineage_version text,
  add column possession_evidence_digest ss.sha256_hex,
  add column possession_proven_at timestamptz;

do $$
declare
  selected record;
begin
  for selected in
    select constraint_row.conname
      from pg_constraint constraint_row
     where constraint_row.conrelid =
             'ss.hosted_registration_requests'::regclass
       and constraint_row.contype = 'c'
       and (
         pg_get_constraintdef(constraint_row.oid) ~ '\mstate\M'
         or pg_get_constraintdef(constraint_row.oid) ~ '\mdelivered_at\M'
         or pg_get_constraintdef(constraint_row.oid) ~ '\mactivated_at\M'
         or pg_get_constraintdef(constraint_row.oid) ~ '\msuperseded_at\M'
         or pg_get_constraintdef(constraint_row.oid) ~ '\mdelivery_provider\M'
         or pg_get_constraintdef(constraint_row.oid) ~ '\mdelivery_receipt\M'
       )
  loop
    execute format(
      'alter table ss.hosted_registration_requests drop constraint %I',
      selected.conname
    );
  end loop;

  for selected in
    select constraint_row.conname
      from pg_constraint constraint_row
     where constraint_row.conrelid =
             'ss.hosted_recovery_delivery_requests'::regclass
       and constraint_row.contype = 'c'
       and (
         pg_get_constraintdef(constraint_row.oid) ~ '\mstate\M'
         or pg_get_constraintdef(constraint_row.oid) ~ '\mdelivered_at\M'
         or pg_get_constraintdef(constraint_row.oid) ~ '\mprovider_receipt_id\M'
         or pg_get_constraintdef(constraint_row.oid) ~ '\mfailure_code\M'
       )
  loop
    execute format(
      'alter table ss.hosted_recovery_delivery_requests drop constraint %I',
      selected.conname
    );
  end loop;
end
$$;

alter table ss.hosted_registration_requests
  add constraint hosted_registration_state_v111
  check (
    state in (
      'pending_delivery',
      'provider_accepted',
      'delivered',
      'delivery_unknown',
      'activated',
      'superseded'
    )
  ),
  add constraint hosted_registration_receipt_v111
  check (
    num_nonnulls(
      delivery_provider,
      delivery_receipt,
      delivery_receipt_digest
    ) in (0, 3)
    and (
      delivery_receipt is null
      or (
        jsonb_typeof(delivery_receipt) = 'object'
        and pg_column_size(delivery_receipt) <= 4096
      )
    )
  ),
  add constraint hosted_registration_lineage_v111
  check (
    (delivery_lineage_version is null
      and mail_delivery_id is null
      and provider_accepted_at is null)
    or (delivery_lineage_version = 'provider_accepted_v1'
      and mail_delivery_id is not null
      and provider_accepted_at is not null
      and provider_accepted_at >= created_at
      and provider_accepted_at < expires_at)
    or (delivery_lineage_version = 'development_sink_v1'
      and mail_delivery_id is null
      and provider_accepted_at is null
      and delivery_provider = 'development-sink')
  ),
  add constraint hosted_registration_possession_v111
  check (
    num_nonnulls(
      possession_evidence_digest,
      possession_proven_at
    ) in (0, 2)
    and (
      possession_proven_at is null
      or (
        state = 'activated'
        and delivered_at = possession_proven_at
        and possession_proven_at >= created_at
        and possession_proven_at < expires_at
      )
    )
  ),
  add constraint hosted_registration_activation_v111
  check (
    (state = 'activated'
      and activated_at is not null
      and activated_user_id is not null
      and activated_organization_id is not null
      and activation_command_id is not null
      and delivered_at is not null)
    or (state <> 'activated'
      and activated_at is null
      and activated_user_id is null
      and activated_organization_id is null
      and activation_command_id is null)
  ),
  add constraint hosted_registration_supersession_v111
  check (
    (state = 'superseded') = (superseded_at is not null)
  ),
  add constraint hosted_registration_state_evidence_v111
  check (
    (state in ('pending_delivery', 'delivery_unknown')
      and delivery_provider is null
      and delivery_receipt is null
      and delivery_receipt_digest is null
      and delivered_at is null
      and possession_proven_at is null)
    or (state = 'provider_accepted'
      and delivery_lineage_version = 'provider_accepted_v1'
      and delivery_provider is not null
      and delivery_receipt is not null
      and delivery_receipt_digest is not null
      and delivered_at is null
      and possession_proven_at is null)
    or (state = 'delivered'
      and delivery_provider is not null
      and delivery_receipt is not null
      and delivery_receipt_digest is not null
      and delivered_at is not null)
    or state in ('activated', 'superseded')
  );

drop index if exists ss.hosted_registration_one_current_email;
create unique index hosted_registration_one_current_email
  on ss.hosted_registration_requests(lower(email))
  where state in (
    'pending_delivery',
    'provider_accepted',
    'delivered',
    'delivery_unknown'
  );

drop index if exists ss.hosted_registration_expiry;
create index hosted_registration_expiry
  on ss.hosted_registration_requests(expires_at)
  where state in (
    'pending_delivery',
    'provider_accepted',
    'delivered',
    'delivery_unknown'
  );

create function ss.guard_hosted_registration_delivery_acceptance()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  mail record;
begin
  if tg_op = 'INSERT' then
    if new.state <> 'pending_delivery'
      or num_nonnulls(
        new.mail_delivery_id,
        new.provider_accepted_at,
        new.delivery_lineage_version,
        new.possession_evidence_digest,
        new.possession_proven_at
      ) <> 0
    then
      raise exception 'registration must begin pending delivery'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if row(
    new.id, new.command_id, new.request_digest, new.email,
    new.display_name, new.organization_name, new.password_phc,
    new.pepper_version, new.token_digest, new.created_at, new.expires_at
  ) is distinct from row(
    old.id, old.command_id, old.request_digest, old.email,
    old.display_name, old.organization_name, old.password_phc,
    old.pepper_version, old.token_digest, old.created_at, old.expires_at
  ) then
    raise exception 'registration request identity is immutable'
      using errcode = '55000';
  end if;

  if not (
    (old.state = 'pending_delivery'
      and new.state in (
        'provider_accepted', 'delivered',
        'delivery_unknown', 'superseded'
      ))
    or (old.state in ('provider_accepted', 'delivered')
      and new.state in ('activated', 'superseded'))
    or (old.state = 'delivery_unknown' and new.state = 'superseded')
  ) then
    raise exception 'registration delivery transition is invalid'
      using errcode = '23514';
  end if;

  if old.delivery_receipt_digest is not null
    and row(
      new.delivery_provider, new.delivery_receipt,
      new.delivery_receipt_digest, new.mail_delivery_id,
      new.provider_accepted_at, new.delivery_lineage_version
    ) is distinct from row(
      old.delivery_provider, old.delivery_receipt,
      old.delivery_receipt_digest, old.mail_delivery_id,
      old.provider_accepted_at, old.delivery_lineage_version
    )
  then
    raise exception 'registration provider acceptance evidence is immutable'
      using errcode = '55000';
  end if;

  if new.state = 'provider_accepted' then
    select * into mail
      from ss.hosted_mail_deliveries
     where id = new.mail_delivery_id;
    if not found
      or mail.message_type <> 'account_activation'
      or mail.state not in ('provider_accepted', 'delivered')
      or mail.provider <> new.delivery_provider
      or mail.provider_accepted_at <> new.provider_accepted_at
      or new.delivery_receipt ->> 'messageId' <> new.mail_delivery_id::text
      or new.delivery_receipt ->> 'state' <> 'provider_accepted'
    then
      raise exception 'registration provider acceptance lineage is invalid'
        using errcode = '23514';
    end if;
  end if;

  if new.state = 'delivered'
    and old.state = 'pending_delivery'
    and not (
      new.delivery_lineage_version = 'development_sink_v1'
      and new.delivery_provider = 'development-sink'
    )
  then
    raise exception 'provider acceptance cannot claim registration delivery'
      using errcode = '23514';
  end if;

  if new.state = 'activated' then
    if new.possession_evidence_digest is null
      or new.possession_proven_at is null
      or new.delivered_at <> new.possession_proven_at
      or new.activated_at <> new.possession_proven_at
    then
      raise exception 'registration activation lacks possession evidence'
        using errcode = '23514';
    end if;
  elsif row(
    new.possession_evidence_digest,
    new.possession_proven_at
  ) is distinct from row(
    old.possession_evidence_digest,
    old.possession_proven_at
  ) then
    raise exception 'registration possession evidence is transition-bound'
      using errcode = '23514';
  end if;

  return new;
end
$$;

create trigger hosted_registration_delivery_acceptance_guard
before insert or update on ss.hosted_registration_requests
for each row execute function
  ss.guard_hosted_registration_delivery_acceptance();

alter table ss.hosted_recovery_delivery_requests
  add constraint hosted_recovery_delivery_state_v111
  check (
    state in (
      'pending_delivery',
      'provider_accepted',
      'delivered',
      'delivery_unknown',
      'recipient_unresolved'
    )
  ),
  add constraint hosted_recovery_delivery_failure_code_v111
  check (
    failure_code is null
    or failure_code ~ '^[A-Z][A-Z0-9_]{0,127}$'
  ),
  add constraint hosted_recovery_delivery_lineage_v111
  check (
    (delivery_lineage_version is null
      and mail_delivery_id is null
      and provider_accepted_at is null)
    or (delivery_lineage_version = 'provider_accepted_v1'
      and recovery_token_id is not null
      and mail_delivery_id is not null
      and provider_accepted_at is not null
      and provider_accepted_at >= requested_at
      and provider_accepted_at < expires_at)
    or (delivery_lineage_version = 'development_sink_v1'
      and recovery_token_id is not null
      and mail_delivery_id is null
      and provider_accepted_at is null
      and delivery_provider = 'development-sink')
  ),
  add constraint hosted_recovery_delivery_possession_v111
  check (
    num_nonnulls(
      possession_evidence_digest,
      possession_proven_at
    ) in (0, 2)
    and (
      possession_proven_at is null
      or (
        state = 'delivered'
        and delivered_at = possession_proven_at
        and possession_proven_at >= requested_at
        and possession_proven_at < expires_at
      )
    )
  ),
  add constraint hosted_recovery_delivery_evidence_v111
  check (
    (state = 'pending_delivery'
      and provider_receipt_id is null
      and delivered_at is null
      and failure_code is null)
    or (state = 'recipient_unresolved'
      and recovery_token_id is null
      and mail_delivery_id is null
      and provider_receipt_id is null
      and delivered_at is null
      and failure_code is null
      and possession_proven_at is null)
    or (state = 'provider_accepted'
      and delivery_lineage_version = 'provider_accepted_v1'
      and provider_receipt_id is not null
      and delivered_at is null
      and failure_code is null)
    or (state = 'delivered'
      and provider_receipt_id is not null
      and delivered_at is not null
      and failure_code is null)
    or (state = 'delivery_unknown'
      and provider_receipt_id is null
      and delivered_at is null
      and failure_code is not null)
  );

drop index if exists ss.hosted_recovery_delivery_requests_expiry;
create index hosted_recovery_delivery_requests_expiry
  on ss.hosted_recovery_delivery_requests(expires_at)
  where state in (
    'pending_delivery',
    'provider_accepted',
    'delivery_unknown',
    'recipient_unresolved'
  );

create or replace function ss.validate_hosted_recovery_delivery_transition()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  mail record;
  recovery record;
begin
  if new.id is distinct from old.id
    or new.command_id is distinct from old.command_id
    or new.request_digest is distinct from old.request_digest
    or new.delivery_idempotency_key is distinct from old.delivery_idempotency_key
    or new.delivery_mode is distinct from old.delivery_mode
    or new.delivery_provider is distinct from old.delivery_provider
    or new.requested_at is distinct from old.requested_at
    or new.expires_at is distinct from old.expires_at
    or new.created_at is distinct from old.created_at
    or new.recovery_token_id is distinct from old.recovery_token_id
  then
    raise exception 'recovery delivery reservation facts are immutable'
      using errcode = '23514';
  end if;

  if not (
    (old.state = 'pending_delivery'
      and new.state in (
        'provider_accepted', 'delivered', 'delivery_unknown'
      ))
    or (old.state = 'provider_accepted' and new.state = 'delivered')
    or (old.state = 'delivered' and new.state = 'delivered'
      and old.possession_proven_at is null
      and new.possession_proven_at is not null)
  ) then
    raise exception 'recovery delivery state is terminal'
      using errcode = '23514';
  end if;

  if old.provider_receipt_id is not null
    and row(
      new.provider_receipt_id, new.mail_delivery_id,
      new.provider_accepted_at, new.delivery_lineage_version
    ) is distinct from row(
      old.provider_receipt_id, old.mail_delivery_id,
      old.provider_accepted_at, old.delivery_lineage_version
    )
  then
    raise exception 'recovery provider acceptance evidence is immutable'
      using errcode = '55000';
  end if;

  if new.state = 'provider_accepted' then
    select * into recovery
      from ss.hosted_recovery_tokens
     where id = new.recovery_token_id;
    select * into mail
      from ss.hosted_mail_deliveries
     where id = new.mail_delivery_id;
    if recovery.id is null
      or mail.id is null
      or mail.message_type <> 'account_recovery'
      or mail.customer_user_id <> recovery.user_id
      or mail.state not in ('provider_accepted', 'delivered')
      or mail.provider <> new.delivery_provider
      or mail.provider_accepted_at <> new.provider_accepted_at
    then
      raise exception 'recovery provider acceptance lineage is invalid'
        using errcode = '23514';
    end if;
  end if;

  if new.state = 'delivered'
    and old.state = 'pending_delivery'
    and not (
      new.delivery_lineage_version = 'development_sink_v1'
      and new.delivery_provider = 'development-sink'
    )
  then
    raise exception 'provider acceptance cannot claim recovery delivery'
      using errcode = '23514';
  end if;

  if new.state = 'delivered'
    and old.state = 'provider_accepted'
    and new.possession_proven_at is null
  then
    raise exception 'provider acceptance cannot claim recovery delivery'
      using errcode = '23514';
  end if;

  if new.possession_proven_at is not null
    and old.possession_proven_at is null
  then
    select * into recovery
      from ss.hosted_recovery_tokens
     where id = new.recovery_token_id;
    if recovery.id is null
      or recovery.used_at is null
      or recovery.used_at <> new.possession_proven_at
      or new.delivered_at <> new.possession_proven_at
    then
      raise exception 'recovery completion lacks possession evidence'
        using errcode = '23514';
    end if;
  elsif row(
    new.possession_evidence_digest,
    new.possession_proven_at
  ) is distinct from row(
    old.possession_evidence_digest,
    old.possession_proven_at
  ) then
    raise exception 'recovery possession evidence is transition-bound'
      using errcode = '23514';
  end if;

  return new;
end
$$;

revoke all on function
  ss.guard_hosted_registration_delivery_acceptance()
from public, anon, authenticated, service_role;
revoke all on function
  ss.validate_hosted_recovery_delivery_transition()
from public, anon, authenticated;
grant execute on function
  ss.validate_hosted_recovery_delivery_transition()
to service_role;

create function ss.hosted_identity_delivery_acceptance_contract_v1()
returns text
language sql
stable
set search_path = pg_catalog
as $$
select 'canonical-ss-hosted-identity-delivery-acceptance-v1'
$$;

revoke all on function
  ss.hosted_identity_delivery_acceptance_contract_v1()
from public, anon, authenticated, service_role;
grant execute on function
  ss.hosted_identity_delivery_acceptance_contract_v1()
to service_role;

commit;
