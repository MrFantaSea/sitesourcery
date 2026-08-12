-- MAIL-ROUTE-DISPATCH-02
begin;

do $$
begin
  if to_regprocedure('ss.hosted_runtime_contract_v54()') is null
    or ss.hosted_runtime_contract_v54() <>
      'canonical-ss-v54-durable-mail-lifecycle'
    or to_regprocedure('ss.hosted_support_case_contract_v1()') is null
    or ss.hosted_support_case_contract_v1() <>
      'canonical-support-case-v1-auditable-held-lifecycle'
    or to_regprocedure('ss.hosted_commerce_notification_contract_v1()') is null
    or ss.hosted_commerce_notification_contract_v1() <>
      'canonical-commerce-transition-notifications-v1-mail-reserved-held'
  then
    raise exception
      'MAIL-01 and held support/commerce notification authority must be applied first'
      using errcode = '55000';
  end if;
end
$$;

-- One row per durable MAIL-01 reservation. Private routing/template values and
-- provider identifiers are deliberately absent. The provider idempotency key
-- is derived from message_id by application code and never needs storage.
create table ss.hosted_mail_dispatch_claims (
  message_id uuid primary key references ss.hosted_mail_deliveries(id),
  source_kind text not null check (source_kind in ('support', 'commerce')),
  source_reservation_id uuid not null,
  source_reservation_digest ss.sha256_hex not null,
  claim_command_id text not null unique check (
    char_length(claim_command_id) between 8 and 200
    and claim_command_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
  ),
  claim_request_digest ss.sha256_hex not null,
  state text not null default 'claimed'
    check (state in ('claimed', 'closed')),
  worker_id text check (
    worker_id is null
    or (
      char_length(worker_id) between 8 and 200
      and worker_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
    )
  ),
  attempt_number bigint not null default 1
    check (attempt_number between 1 and 9007199254740991),
  fence_token bigint not null default 1
    check (fence_token between 1 and 9007199254740991),
  lease_started_at timestamptz,
  lease_expires_at timestamptz,
  lifecycle_state text check (
    lifecycle_state is null
    or lifecycle_state in (
      'provider_accepted', 'delivered', 'bounced', 'complained',
      'suppressed', 'expired'
    )
  ),
  closure_evidence_digest ss.sha256_hex,
  closed_at timestamptz,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (source_kind, source_reservation_id),
  check (updated_at >= created_at),
  check (
    (state = 'claimed'
      and worker_id is not null
      and lease_started_at is not null
      and lease_expires_at > lease_started_at
      and lease_expires_at >= lease_started_at + interval '30 seconds'
      and lease_expires_at <= lease_started_at + interval '5 minutes'
      and lifecycle_state is null
      and closure_evidence_digest is null
      and closed_at is null)
    or (state = 'closed'
      and worker_id is null
      and lease_started_at is null
      and lease_expires_at is null
      and lifecycle_state is not null
      and closure_evidence_digest is not null
      and closed_at is not null)
  )
);

create index hosted_mail_dispatch_claims_open_lease
  on ss.hosted_mail_dispatch_claims(lease_expires_at, message_id)
  where state = 'claimed';

create function ss.hosted_mail_dispatch_claim_digest(
  selected_message_id uuid,
  selected_source_kind text,
  selected_source_reservation_id uuid,
  selected_source_reservation_digest ss.sha256_hex
)
returns ss.sha256_hex
language sql
immutable
parallel safe
set search_path = pg_catalog, ss
as $$
  select ss.service_json_digest(jsonb_build_object(
    'messageId', selected_message_id,
    'schema', 'sitesourcery.notification-mail-dispatch-claim/v1',
    'sourceKind', selected_source_kind,
    'sourceReservationDigest', selected_source_reservation_digest,
    'sourceReservationId', selected_source_reservation_id
  ))
$$;

