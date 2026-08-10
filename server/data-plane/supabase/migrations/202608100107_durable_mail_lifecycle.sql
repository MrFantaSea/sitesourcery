begin;

do $$
begin
  if to_regprocedure('ss.hosted_runtime_contract_v53()') is null
    or ss.hosted_runtime_contract_v53() <>
      'canonical-ss-v53-joint-legal-v4-authority'
    or to_regclass('ss.hosted_registration_requests') is null
    or to_regclass('ss.hosted_recovery_delivery_requests') is null
    or to_regclass('ss.support_tickets') is null
  then
    raise exception
      'joint Legal V4 and existing account/support foundations must be applied first'
      using errcode = '55000';
  end if;
end
$$;

-- This ledger stores only digests and bounded routing metadata. Recipients,
-- subjects, message bodies, action URLs, tokens, and provider payloads belong
-- outside PostgreSQL and are never accepted by this schema.
create table ss.hosted_mail_deliveries (
  id uuid primary key,
  command_id text not null unique
    check (
      char_length(command_id) between 8 and 200
      and command_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
    ),
  request_digest ss.sha256_hex not null,
  message_type text not null
    check (
      message_type in (
        'account_activation',
        'account_recovery',
        'support_notification'
      )
    ),
  organization_id uuid,
  project_id uuid,
  customer_user_id uuid references auth.users(id),
  recipient_digest ss.sha256_hex not null,
  subject_reference_digest ss.sha256_hex not null,
  content_digest ss.sha256_hex not null,
  template_version text not null
    check (
      char_length(template_version) between 2 and 80
      and template_version ~ '^[a-z0-9][a-z0-9._:-]{1,79}$'
    ),
  state text not null default 'pending'
    check (
      state in (
        'pending',
        'provider_accepted',
        'delivered',
        'bounced',
        'complained',
        'suppressed',
        'expired'
      )
    ),
  provider text
    check (
      provider is null
      or (
        char_length(provider) between 2 and 40
        and provider ~ '^[a-z][a-z0-9_-]{1,39}$'
      )
    ),
  provider_message_id_digest ss.sha256_hex,
  acceptance_command_id text
    check (
      acceptance_command_id is null
      or (
        char_length(acceptance_command_id) between 8 and 200
        and acceptance_command_id ~
          '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
      )
    ),
  acceptance_request_digest ss.sha256_hex,
  acceptance_evidence_digest ss.sha256_hex,
  expiration_command_id text
    check (
      expiration_command_id is null
      or (
        char_length(expiration_command_id) between 8 and 200
        and expiration_command_id ~
          '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
      )
    ),
  expiration_request_digest ss.sha256_hex,
  requested_at timestamptz not null,
  expires_at timestamptz not null,
  provider_accepted_at timestamptz,
  terminal_at timestamptz,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, customer_user_id)
    references ss.organization_memberships(organization_id, user_id),
  unique (provider, provider_message_id_digest),
  unique (acceptance_command_id),
  unique (expiration_command_id),
  unique (organization_id, id),
  check (expires_at > requested_at),
  check (created_at = requested_at),
  check (updated_at >= created_at),
  check (
    (message_type = 'account_activation'
      and organization_id is null
      and project_id is null
      and customer_user_id is null)
    or (message_type = 'account_recovery'
      and organization_id is null
      and project_id is null
      and customer_user_id is not null)
    or (message_type = 'support_notification'
      and organization_id is not null
      and project_id is not null
      and customer_user_id is not null)
  ),
  check (
    (state = 'pending'
      and provider is null
      and provider_message_id_digest is null
      and acceptance_command_id is null
      and acceptance_request_digest is null
      and acceptance_evidence_digest is null
      and provider_accepted_at is null
      and terminal_at is null)
    or (state = 'provider_accepted'
      and provider is not null
      and provider_message_id_digest is not null
      and acceptance_command_id is not null
      and acceptance_request_digest is not null
      and acceptance_evidence_digest is not null
      and provider_accepted_at is not null
      and provider_accepted_at >= requested_at
      and provider_accepted_at < expires_at
      and terminal_at is null)
    or (state in ('delivered', 'bounced', 'complained', 'suppressed')
      and provider is not null
      and provider_message_id_digest is not null
      and acceptance_command_id is not null
      and acceptance_request_digest is not null
      and acceptance_evidence_digest is not null
      and provider_accepted_at is not null
      and provider_accepted_at >= requested_at
      and provider_accepted_at < expires_at
      and terminal_at is not null
      and terminal_at >= provider_accepted_at)
    or (state = 'expired'
      and terminal_at is not null
      and terminal_at >= expires_at
      and num_nonnulls(
        provider,
        provider_message_id_digest,
        acceptance_command_id,
        acceptance_request_digest,
        acceptance_evidence_digest,
        provider_accepted_at
      ) in (0, 6))
  ),
  check (
    num_nonnulls(expiration_command_id, expiration_request_digest) in (0, 2)
  ),
  check (
    (state = 'expired') = (expiration_command_id is not null)
  )
);

