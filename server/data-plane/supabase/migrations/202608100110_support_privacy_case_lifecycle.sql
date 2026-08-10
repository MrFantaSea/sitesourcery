begin;

do $$
begin
  if to_regprocedure('ss.hosted_runtime_contract_v54()') is null
    or ss.hosted_runtime_contract_v54() <>
      'canonical-ss-v54-durable-mail-lifecycle'
    or to_regclass('ss.hosted_mail_deliveries') is null
    or to_regprocedure(
      'ss.service_operator_has_capability(uuid,text,timestamp with time zone)'
    ) is null
  then
    raise exception
      'MAIL-01 and operator authority must be applied before SUPPORT-CASE-01'
      using errcode = '55000';
  end if;
end
$$;

-- This is a case/audit authority, not a correspondence store. Contact values,
-- message bodies, identity documents, exported data, and deletion instructions
-- are deliberately outside these tables. Only bounded classifications and
-- opaque SHA-256/HMAC evidence references are accepted.
create table ss.hosted_support_cases (
  id uuid primary key,
  opening_command_id text not null unique
    check (
      char_length(opening_command_id) between 8 and 200
      and opening_command_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
    ),
  opening_request_digest ss.sha256_hex not null,
  intake_channel text not null
    check (intake_channel in ('authenticated', 'phone', 'email', 'manual')),
  request_kind text not null
    check (
      request_kind in (
        'support', 'access', 'correction', 'export', 'deletion', 'appeal'
      )
    ),
  scope_kind text not null check (scope_kind in ('general', 'account', 'project')),
  organization_id uuid,
  project_id uuid,
  requester_user_id uuid references auth.users(id),
  requester_reference_digest ss.sha256_hex not null,
  parent_case_id uuid references ss.hosted_support_cases(id),
  identity_state text not null
    check (
      identity_state in (
        'unverified',
        'session_authenticated',
        'verification_pending',
        'verified',
        'not_required',
        'unable_to_verify'
      )
    ),
  identity_evidence_digest ss.sha256_hex,
  identity_updated_at timestamptz,
  state text not null default 'open'
    check (
      state in (
        'open', 'assigned', 'in_review', 'responded', 'denied',
        'appeal_pending', 'closed'
      )
    ),
  assigned_operator_user_id uuid references auth.users(id),
  assigned_at timestamptz,
  response_due_at timestamptz,
  deadline_basis_digest ss.sha256_hex,
  response_digest ss.sha256_hex,
  responded_at timestamptz,
  denial_reason_code text
    check (
      denial_reason_code is null
      or denial_reason_code in (
        'identity_not_verified',
        'request_not_supported',
        'legal_exception',
        'records_not_found',
        'duplicate_request',
        'other_reviewed'
      )
    ),
  denial_explanation_digest ss.sha256_hex,
  denied_at timestamptz,
  appeal_available boolean not null default false,
  appeal_due_at timestamptz,
  appeal_basis_digest ss.sha256_hex,
  closure_reason_code text
    check (
      closure_reason_code is null
      or closure_reason_code in (
        'completed',
        'appeal_window_elapsed',
        'withdrawn',
        'duplicate',
        'superseded',
        'no_further_action'
      )
    ),
  closed_at timestamptz,
  opened_at timestamptz not null,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, requester_user_id)
    references ss.organization_memberships(organization_id, user_id),
  unique (organization_id, id),
  check (created_at = opened_at),
  check (updated_at >= created_at),
  check (
    (scope_kind = 'general'
      and organization_id is null
      and project_id is null
      and requester_user_id is null)
    or (scope_kind = 'account'
      and organization_id is not null
      and project_id is null
      and requester_user_id is not null)
    or (scope_kind = 'project'
      and organization_id is not null
      and project_id is not null
      and requester_user_id is not null)
  ),
  check (
    (intake_channel = 'authenticated'
      and scope_kind in ('account', 'project')
      and requester_user_id is not null
      and identity_state <> 'unverified')
    or intake_channel in ('phone', 'email', 'manual')
  ),
  check (
    (request_kind = 'appeal' and parent_case_id is not null)
    or (request_kind <> 'appeal' and parent_case_id is null)
  ),
  check (
    (identity_state in ('unverified', 'session_authenticated')
      and identity_evidence_digest is null
      and identity_updated_at is null)
    or (identity_state in (
        'verification_pending', 'verified', 'not_required', 'unable_to_verify'
      )
      and identity_evidence_digest is not null
      and identity_updated_at is not null)
  ),
  check (
    num_nonnulls(response_due_at, deadline_basis_digest) in (0, 2)
  ),
  check (num_nonnulls(response_digest, responded_at) in (0, 2)),
  check (
    num_nonnulls(
      denial_reason_code, denial_explanation_digest, denied_at
    ) in (0, 3)
  ),
  check (not (response_digest is not null and denial_reason_code is not null)),
  check (
    num_nonnulls(closure_reason_code, closed_at) in (0, 2)
  ),
  check (
    (assigned_operator_user_id is null and assigned_at is null)
    or (assigned_operator_user_id is not null and assigned_at is not null)
  ),
  check (
    (state = 'open'
      and assigned_operator_user_id is null
      and response_digest is null
      and responded_at is null
      and denial_reason_code is null
      and denial_explanation_digest is null
      and denied_at is null
      and closed_at is null)
    or (state in ('assigned', 'in_review')
      and assigned_operator_user_id is not null
      and response_digest is null
      and responded_at is null
      and denial_reason_code is null
      and denial_explanation_digest is null
      and denied_at is null
      and closed_at is null)
    or (state = 'responded'
      and assigned_operator_user_id is not null
      and response_digest is not null
      and responded_at is not null
      and denial_reason_code is null
      and denial_explanation_digest is null
      and denied_at is null
      and not appeal_available
      and appeal_due_at is null
      and appeal_basis_digest is null
      and closed_at is null)
    or (state in ('denied', 'appeal_pending')
      and assigned_operator_user_id is not null
      and response_digest is null
      and responded_at is null
      and denial_reason_code is not null
      and denial_explanation_digest is not null
      and denied_at is not null
      and closed_at is null)
    or (state = 'closed'
      and assigned_operator_user_id is not null
      and closure_reason_code is not null
      and closed_at is not null)
  ),
  check (
    (appeal_available
      and denial_reason_code is not null
      and appeal_due_at is not null
      and appeal_basis_digest is not null
      and appeal_due_at > denied_at)
    or (not appeal_available
      and appeal_due_at is null
      and appeal_basis_digest is null)
  ),
  check (assigned_at is null or assigned_at >= opened_at),
  check (identity_updated_at is null or identity_updated_at >= opened_at),
  check (response_due_at is null or response_due_at > opened_at),
  check (responded_at is null or responded_at >= opened_at),
  check (denied_at is null or denied_at >= opened_at),
  check (closed_at is null or closed_at >= opened_at)
);