create function ss.guard_hosted_mail_dispatch_claim()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  selected_delivery ss.hosted_mail_deliveries%rowtype;
begin
  if tg_op = 'DELETE' then
    raise exception 'mail dispatch claims cannot be deleted'
      using errcode = '55000';
  end if;
  if ss.current_service_actor_kind() <> 'system' then
    raise exception 'mail dispatch claim mutation lacks system authority'
      using errcode = '42501';
  end if;

  select * into strict selected_delivery
    from ss.hosted_mail_deliveries delivery
   where delivery.id = new.message_id;

  if tg_op = 'INSERT' then
    if new.state <> 'claimed'
      or new.attempt_number <> 1
      or new.fence_token <> 1
      or new.revision <> 1
      or new.created_at <> new.lease_started_at
      or new.updated_at <> new.created_at
      or selected_delivery.state <> 'pending'
      or selected_delivery.expires_at <= new.lease_expires_at
      or new.claim_command_id <> ('notify-claim:' || new.message_id::text)
      or new.claim_request_digest <> ss.hosted_mail_dispatch_claim_digest(
        new.message_id,
        new.source_kind,
        new.source_reservation_id,
        new.source_reservation_digest
      )
      or not (
        (new.source_kind = 'support' and exists (
          select 1
            from ss.hosted_support_case_mail_reservations reservation
           where reservation.id = new.source_reservation_id
             and reservation.mail_message_id = new.message_id
             and reservation.reservation_digest =
               new.source_reservation_digest
             and selected_delivery.message_type = 'support_notification'
        ))
        or (new.source_kind = 'commerce' and exists (
          select 1
            from ss.commerce_transition_notification_outbox reservation
           where reservation.id = new.source_reservation_id
             and reservation.mail_message_id = new.message_id
             and reservation.reservation_digest =
               new.source_reservation_digest
             and reservation.state = 'held'
             and not reservation.provider_effects_authorized
             and not reservation.delivery_claimed
             and selected_delivery.message_type in (
               'commerce_customer_notification',
               'commerce_operator_notification'
             )
        ))
      )
    then
      raise exception 'mail dispatch claim lacks an exact held reservation'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if row(
    new.message_id, new.source_kind, new.source_reservation_id,
    new.source_reservation_digest, new.claim_command_id,
    new.claim_request_digest, new.created_at
  ) is distinct from row(
    old.message_id, old.source_kind, old.source_reservation_id,
    old.source_reservation_digest, old.claim_command_id,
    old.claim_request_digest, old.created_at
  ) or old.state = 'closed'
  then
    raise exception 'mail dispatch claim identity is immutable'
      using errcode = '55000';
  end if;

  if new.state = 'claimed' then
    if old.state <> 'claimed'
      or old.lease_expires_at > new.lease_started_at
      or new.attempt_number <> old.attempt_number + 1
      or new.fence_token <> old.fence_token + 1
      or new.lifecycle_state is not null
      or new.closure_evidence_digest is not null
      or new.closed_at is not null
      or selected_delivery.state <> 'pending'
      or selected_delivery.expires_at <= new.lease_expires_at
    then
      raise exception 'mail dispatch reclaim lacks an expired predecessor'
        using errcode = '23514';
    end if;
  elsif new.state = 'closed' then
    if old.state <> 'claimed'
      or new.worker_id is not null
      or new.lease_started_at is not null
      or new.lease_expires_at is not null
      or new.attempt_number <> old.attempt_number
      or new.fence_token <> old.fence_token
      or new.lifecycle_state <> selected_delivery.state
      or selected_delivery.state = 'pending'
      or new.closure_evidence_digest is distinct from coalesce(
        selected_delivery.acceptance_evidence_digest,
        selected_delivery.expiration_request_digest
      )
      or new.closed_at < old.lease_started_at
    then
      raise exception 'mail dispatch closure lacks exact MAIL-01 evidence'
        using errcode = '23514';
    end if;
  else
    raise exception 'mail dispatch claim transition is invalid'
      using errcode = '23514';
  end if;

  new.revision := old.revision + 1;
  new.updated_at := greatest(
    clock_timestamp(), old.updated_at + interval '1 microsecond'
  );
  return new;
end
$$;

create trigger hosted_mail_dispatch_claims_guard
before insert or update or delete on ss.hosted_mail_dispatch_claims
for each row execute function ss.guard_hosted_mail_dispatch_claim();

alter table ss.hosted_mail_dispatch_claims enable row level security;
alter table ss.hosted_mail_dispatch_claims force row level security;

revoke all on ss.hosted_mail_dispatch_claims
from public, anon, authenticated, service_role;
grant select, insert, update on ss.hosted_mail_dispatch_claims
to service_role;

revoke all on function ss.guard_hosted_mail_dispatch_claim()
from public, anon, authenticated, service_role;
revoke all on function ss.hosted_mail_dispatch_claim_digest(
  uuid, text, uuid, ss.sha256_hex
)
from public, anon, authenticated;
grant execute on function ss.hosted_mail_dispatch_claim_digest(
  uuid, text, uuid, ss.sha256_hex
)
to service_role;

create function ss.hosted_mail_dispatch_contract_v1()
returns text
language sql
stable
set search_path = pg_catalog
as $$
select 'canonical-mail-dispatch-v1-leased-digest-only-held'
$$;

revoke all on function ss.hosted_mail_dispatch_contract_v1()
from public, anon, authenticated, service_role;
grant execute on function ss.hosted_mail_dispatch_contract_v1()
to service_role;

commit;