create index hosted_mail_deliveries_expiry
  on ss.hosted_mail_deliveries(expires_at, id)
  where state in ('pending', 'provider_accepted');

create index hosted_mail_deliveries_safe_scope
  on ss.hosted_mail_deliveries(
    organization_id, project_id, requested_at desc, id
  ) where organization_id is not null;

create table ss.hosted_mail_provider_event_inbox (
  id uuid primary key,
  provider text not null
    check (
      char_length(provider) between 2 and 40
      and provider ~ '^[a-z][a-z0-9_-]{1,39}$'
    ),
  provider_event_id_digest ss.sha256_hex not null,
  provider_message_id_digest ss.sha256_hex not null,
  event_kind text not null
    check (event_kind in ('delivered', 'bounced', 'complained', 'suppressed')),
  normalized_event_digest ss.sha256_hex not null,
  signature_verification_digest ss.sha256_hex not null,
  evidence_digest ss.sha256_hex not null,
  occurred_at timestamptz not null,
  ingested_at timestamptz not null,
  state text not null default 'pending'
    check (state in ('pending', 'applied', 'conflict')),
  applied_message_id uuid references ss.hosted_mail_deliveries(id),
  applied_delivery_event_id uuid,
  resolved_at timestamptz,
  conflict_code text
    check (
      conflict_code is null
      or conflict_code in (
        'MESSAGE_NOT_PROVIDER_ACCEPTED',
        'TERMINAL_TRANSITION_CONFLICT'
      )
    ),
  created_at timestamptz not null,
  unique (provider, provider_event_id_digest),
  check (created_at = ingested_at),
  check (
    (state = 'pending'
      and applied_message_id is null
      and applied_delivery_event_id is null
      and resolved_at is null
      and conflict_code is null)
    or (state = 'applied'
      and applied_message_id is not null
      and applied_delivery_event_id is not null
      and resolved_at is not null
      and conflict_code is null)
    or (state = 'conflict'
      and resolved_at is not null
      and conflict_code is not null)
  )
);

create index hosted_mail_provider_event_inbox_pending
  on ss.hosted_mail_provider_event_inbox(
    provider, provider_message_id_digest, occurred_at, id
  ) where state = 'pending';