create index hosted_support_cases_customer
  on ss.hosted_support_cases(
    organization_id, requester_user_id, opened_at desc, id
  ) where requester_user_id is not null;

create index hosted_support_cases_owner_queue
  on ss.hosted_support_cases(state, response_due_at, opened_at, id)
  where state not in ('closed');

create unique index hosted_support_cases_one_appeal
  on ss.hosted_support_cases(parent_case_id)
  where request_kind = 'appeal';

create table ss.hosted_support_case_commands (
  id uuid primary key,
  command_id text not null unique
    check (
      char_length(command_id) between 8 and 200
      and command_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
    ),
  case_id uuid not null references ss.hosted_support_cases(id),
  action text not null
    check (
      action in (
        'open', 'assign', 'identity_update', 'deadline_set',
        'review_start', 'respond', 'deny', 'appeal_open', 'close',
        'evidence_add', 'notification_reserve'
      )
    ),
  actor_kind text not null check (actor_kind in ('customer', 'operator', 'system')),
  actor_user_id uuid references auth.users(id),
  request_digest ss.sha256_hex not null,
  result_digest ss.sha256_hex not null,
  recorded_at timestamptz not null,
  created_at timestamptz not null,
  unique (case_id, id),
  check (created_at = recorded_at),
  check (
    (actor_kind in ('customer', 'operator') and actor_user_id is not null)
    or (actor_kind = 'system' and actor_user_id is null)
  )
);