create table ss.hosted_mail_delivery_events (
  id uuid primary key,
  message_id uuid not null references ss.hosted_mail_deliveries(id),
  event_sequence bigint not null check (event_sequence > 0),
  predecessor_event_id uuid references ss.hosted_mail_delivery_events(id),
  event_source text not null
    check (event_source in ('application', 'provider', 'system')),
  event_kind text not null
    check (
      event_kind in (
        'provider_accepted',
        'delivered',
        'bounced',
        'complained',
        'suppressed',
        'expired'
      )
    ),
  provider text,
  provider_event_id_digest ss.sha256_hex,
  provider_message_id_digest ss.sha256_hex,
  evidence_digest ss.sha256_hex not null,
  resulting_state text not null
    check (
      resulting_state in (
        'provider_accepted',
        'delivered',
        'bounced',
        'complained',
        'suppressed',
        'expired'
      )
    ),
  occurred_at timestamptz not null,
  recorded_at timestamptz not null,
  event_digest ss.sha256_hex not null,
  created_at timestamptz not null,
  unique (message_id, event_sequence),
  unique (event_digest),
  unique (provider, provider_event_id_digest),
  check (event_kind = resulting_state),
  check (created_at = recorded_at),
  check (
    (event_source = 'application'
      and event_kind = 'provider_accepted'
      and provider is not null
      and provider_event_id_digest is null
      and provider_message_id_digest is not null)
    or (event_source = 'provider'
      and event_kind in ('delivered', 'bounced', 'complained', 'suppressed')
      and provider is not null
      and provider_event_id_digest is not null
      and provider_message_id_digest is not null)
    or (event_source = 'system'
      and event_kind = 'expired'
      and provider is null
      and provider_event_id_digest is null
      and provider_message_id_digest is null)
  )
);

alter table ss.hosted_mail_provider_event_inbox
  add constraint hosted_mail_inbox_applied_event_fk
  foreign key (applied_delivery_event_id)
  references ss.hosted_mail_delivery_events(id);

create table ss.hosted_mail_exception_projection (
  id uuid primary key,
  message_id uuid references ss.hosted_mail_deliveries(id),
  provider_inbox_event_id uuid
    references ss.hosted_mail_provider_event_inbox(id),
  organization_id uuid,
  project_id uuid,
  message_type text
    check (
      message_type is null
      or message_type in (
        'account_activation',
        'account_recovery',
        'support_notification'
      )
    ),
  exception_kind text not null
    check (
      exception_kind in (
        'unmatched_provider_event',
        'provider_event_conflict',
        'bounced',
        'complained',
        'suppressed',
        'expired'
      )
    ),
  safe_reference_digest ss.sha256_hex not null,
  state text not null default 'open' check (state in ('open', 'resolved')),
  opened_at timestamptz not null,
  resolved_at timestamptz,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  unique (message_id),
  unique (provider_inbox_event_id),
  check (created_at = opened_at),
  check (updated_at >= created_at),
  check (
    (state = 'open' and resolved_at is null)
    or (state = 'resolved' and resolved_at is not null)
  ),
  check (
    (message_id is null
      and provider_inbox_event_id is not null
      and organization_id is null
      and project_id is null
      and message_type is null
      and exception_kind = 'unmatched_provider_event')
    or (message_id is not null and message_type is not null)
  )
);

create index hosted_mail_exception_projection_open
  on ss.hosted_mail_exception_projection(opened_at, id)
  where state = 'open';

create table ss.hosted_mail_recipient_suppressions (
  recipient_digest ss.sha256_hex primary key,
  source_message_id uuid not null references ss.hosted_mail_deliveries(id),
  source_delivery_event_id uuid not null unique
    references ss.hosted_mail_delivery_events(id),
  reason text not null check (reason in ('complained', 'suppressed')),
  suppression_digest ss.sha256_hex not null unique,
  suppressed_at timestamptz not null,
  created_at timestamptz not null,
  check (created_at = suppressed_at)
);