create index hosted_support_case_commands_case
  on ss.hosted_support_case_commands(case_id, recorded_at, id);

create table ss.hosted_support_case_evidence (
  id uuid primary key,
  case_id uuid not null references ss.hosted_support_cases(id),
  evidence_kind text not null
    check (
      evidence_kind in (
        'request_scope', 'identity_verification', 'correspondence',
        'deadline_basis', 'response', 'denial', 'appeal', 'closure'
      )
    ),
  source_kind text not null check (source_kind in ('requester', 'operator', 'system')),
  evidence_digest ss.sha256_hex not null,
  recorded_at timestamptz not null,
  created_at timestamptz not null,
  unique (case_id, evidence_digest),
  check (created_at = recorded_at)
);

create table ss.hosted_support_case_events (
  id uuid primary key,
  case_id uuid not null references ss.hosted_support_cases(id),
  event_sequence bigint not null check (event_sequence > 0),
  predecessor_event_id uuid references ss.hosted_support_case_events(id),
  event_kind text not null
    check (
      event_kind in (
        'opened', 'assigned', 'identity_updated', 'deadline_set',
        'review_started', 'response_recorded', 'denied',
        'appeal_opened', 'appeal_received', 'closed',
        'evidence_added', 'notification_reserved'
      )
    ),
  actor_kind text not null check (actor_kind in ('customer', 'operator', 'system')),
  actor_user_id uuid references auth.users(id),
  evidence_digest ss.sha256_hex not null,
  occurred_at timestamptz not null,
  recorded_at timestamptz not null,
  event_digest ss.sha256_hex not null,
  created_at timestamptz not null,
  unique (case_id, event_sequence),
  unique (event_digest),
  check (created_at = recorded_at),
  check (
    (actor_kind in ('customer', 'operator') and actor_user_id is not null)
    or (actor_kind = 'system' and actor_user_id is null)
  )
);

create table ss.hosted_support_case_mail_reservations (
  id uuid primary key,
  case_id uuid not null references ss.hosted_support_cases(id),
  notification_kind text not null
    check (
      notification_kind in (
        'acknowledgment', 'response', 'denial', 'appeal_acknowledgment', 'closure'
      )
    ),
  mail_message_id uuid not null unique references ss.hosted_mail_deliveries(id),
  reservation_digest ss.sha256_hex not null unique,
  reserved_at timestamptz not null,
  created_at timestamptz not null,
  unique (case_id, notification_kind),
  check (created_at = reserved_at)
);

create function ss.guard_hosted_support_case()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  actor_kind text := ss.current_service_actor_kind();
  actor_user_id uuid := ss.current_service_actor_user_id();
  actor_org_id uuid := ss.current_service_actor_org_id();
begin
  if tg_op = 'DELETE' then
    raise exception 'support case projections cannot be deleted'
      using errcode = '55000';
  end if;
  if actor_kind not in ('customer', 'operator', 'system') then
    raise exception 'support case mutation lacks actor authority'
      using errcode = '42501';
  end if;
  if actor_kind = 'operator'
    and not ss.service_operator_has_capability(
      actor_user_id, 'service_case_manage', clock_timestamp()
    )
  then
    raise exception 'support case operator lacks current authority'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if new.state <> 'open'
      or new.revision <> 1
      or (
        new.intake_channel = 'authenticated'
        and new.identity_state <> 'session_authenticated'
      )
      or (
        new.intake_channel <> 'authenticated'
        and new.identity_state <> 'unverified'
      )
      or (
        new.intake_channel = 'authenticated'
        and (
          actor_kind <> 'customer'
          or actor_user_id is distinct from new.requester_user_id
          or actor_org_id is distinct from new.organization_id
        )
      )
      or (
        new.intake_channel <> 'authenticated'
        and actor_kind not in ('operator', 'system')
      )
      or (
        new.scope_kind = 'account'
        and not exists (
          select 1
            from ss.organizations organization
            join ss.organization_memberships membership
              on membership.organization_id = organization.id
             and membership.user_id = new.requester_user_id
           where organization.id = new.organization_id
             and organization.state = 'active'
             and membership.state = 'active'
        )
      )
      or (
        new.scope_kind = 'project'
        and not exists (
          select 1
            from ss.projects project
            join ss.organizations organization
              on organization.id = project.organization_id
            join ss.organization_memberships membership
              on membership.organization_id = project.organization_id
             and membership.user_id = new.requester_user_id
           where project.organization_id = new.organization_id
             and project.id = new.project_id
             and organization.state = 'active'
             and project.lifecycle = 'active'
             and membership.state = 'active'
        )
      )
      or (
        new.request_kind = 'appeal'
        and not exists (
          select 1
            from ss.hosted_support_cases parent
           where parent.id = new.parent_case_id
             and parent.state = 'denied'
             and parent.request_kind <> 'appeal'
             and parent.appeal_available
             and parent.appeal_due_at >= new.opened_at
             and parent.organization_id is not distinct from new.organization_id
             and parent.project_id is not distinct from new.project_id
             and parent.requester_user_id is not distinct from
               new.requester_user_id
        )
      )
    then
      raise exception 'support case opening authority is unavailable'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if row(
    new.id, new.opening_command_id, new.opening_request_digest,
    new.intake_channel, new.request_kind, new.scope_kind,
    new.organization_id, new.project_id, new.requester_user_id,
    new.requester_reference_digest, new.parent_case_id,
    new.opened_at, new.created_at
  ) is distinct from row(
    old.id, old.opening_command_id, old.opening_request_digest,
    old.intake_channel, old.request_kind, old.scope_kind,
    old.organization_id, old.project_id, old.requester_user_id,
    old.requester_reference_digest, old.parent_case_id,
    old.opened_at, old.created_at
  ) or new.revision <> old.revision
  then
    raise exception 'support case identity is immutable'
      using errcode = '55000';
  end if;

  if actor_kind = 'customer'
    and not (
      old.state = 'denied'
      and new.state = 'appeal_pending'
      and old.appeal_available
      and old.appeal_due_at >= clock_timestamp()
      and exists (
        select 1
          from ss.hosted_support_cases appeal
         where appeal.parent_case_id = old.id
           and appeal.request_kind = 'appeal'
      )
      and row(
        new.identity_state, new.identity_evidence_digest,
        new.identity_updated_at, new.assigned_operator_user_id,
        new.assigned_at, new.response_due_at,
        new.deadline_basis_digest, new.response_digest,
        new.responded_at, new.denial_reason_code,
        new.denial_explanation_digest, new.denied_at,
        new.appeal_available, new.appeal_due_at,
        new.appeal_basis_digest, new.closure_reason_code,
        new.closed_at
      ) is not distinct from row(
        old.identity_state, old.identity_evidence_digest,
        old.identity_updated_at, old.assigned_operator_user_id,
        old.assigned_at, old.response_due_at,
        old.deadline_basis_digest, old.response_digest,
        old.responded_at, old.denial_reason_code,
        old.denial_explanation_digest, old.denied_at,
        old.appeal_available, old.appeal_due_at,
        old.appeal_basis_digest, old.closure_reason_code,
        old.closed_at
      )
    )
  then
    raise exception 'customer support case transition is invalid'
      using errcode = '42501';
  end if;

  if old.assigned_operator_user_id is not null
    and row(new.assigned_operator_user_id, new.assigned_at)
      is distinct from row(old.assigned_operator_user_id, old.assigned_at)
  then
    raise exception 'support case assignment is immutable'
      using errcode = '55000';
  end if;
  if new.assigned_operator_user_id is not null
    and not ss.service_operator_has_capability(
      new.assigned_operator_user_id,
      'service_case_manage',
      clock_timestamp()
    )
  then
    raise exception 'assigned support operator lacks current authority'
      using errcode = '42501';
  end if;

  if old.identity_state <> new.identity_state
    and not (
      old.identity_state in ('unverified', 'session_authenticated')
      and new.identity_state in (
        'verification_pending', 'verified', 'not_required', 'unable_to_verify'
      )
      or old.identity_state = 'verification_pending'
      and new.identity_state in ('verified', 'not_required', 'unable_to_verify')
    )
  then
    raise exception 'support identity verification transition is invalid'
      using errcode = '23514';
  end if;
  if old.identity_state in ('verified', 'not_required', 'unable_to_verify')
    and row(
      new.identity_state, new.identity_evidence_digest,
      new.identity_updated_at
    ) is distinct from row(
      old.identity_state, old.identity_evidence_digest,
      old.identity_updated_at
    )
  then
    raise exception 'terminal identity verification is immutable'
      using errcode = '55000';
  end if;
  if old.state in ('responded', 'denied', 'appeal_pending', 'closed')
    and row(new.response_due_at, new.deadline_basis_digest)
      is distinct from row(old.response_due_at, old.deadline_basis_digest)
  then
    raise exception 'terminal support deadline is immutable'
      using errcode = '55000';
  end if;

  if old.state <> new.state
    and not (
      (old.state = 'open' and new.state = 'assigned')
      or (old.state = 'assigned' and new.state = 'in_review')
      or (old.state in ('assigned', 'in_review')
        and new.state in ('responded', 'denied', 'closed'))
      or (old.state = 'responded' and new.state = 'closed')
      or (old.state = 'denied' and new.state in ('appeal_pending', 'closed'))
      or (old.state = 'appeal_pending' and new.state = 'closed')
    )
  then
    raise exception 'support case lifecycle transition is invalid'
      using errcode = '23514';
  end if;

  if new.state = 'responded'
    and not (
      new.response_due_at is not null
      and (
        new.request_kind = 'support'
        and new.identity_state in (
          'session_authenticated', 'verified', 'not_required'
        )
        or new.request_kind <> 'support'
        and new.identity_state = 'verified'
      )
    )
  then
    raise exception 'support response lacks deadline or identity authority'
      using errcode = '23514';
  end if;
  if new.state = 'denied'
    and not (
      new.response_due_at is not null
      and new.identity_state in ('verified', 'unable_to_verify')
    )
  then
    raise exception 'support denial lacks deadline or identity authority'
      using errcode = '23514';
  end if;
  if new.state = 'closed' and old.state = 'appeal_pending'
    and not exists (
      select 1
        from ss.hosted_support_cases appeal
       where appeal.parent_case_id = old.id
         and appeal.request_kind = 'appeal'
         and appeal.state = 'closed'
    )
  then
    raise exception 'appealed support case cannot close before its appeal'
      using errcode = '23514';
  end if;
  if new.state = 'closed'
    and old.state = 'denied'
    and old.appeal_available
    and old.appeal_due_at >= clock_timestamp()
  then
    raise exception 'denied support case remains inside its appeal window'
      using errcode = '23514';
  end if;

  new.revision := old.revision + 1;
  new.updated_at := clock_timestamp();
  return new;