create function ss.guard_hosted_mail_delivery()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'mail delivery projections cannot be deleted'
      using errcode = '55000';
  end if;
  if ss.current_service_actor_kind() <> 'system' then
    raise exception 'mail delivery mutation lacks system authority'
      using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    if new.state <> 'pending'
      or new.revision <> 1
      or exists (
        select 1 from ss.hosted_mail_recipient_suppressions suppression
         where suppression.recipient_digest = new.recipient_digest
      )
      or (
        new.message_type = 'account_recovery'
        and not exists (
          select 1 from auth.users account
           where account.id = new.customer_user_id
             and account.disabled_at is null
        )
      )
      or (
        new.message_type = 'support_notification'
        and not exists (
          select 1
            from ss.projects project
            join ss.organization_memberships membership
              on membership.organization_id = project.organization_id
             and membership.user_id = new.customer_user_id
           where project.organization_id = new.organization_id
             and project.id = new.project_id
             and project.lifecycle = 'active'
             and membership.state = 'active'
        )
      )
    then
      raise exception 'mail delivery reservation authority is unavailable'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if row(
    new.id, new.command_id, new.request_digest, new.message_type,
    new.organization_id, new.project_id, new.customer_user_id,
    new.recipient_digest, new.subject_reference_digest,
    new.content_digest, new.template_version, new.requested_at,
    new.expires_at, new.created_at
  ) is distinct from row(
    old.id, old.command_id, old.request_digest, old.message_type,
    old.organization_id, old.project_id, old.customer_user_id,
    old.recipient_digest, old.subject_reference_digest,
    old.content_digest, old.template_version, old.requested_at,
    old.expires_at, old.created_at
  ) or new.revision <> old.revision
  then
    raise exception 'mail delivery identity is immutable'
      using errcode = '55000';
  end if;

  if not (
    (old.state = 'pending' and new.state = 'provider_accepted')
    or (old.state in ('pending', 'provider_accepted') and new.state = 'expired')
    or (old.state = 'provider_accepted'
      and new.state in ('delivered', 'bounced', 'complained', 'suppressed'))
    or (old.state = 'delivered'
      and new.state in ('complained', 'suppressed'))
    or (old.state in ('bounced', 'complained') and new.state = 'suppressed')
  ) then
    raise exception 'mail delivery lifecycle transition is invalid'
      using errcode = '23514';
  end if;
  if old.state <> 'pending'
    and row(
      new.provider, new.provider_message_id_digest,
      new.acceptance_command_id, new.acceptance_request_digest,
      new.acceptance_evidence_digest, new.provider_accepted_at
    ) is distinct from row(
      old.provider, old.provider_message_id_digest,
      old.acceptance_command_id, old.acceptance_request_digest,
      old.acceptance_evidence_digest, old.provider_accepted_at
    )
  then
    raise exception 'mail provider acceptance evidence is immutable'
      using errcode = '55000';
  end if;
  if new.state <> 'expired'
    and row(new.expiration_command_id, new.expiration_request_digest)
      is distinct from
      row(old.expiration_command_id, old.expiration_request_digest)
  then
    raise exception 'mail expiration evidence is invalid'
      using errcode = '23514';
  end if;
  new.revision := old.revision + 1;
  new.updated_at := clock_timestamp();
  return new;
end
$$;

create trigger hosted_mail_deliveries_guard
before insert or update or delete on ss.hosted_mail_deliveries
for each row execute function ss.guard_hosted_mail_delivery();

create function ss.guard_hosted_mail_inbox()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if tg_op = 'DELETE'
    or ss.current_service_actor_kind() <> 'system'
  then
    raise exception 'mail provider inbox mutation lacks system authority'
      using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    if new.state <> 'pending' then
      raise exception 'mail provider event must begin pending'
        using errcode = '23514';
    end if;
    return new;
  end if;
  if old.state <> 'pending'
    or new.state not in ('applied', 'conflict')
    or row(
      new.id, new.provider, new.provider_event_id_digest,
      new.provider_message_id_digest, new.event_kind,
      new.normalized_event_digest, new.signature_verification_digest,
      new.evidence_digest, new.occurred_at, new.ingested_at,
      new.created_at
    ) is distinct from row(
      old.id, old.provider, old.provider_event_id_digest,
      old.provider_message_id_digest, old.event_kind,
      old.normalized_event_digest, old.signature_verification_digest,
      old.evidence_digest, old.occurred_at, old.ingested_at,
      old.created_at
    )
  then
    raise exception 'mail provider inbox transition is invalid'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger hosted_mail_provider_event_inbox_guard