end
$$;

create trigger hosted_support_cases_guard
before insert or update or delete on ss.hosted_support_cases
for each row execute function ss.guard_hosted_support_case();

create function ss.guard_hosted_support_case_command()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  current_kind text := ss.current_service_actor_kind();
  selected_actor_user_id uuid := ss.current_service_actor_user_id();
begin
  if tg_op <> 'INSERT'
    or new.actor_kind <> current_kind
    or new.actor_user_id is distinct from selected_actor_user_id
    or (
      current_kind = 'operator'
      and not ss.service_operator_has_capability(
        selected_actor_user_id, 'service_case_manage', clock_timestamp()
      )
    )
  then
    raise exception 'support case command lacks exact actor authority'
      using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger hosted_support_case_commands_guard
before insert on ss.hosted_support_case_commands
for each row execute function ss.guard_hosted_support_case_command();

create trigger hosted_support_case_commands_immutable
before update or delete on ss.hosted_support_case_commands
for each row execute function ss.reject_update();

create function ss.guard_hosted_support_case_evidence()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  current_kind text := ss.current_service_actor_kind();
  selected_actor_user_id uuid := ss.current_service_actor_user_id();
begin
  if tg_op <> 'INSERT'
    or current_kind not in ('customer', 'operator', 'system')
    or (new.source_kind = 'requester' and current_kind <> 'customer')
    or (new.source_kind = 'operator' and current_kind <> 'operator')
    or (new.source_kind = 'system' and current_kind <> 'system')
    or (
      current_kind = 'operator'
      and not ss.service_operator_has_capability(
        selected_actor_user_id, 'service_case_manage', clock_timestamp()
      )
    )
  then
    raise exception 'support case evidence lacks exact actor authority'
      using errcode = '42501';
  end if;
  perform 1 from ss.hosted_support_cases where id = new.case_id for update;
  if not found or (
    select count(*) from ss.hosted_support_case_evidence
     where case_id = new.case_id
  ) >= 24 then
    raise exception 'support case evidence boundary is unavailable'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger hosted_support_case_evidence_guard