before insert or update or delete on ss.hosted_mail_provider_event_inbox
for each row execute function ss.guard_hosted_mail_inbox();

create function ss.prepare_hosted_mail_delivery_event()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  previous_event record;
  message_record record;
begin
  if ss.current_service_actor_kind() <> 'system' then
    raise exception 'mail delivery event lacks system authority'
      using errcode = '42501';
  end if;
  select delivery.* into message_record
    from ss.hosted_mail_deliveries delivery
   where delivery.id = new.message_id;
  if not found or message_record.state <> new.resulting_state then
    raise exception 'mail delivery event does not match the projection'
      using errcode = '23514';
  end if;
  if new.event_source in ('application', 'provider')
    and (
      new.provider is distinct from message_record.provider
      or new.provider_message_id_digest is distinct from
        message_record.provider_message_id_digest
    )
  then
    raise exception 'mail delivery event provider binding is invalid'
      using errcode = '23514';
  end if;
  if new.event_source = 'provider'
    and not exists (
      select 1
        from ss.hosted_mail_provider_event_inbox inbox
       where inbox.provider = new.provider
         and inbox.provider_event_id_digest = new.provider_event_id_digest
         and inbox.provider_message_id_digest =
           new.provider_message_id_digest
         and inbox.event_kind = new.event_kind
         and inbox.evidence_digest = new.evidence_digest
         and inbox.occurred_at = new.occurred_at
         and inbox.state = 'pending'
    )
  then
    raise exception 'mail provider event lacks verified inbox evidence'
      using errcode = '23514';
  end if;
  select event.id, event.event_sequence into previous_event
    from ss.hosted_mail_delivery_events event
   where event.message_id = new.message_id
   order by event.event_sequence desc
   limit 1;
  new.event_sequence := coalesce(previous_event.event_sequence, 0) + 1;
  new.predecessor_event_id := previous_event.id;
  new.event_digest := ss.service_json_digest(jsonb_build_object(
    'eventKind', new.event_kind,
    'eventSequence', new.event_sequence,
    'eventSource', new.event_source,
    'evidenceDigest', new.evidence_digest,
    'messageId', new.message_id,
    'occurredAt', new.occurred_at,
    'predecessorEventId', new.predecessor_event_id,
    'provider', new.provider,
    'providerEventIdDigest', new.provider_event_id_digest,
    'providerMessageIdDigest', new.provider_message_id_digest,
    'recordedAt', new.recorded_at,
    'resultingState', new.resulting_state,
    'schema', 'sitesourcery.hosted-mail-delivery-event/v1'
  ));
  new.created_at := new.recorded_at;
  return new;
end
$$;

create trigger hosted_mail_delivery_events_prepare
before insert on ss.hosted_mail_delivery_events
for each row execute function ss.prepare_hosted_mail_delivery_event();

create trigger hosted_mail_delivery_events_immutable
before update or delete on ss.hosted_mail_delivery_events
for each row execute function ss.reject_update();

create function ss.guard_hosted_mail_exception()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if tg_op = 'DELETE'
    or ss.current_service_actor_kind() <> 'system'
  then
    raise exception 'mail exception mutation lacks system authority'
      using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    if new.state <> 'open' or new.revision <> 1 then
      raise exception 'mail exception must begin open'
        using errcode = '23514';
    end if;
    return new;
  end if;
  if old.state <> 'open'
    or new.state not in ('open', 'resolved')
    or row(
      new.id, new.message_id,
      new.organization_id, new.project_id, new.message_type,
      new.opened_at, new.created_at
    ) is distinct from row(
      old.id, old.message_id,
      old.organization_id, old.project_id, old.message_type,
      old.opened_at, old.created_at
    )
    or new.revision <> old.revision
    or (new.state = 'open' and new.resolved_at is not null)
    or (new.state = 'resolved' and new.resolved_at is null)
    or (new.message_id is null and row(
      new.provider_inbox_event_id, new.exception_kind,
      new.safe_reference_digest
    ) is distinct from row(
      old.provider_inbox_event_id, old.exception_kind,
      old.safe_reference_digest
    ))
  then
    raise exception 'mail exception transition is invalid'
      using errcode = '23514';
  end if;
  new.revision := old.revision + 1;
  new.updated_at := clock_timestamp();
  return new;