before insert on ss.hosted_support_case_evidence
for each row execute function ss.guard_hosted_support_case_evidence();

create trigger hosted_support_case_evidence_immutable
before update or delete on ss.hosted_support_case_evidence
for each row execute function ss.reject_update();

create function ss.prepare_hosted_support_case_event()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  current_kind text := ss.current_service_actor_kind();
  selected_actor_user_id uuid := ss.current_service_actor_user_id();
  previous_event record;
  selected_case record;
begin
  if current_kind not in ('customer', 'operator', 'system')
    or new.actor_kind <> current_kind
    or new.actor_user_id is distinct from selected_actor_user_id
    or (
      current_kind = 'operator'
      and not ss.service_operator_has_capability(
        selected_actor_user_id, 'service_case_manage', clock_timestamp()
      )
    )
  then
    raise exception 'support case event lacks exact actor authority'
      using errcode = '42501';
  end if;
  select support_case.* into selected_case
    from ss.hosted_support_cases support_case
   where support_case.id = new.case_id;
  if not found
    or (new.event_kind = 'opened' and selected_case.state <> 'open')
    or (new.event_kind = 'assigned' and selected_case.state <> 'assigned')
    or (new.event_kind = 'review_started' and selected_case.state <> 'in_review')
    or (new.event_kind = 'response_recorded' and selected_case.state <> 'responded')
    or (new.event_kind = 'denied' and selected_case.state <> 'denied')
    or (new.event_kind = 'appeal_opened' and selected_case.request_kind <> 'appeal')
    or (new.event_kind = 'appeal_received' and selected_case.state <> 'appeal_pending')
    or (new.event_kind = 'closed' and selected_case.state <> 'closed')
  then
    raise exception 'support case event does not match its projection'
      using errcode = '23514';
  end if;
  select event.id, event.event_sequence into previous_event
    from ss.hosted_support_case_events event
   where event.case_id = new.case_id
   order by event.event_sequence desc
   limit 1;
  new.event_sequence := coalesce(previous_event.event_sequence, 0) + 1;
  new.predecessor_event_id := previous_event.id;
  new.event_digest := ss.service_json_digest(jsonb_build_object(
    'actorKind', new.actor_kind,
    'actorUserId', new.actor_user_id,
    'caseId', new.case_id,
    'eventKind', new.event_kind,
    'eventSequence', new.event_sequence,
    'evidenceDigest', new.evidence_digest,
    'occurredAt', new.occurred_at,
    'predecessorEventId', new.predecessor_event_id,
    'recordedAt', new.recorded_at,
    'schema', 'sitesourcery.hosted-support-case-event/v1'
  ));
  new.created_at := new.recorded_at;
  return new;
end
$$;

create trigger hosted_support_case_events_prepare
before insert on ss.hosted_support_case_events
for each row execute function ss.prepare_hosted_support_case_event();

create trigger hosted_support_case_events_immutable
before update or delete on ss.hosted_support_case_events
for each row execute function ss.reject_update();

create function ss.guard_hosted_support_case_mail_reservation()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  current_kind text := ss.current_service_actor_kind();
  selected_actor_user_id uuid := ss.current_service_actor_user_id();
begin
  if tg_op <> 'INSERT'
    or current_kind not in ('operator', 'system')
    or (
      current_kind = 'operator'
      and not ss.service_operator_has_capability(
        selected_actor_user_id, 'service_case_manage', clock_timestamp()
      )
    )
    or not exists (
      select 1
        from ss.hosted_support_cases support_case
        join ss.hosted_mail_deliveries delivery
          on delivery.id = new.mail_message_id
       where support_case.id = new.case_id
         and support_case.scope_kind = 'project'
         and support_case.requester_user_id is not null
         and delivery.message_type = 'support_notification'
         and delivery.state = 'pending'
         and delivery.organization_id = support_case.organization_id
         and delivery.project_id = support_case.project_id
         and delivery.customer_user_id = support_case.requester_user_id
    )
  then
    raise exception 'support notification lacks one pending MAIL-01 reservation'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger hosted_support_case_mail_reservations_guard
before insert on ss.hosted_support_case_mail_reservations
for each row execute function ss.guard_hosted_support_case_mail_reservation();

create trigger hosted_support_case_mail_reservations_immutable
before update or delete on ss.hosted_support_case_mail_reservations
for each row execute function ss.reject_update();

alter table ss.hosted_support_cases enable row level security;
alter table ss.hosted_support_cases force row level security;
alter table ss.hosted_support_case_commands enable row level security;
alter table ss.hosted_support_case_commands force row level security;
alter table ss.hosted_support_case_evidence enable row level security;
alter table ss.hosted_support_case_evidence force row level security;
alter table ss.hosted_support_case_events enable row level security;
alter table ss.hosted_support_case_events force row level security;
alter table ss.hosted_support_case_mail_reservations enable row level security;
alter table ss.hosted_support_case_mail_reservations force row level security;

revoke all on
  ss.hosted_support_cases,
  ss.hosted_support_case_commands,
  ss.hosted_support_case_evidence,
  ss.hosted_support_case_events,
  ss.hosted_support_case_mail_reservations
from public, anon, authenticated, service_role;

grant select, insert, update on ss.hosted_support_cases to service_role;
grant select, insert on
  ss.hosted_support_case_commands,
  ss.hosted_support_case_evidence,
  ss.hosted_support_case_events,
  ss.hosted_support_case_mail_reservations
to service_role;

revoke all on function ss.guard_hosted_support_case()
from public, anon, authenticated, service_role;
revoke all on function ss.guard_hosted_support_case_command()
from public, anon, authenticated, service_role;
revoke all on function ss.guard_hosted_support_case_evidence()
from public, anon, authenticated, service_role;
revoke all on function ss.prepare_hosted_support_case_event()
from public, anon, authenticated, service_role;
revoke all on function ss.guard_hosted_support_case_mail_reservation()
from public, anon, authenticated, service_role;

create function ss.hosted_support_case_contract_v1()
returns text
language sql
stable
set search_path = pg_catalog
as $$
select 'canonical-support-case-v1-auditable-held-lifecycle'
$$;

revoke all on function ss.hosted_support_case_contract_v1()
from public, anon, authenticated, service_role;
grant execute on function ss.hosted_support_case_contract_v1()
to service_role;

commit;