end
$$;

create trigger hosted_mail_exception_projection_guard
before insert or update or delete on ss.hosted_mail_exception_projection
for each row execute function ss.guard_hosted_mail_exception();

create function ss.guard_hosted_mail_recipient_suppression()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if tg_op <> 'INSERT'
    or ss.current_service_actor_kind() <> 'system'
    or not exists (
      select 1
        from ss.hosted_mail_deliveries delivery
        join ss.hosted_mail_delivery_events event
          on event.message_id = delivery.id
         and event.id = new.source_delivery_event_id
       where delivery.id = new.source_message_id
         and delivery.recipient_digest = new.recipient_digest
         and delivery.state = new.reason
         and event.event_source = 'provider'
         and event.event_kind = new.reason
         and event.resulting_state = new.reason
         and event.occurred_at = new.suppressed_at
    )
  then
    raise exception 'mail recipient suppression lacks provider evidence'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger hosted_mail_recipient_suppressions_guard
before insert on ss.hosted_mail_recipient_suppressions
for each row execute function ss.guard_hosted_mail_recipient_suppression();

create trigger hosted_mail_recipient_suppressions_immutable
before update or delete on ss.hosted_mail_recipient_suppressions
for each row execute function ss.reject_update();

alter table ss.hosted_mail_deliveries enable row level security;
alter table ss.hosted_mail_deliveries force row level security;
alter table ss.hosted_mail_provider_event_inbox enable row level security;
alter table ss.hosted_mail_provider_event_inbox force row level security;
alter table ss.hosted_mail_delivery_events enable row level security;
alter table ss.hosted_mail_delivery_events force row level security;
alter table ss.hosted_mail_exception_projection enable row level security;
alter table ss.hosted_mail_exception_projection force row level security;
alter table ss.hosted_mail_recipient_suppressions enable row level security;
alter table ss.hosted_mail_recipient_suppressions force row level security;

revoke all on
  ss.hosted_mail_deliveries,
  ss.hosted_mail_provider_event_inbox,
  ss.hosted_mail_delivery_events,
  ss.hosted_mail_exception_projection,
  ss.hosted_mail_recipient_suppressions
from public, anon, authenticated, service_role;

grant select, insert, update on
  ss.hosted_mail_deliveries,
  ss.hosted_mail_provider_event_inbox,
  ss.hosted_mail_exception_projection
to service_role;
grant select, insert on
  ss.hosted_mail_delivery_events,
  ss.hosted_mail_recipient_suppressions
to service_role;

revoke all on function ss.guard_hosted_mail_delivery()
from public, anon, authenticated, service_role;
revoke all on function ss.guard_hosted_mail_inbox()
from public, anon, authenticated, service_role;
revoke all on function ss.prepare_hosted_mail_delivery_event()
from public, anon, authenticated, service_role;
revoke all on function ss.guard_hosted_mail_exception()
from public, anon, authenticated, service_role;
revoke all on function ss.guard_hosted_mail_recipient_suppression()
from public, anon, authenticated, service_role;

create function ss.hosted_runtime_contract_v54()
returns text
language sql
stable
set search_path = pg_catalog
as $$
select 'canonical-ss-v54-durable-mail-lifecycle'
$$;

revoke all on function ss.hosted_runtime_contract_v54()
from public, anon, authenticated, service_role;
grant execute on function ss.hosted_runtime_contract_v54()
to service_role;

commit;
