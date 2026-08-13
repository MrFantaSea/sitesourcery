-- PROVIDER-RECONCILIATION-01
begin;

do $$
begin
  if to_regprocedure('ss.hosted_responder_fulfillment_queue_contract_v1()')
      is null
    or ss.hosted_responder_fulfillment_queue_contract_v1() <>
      'canonical-responder-fulfillment-queue-v1-held-default'
    or to_regprocedure(
      'ss.hosted_responder_twilio_delivery_events_contract_v1()'
    ) is null
    or ss.hosted_responder_twilio_delivery_events_contract_v1() <>
      'canonical-responder-twilio-delivery-events-v1-digest-only-race-safe'
    or to_regprocedure('ss.hosted_responder_twilio_inbound_contract_v1()')
      is null
    or ss.hosted_responder_twilio_inbound_contract_v1() <>
      'canonical-responder-twilio-inbound-v1-keyed-lookup-tenant-bound'
    or to_regprocedure(
      'ss.reconcile_operator_work_queue_v1(timestamptz)'
    ) is null
  then
    raise exception
      'the exact Responder queue, delivery-event, inbound, and operator-queue contracts must precede PROVIDER-RECONCILIATION-01'
      using errcode = '55000';
  end if;
end
$$;

-- Reconciliation never invents provider effects. Cases are durable,
-- digest-idempotent detection evidence; automated resolution is limited to
-- provably safe self-healing, and every other closure carries named
-- operator authority. All provider identifiers remain digests.
create table ss.provider_reconciliation_cases (
  id uuid primary key,
  provider text not null check (provider ~ '^[a-z][a-z0-9_-]{2,63}$'),
  case_kind text not null check (
    case_kind in (
      'abandoned_claim', 'stale_delivery_status',
      'unmatched_provider_event', 'suppression_conflict',
      'unbound_inbound_event', 'ambiguous_number_binding',
      'ambiguous_message_create'
    )
  ),
  case_digest ss.sha256_hex not null unique,
  subject_operation_id uuid
    references ss.responder_delivery_operations(id),
  subject_inbound_event_id uuid
    references ss.responder_twilio_inbound_events(id),
  subject_provider_message_id_digest ss.sha256_hex,
  subject_phone_number_sid_digest ss.sha256_hex,
  subject_operation_attempt integer check (
    subject_operation_attempt is null
      or subject_operation_attempt between 1 and 5
  ),
  subject_lease_owner_digest ss.sha256_hex,
  organization_id uuid references ss.organizations(id),
  project_id uuid,
  evidence_digest ss.sha256_hex not null,
  detected_by_worker_id text check (
    detected_by_worker_id is null or (
      char_length(detected_by_worker_id) between 8 and 200
      and detected_by_worker_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
    )
  ),
  readback_state text not null default 'none' check (
    readback_state in (
      'none', 'matched', 'single_candidate', 'not_found', 'multiple_matches'
    )
  ),
  readback_evidence_digest ss.sha256_hex,
  readback_matched_provider_message_id_digest ss.sha256_hex,
  readback_match_count integer check (
    readback_match_count is null
      or readback_match_count between 0 and 500
  ),
  readback_at timestamptz,
  state text not null check (state in ('open', 'resolved')),
  resolution_kind text check (
    resolution_kind is null or resolution_kind in (
      'self_healed', 'operator_confirmed_effect',
      'operator_confirmed_no_effect', 'operator_late_binding_applied',
      'operator_binding_retired', 'operator_closed'
    )
  ),
  resolved_by_operator_user_id uuid references auth.users(id),
  resolution_evidence_digest ss.sha256_hex,
  resolved_at timestamptz,
  revision bigint not null default 1 check (revision > 0),
  opened_at timestamptz not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  check (created_at = opened_at),
  check (updated_at >= created_at),
  check (
    (readback_state = 'none'
      and readback_evidence_digest is null
      and readback_matched_provider_message_id_digest is null
      and readback_match_count is null
      and readback_at is null)
    or (readback_state in ('matched', 'single_candidate')
      and readback_evidence_digest is not null
      and readback_matched_provider_message_id_digest is not null
      and readback_match_count = 1
      and readback_at is not null)
    or (readback_state = 'not_found'
      and readback_evidence_digest is not null
      and readback_matched_provider_message_id_digest is null
      and readback_match_count = 0
      and readback_at is not null)
    or (readback_state = 'multiple_matches'
      and readback_evidence_digest is not null
      and readback_matched_provider_message_id_digest is null
      and readback_match_count between 2 and 500
      and readback_at is not null)
  ),
  check (
    (state = 'open'
      and resolution_kind is null
      and resolved_by_operator_user_id is null
      and resolution_evidence_digest is null
      and resolved_at is null)
    or (state = 'resolved'
      and resolution_kind is not null
      and resolution_evidence_digest is not null
      and resolved_at is not null
      and resolved_at >= opened_at)
  ),
  check (
    (resolution_kind is null)
    or (resolution_kind = 'self_healed'
      and resolved_by_operator_user_id is null)
    or (resolution_kind <> 'self_healed'
      and resolved_by_operator_user_id is not null)
  ),
  check (
    (case_kind = 'abandoned_claim'
      and subject_operation_id is not null
      and subject_inbound_event_id is null
      and subject_provider_message_id_digest is null
      and subject_phone_number_sid_digest is null
      and subject_operation_attempt is not null
      and subject_lease_owner_digest is not null
      and organization_id is not null
      and project_id is not null)
    or (case_kind in (
      'stale_delivery_status', 'suppression_conflict'
    )
      and subject_operation_id is not null
      and subject_inbound_event_id is null
      and subject_provider_message_id_digest is not null
      and subject_phone_number_sid_digest is null
      and subject_operation_attempt is null
      and subject_lease_owner_digest is null
      and organization_id is not null
      and project_id is not null)
    or (case_kind = 'ambiguous_message_create'
      and subject_operation_id is not null
      and subject_inbound_event_id is null
      and subject_provider_message_id_digest is null
      and subject_phone_number_sid_digest is null
      and subject_operation_attempt is not null
      and subject_lease_owner_digest is null
      and organization_id is not null
      and project_id is not null)
    or (case_kind = 'unmatched_provider_event'
      and subject_operation_id is null
      and subject_inbound_event_id is null
      and subject_provider_message_id_digest is not null
      and subject_phone_number_sid_digest is null
      and subject_operation_attempt is null
      and subject_lease_owner_digest is null
      and organization_id is null
      and project_id is null)
    or (case_kind = 'unbound_inbound_event'
      and subject_operation_id is null
      and subject_inbound_event_id is not null
      and subject_provider_message_id_digest is null
      and subject_phone_number_sid_digest is null
      and subject_operation_attempt is null
      and subject_lease_owner_digest is null
      and organization_id is null
      and project_id is null)
    or (case_kind = 'ambiguous_number_binding'
      and subject_operation_id is null
      and subject_inbound_event_id is null
      and subject_provider_message_id_digest is null
      and subject_phone_number_sid_digest is not null
      and subject_operation_attempt is null
      and subject_lease_owner_digest is null
      and organization_id is null
      and project_id is null)
  )
);

create index provider_reconciliation_cases_open
  on ss.provider_reconciliation_cases(opened_at, id)
  where state = 'open';
create index provider_reconciliation_cases_subject_operation
  on ss.provider_reconciliation_cases(subject_operation_id)
  where subject_operation_id is not null;

-- The two detection scans FIN-004R introduces need bounded indexes.
create index responder_delivery_operations_abandoned_claims
  on ss.responder_delivery_operations(lease_expires_at, id)
  where state = 'claimed';
create index responder_delivery_provider_statuses_nonterminal
  on ss.responder_delivery_provider_statuses(accepted_at, operation_id)
  where not terminal;

create function ss.provider_reconciliation_case_digest(
  selected_provider text,
  selected_case_kind text,
  selected_subject text
)
returns ss.sha256_hex
language sql
immutable
parallel safe
set search_path = pg_catalog, ss
as $$
  select ss.service_json_digest(jsonb_build_object(
    'caseKind', selected_case_kind,
    'provider', selected_provider,
    'schema', 'sitesourcery.provider-reconciliation-case/v1',
    'subject', selected_subject
  ))
$$;

create function ss.provider_reconciliation_case_subject(
  selected_case ss.provider_reconciliation_cases
)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog, ss
as $$
  select coalesce(
    case when selected_case.case_kind = 'abandoned_claim' then concat(
      selected_case.subject_operation_id::text, ':',
      selected_case.subject_operation_attempt::text, ':',
      selected_case.subject_lease_owner_digest
    ) else null end,
    selected_case.subject_operation_id::text,
    selected_case.subject_inbound_event_id::text,
    selected_case.subject_provider_message_id_digest,
    selected_case.subject_phone_number_sid_digest
  )
$$;

create function ss.guard_provider_reconciliation_case()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if tg_op = 'DELETE'
    or ss.current_service_actor_kind() <> 'system'
    or ss.current_service_actor_org_id() is not null
  then
    raise exception
      'Provider reconciliation cases require global system authority'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if new.state <> 'open'
      or new.revision <> 1
      or new.readback_state <> 'none'
      or new.case_digest <> ss.provider_reconciliation_case_digest(
        new.provider, new.case_kind,
        ss.provider_reconciliation_case_subject(new)
      )
    then
      raise exception 'Provider reconciliation cases must begin open and exact'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if row(
    new.id, new.provider, new.case_kind, new.case_digest,
    new.subject_operation_id, new.subject_inbound_event_id,
    new.subject_provider_message_id_digest,
    new.subject_phone_number_sid_digest, new.subject_operation_attempt,
    new.subject_lease_owner_digest, new.organization_id,
    new.project_id, new.evidence_digest, new.detected_by_worker_id,
    new.opened_at, new.created_at
  ) is distinct from row(
    old.id, old.provider, old.case_kind, old.case_digest,
    old.subject_operation_id, old.subject_inbound_event_id,
    old.subject_provider_message_id_digest,
    old.subject_phone_number_sid_digest, old.subject_operation_attempt,
    old.subject_lease_owner_digest, old.organization_id,
    old.project_id, old.evidence_digest, old.detected_by_worker_id,
    old.opened_at, old.created_at
  )
    or old.state <> 'open'
    or new.revision <> old.revision + 1
    or new.updated_at < old.updated_at
  then
    raise exception 'Provider reconciliation case identity is immutable'
      using errcode = '55000';
  end if;

  if new.state = 'open' then
    if old.readback_state <> 'none'
      or new.readback_state = 'none'
    then
      raise exception
        'An open reconciliation case accepts exactly one readback record'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if new.resolution_kind <> 'self_healed'
    and not ss.service_operator_has_capability(
      new.resolved_by_operator_user_id,
      'service_management_manage',
      clock_timestamp()
    )
  then
    raise exception
      'Provider reconciliation closure requires named operator authority'
      using errcode = '42501';
  end if;
  if row(
    new.readback_state, new.readback_evidence_digest,
    new.readback_matched_provider_message_id_digest,
    new.readback_match_count, new.readback_at
  )
    is distinct from
    row(
      old.readback_state, old.readback_evidence_digest,
      old.readback_matched_provider_message_id_digest,
      old.readback_match_count, old.readback_at
    )
  then
    raise exception 'Resolution cannot rewrite readback evidence'
      using errcode = '55000';
  end if;
  return new;
end
$$;

create trigger provider_reconciliation_cases_guard
before insert or update or delete on ss.provider_reconciliation_cases
for each row execute function ss.guard_provider_reconciliation_case();

-- A late-provisioned unbound inbound event is re-applied through a separate
-- immutable resolution record; the original evidence row never mutates.
create table ss.responder_inbound_resolutions (
  inbound_event_id uuid primary key
    references ss.responder_twilio_inbound_events(id),
  case_id uuid not null unique
    references ss.provider_reconciliation_cases(id),
  organization_id uuid not null references ss.organizations(id),
  project_id uuid not null,
  binding_id uuid not null
    references ss.responder_provider_number_bindings(id),
  core_provider_event_id uuid not null
    references ss.responder_provider_events(id),
  applied_by_operator_user_id uuid not null references auth.users(id),
  evidence_digest ss.sha256_hex not null,
  applied_at timestamptz not null,
  created_at timestamptz not null,
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  check (created_at = applied_at)
);

create function ss.guard_responder_inbound_resolution()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if tg_op <> 'INSERT'
    or ss.current_service_actor_kind() <> 'system'
    or ss.current_service_actor_org_id()
      is distinct from new.organization_id
    or not ss.service_operator_has_capability(
      new.applied_by_operator_user_id,
      'service_management_manage',
      clock_timestamp()
    )
    or not exists (
      select 1 from ss.responder_twilio_inbound_events inbound
       where inbound.id = new.inbound_event_id
         and inbound.state = 'unbound'
    )
    or not exists (
      select 1 from ss.responder_provider_number_bindings binding
       where binding.id = new.binding_id
         and binding.state = 'active'
         and binding.organization_id = new.organization_id
         and binding.project_id = new.project_id
    )
    or not exists (
      select 1 from ss.provider_reconciliation_cases reconciliation
       where reconciliation.id = new.case_id
         and reconciliation.case_kind = 'unbound_inbound_event'
         and reconciliation.subject_inbound_event_id =
           new.inbound_event_id
    )
  then
    raise exception
      'Responder inbound resolution requires exact operator-backed evidence'
      using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger responder_inbound_resolutions_guard
before insert or update or delete on ss.responder_inbound_resolutions
for each row execute function ss.guard_responder_inbound_resolution();

-- The operator queue projects reconciliation cases like every other bounded
-- source: an explicit allowlist entry, a typed item kind, and one refresh
-- branch. No repair command is attached; resolution flows through the typed
-- reconciliation surface.
alter table ss.operator_work_queue_items
  drop constraint operator_work_queue_items_source_table_check,
  add constraint operator_work_queue_items_source_table_v2_check check (
    source_table in (
      'ss.service_assessment_stripe_events',
      'ss.service_custom_build_stripe_events',
      'ss.service_custom_build_change_stripe_events',
      'ss.service_custom_build_final_stripe_events',
      'ss.service_professional_payment_lifecycles',
      'ss.service_assessment_jobs',
      'ss.service_custom_build_jobs',
      'ss.hosted_support_cases',
      'ss.publication_control_commands',
      'ss.domain_provider_operations',
      'ss.alakazam_35_care_requests',
      'ss.alakazam_50_care_requests',
      'ss.hosted_mail_exception_projection',
      'ss.stripe_invoice_finalization_failures',
      'ss.provider_reconciliation_cases'
    )
  ),
  drop constraint operator_work_queue_items_item_kind_check,
  add constraint operator_work_queue_items_item_kind_v2_check check (
    item_kind in (
      'payment_reconciliation',
      'reversal_reconciliation',
      'assessment_job',
      'custom_job',
      'support_case',
      'privacy_case',
      'publication_hold',
      'domain_failure',
      'care_hold',
      'mail_exception',
      'invoice_finalization_failure',
      'provider_reconciliation_case'
    )
  );

create or replace function ss.reconcile_operator_work_queue_v1(selected_observed_at timestamptz)
returns table(active_count bigint, changed_count bigint, resolved_count bigint)
language plpgsql
security definer
set search_path = pg_catalog, extensions, ss
as $$
declare
  changed_rows bigint := 0;
  resolved_rows bigint := 0;
begin
  if ss.current_service_actor_kind() <> 'operator'
    or not ss.service_operator_has_capability(
      ss.current_service_actor_user_id(),
      'service_management_manage',
      clock_timestamp()
    )
  then
    raise exception 'operator work queue refresh lacks exact authority'
      using errcode = '42501';
  end if;
  if selected_observed_at is null
    or selected_observed_at < clock_timestamp() - interval '5 minutes'
    or selected_observed_at > clock_timestamp() + interval '5 minutes'
  then
    raise exception 'operator work queue observation time is required'
      using errcode = '23514';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'sitesourcery.operator-work-queue/v1', 0
  ));

  create temporary table operator_queue_desired (
    source_table text not null,
    source_id text not null,
    source_revision bigint not null,
    source_digest ss.sha256_hex not null,
    source_state text not null,
    organization_id uuid,
    project_id uuid,
    item_kind text not null,
    severity text not null,
    status text not null,
    deadline_at timestamptz,
    repair_kind text,
    repair_reference_id uuid,
    opened_at timestamptz not null,
    primary key (source_table, source_id)
  ) on commit drop;

  insert into operator_queue_desired
  select
    'ss.service_assessment_stripe_events', event.id, 1,
    event.payload_digest, event.state, event.organization_id,
    event.project_id, 'payment_reconciliation', 'high', 'open',
    null::timestamptz, null::text, null::uuid, event.completed_at
  from ss.service_assessment_stripe_events event
  where event.state = 'reconciliation_required'

  union all
  select
    'ss.service_custom_build_stripe_events', event.id, 1,
    event.payload_digest, event.state, event.organization_id,
    event.project_id, 'payment_reconciliation', 'high', 'open',
    null, null, null, event.completed_at
  from ss.service_custom_build_stripe_events event
  where event.state = 'reconciliation_required'

  union all
  select
    'ss.service_custom_build_change_stripe_events', event.id, 1,
    event.payload_digest, event.state, event.organization_id,
    event.project_id, 'payment_reconciliation', 'high', 'open',
    null, null, null, event.completed_at
  from ss.service_custom_build_change_stripe_events event
  where event.state = 'reconciliation_required'

  union all
  select
    'ss.service_custom_build_final_stripe_events', event.id, 1,
    event.payload_digest, event.state, event.organization_id,
    event.project_id, 'payment_reconciliation', 'high', 'open',
    null, null, null, event.completed_at
  from ss.service_custom_build_final_stripe_events event
  where event.state = 'reconciliation_required'

  union all
  select
    'ss.service_professional_payment_lifecycles', lifecycle.id::text,
    lifecycle.revision, evidence.provider_facts_digest,
    'reconciliation_required', lifecycle.organization_id,
    lifecycle.project_id, 'reversal_reconciliation', 'high', 'open',
    null, 'professional_reversal_reconcile', evidence.id,
    evidence.recorded_at
  from ss.service_professional_payment_lifecycles lifecycle
  join ss.service_professional_reversal_evidence evidence
    on evidence.lifecycle_id = lifecycle.id
   and evidence.id = lifecycle.latest_evidence_id
  where lifecycle.reconciliation_required

  union all
  select
    'ss.service_assessment_jobs', job.id::text, job.quote_revision,
    job.accepted_quote_digest, job.state, job.organization_id,
    job.project_id, 'assessment_job',
    case
      when selected_observed_at >
        (job.delivery_date::timestamp at time zone 'UTC') + interval '1 day'
      then 'high' else 'normal'
    end,
    'open',
    (job.delivery_date::timestamp at time zone 'UTC') + interval '1 day',
    null, null, job.opened_at
  from ss.service_assessment_jobs job
  where not exists (
    select 1 from ss.service_assessment_reports report
    where report.job_id = job.id
  )

  union all
  select
    'ss.service_custom_build_jobs', job.id::text, job.quote_revision,
    job.accepted_quote_digest, job.state, job.organization_id,
    job.project_id, 'custom_job',
    case
      when selected_observed_at >
        (job.target_completion_date::timestamp at time zone 'UTC') + interval '1 day'
      then 'high' else 'normal'
    end,
    'open',
    (job.target_completion_date::timestamp at time zone 'UTC') + interval '1 day',
    null, null, job.opened_at
  from ss.service_custom_build_jobs job
  where not exists (
    select 1 from ss.service_custom_build_completion_packages package
    where package.job_id = job.id
  )

  union all
  select
    'ss.hosted_support_cases', support_case.id::text,
    support_case.revision, support_case.opening_request_digest,
    support_case.state, support_case.organization_id,
    support_case.project_id,
    case when support_case.request_kind = 'support'
      then 'support_case' else 'privacy_case' end,
    case
      when support_case.response_due_at is not null
        and selected_observed_at > support_case.response_due_at
      then 'high'
      when support_case.request_kind in (
        'access', 'correction', 'export', 'deletion', 'appeal'
      ) then 'high'
      else 'normal'
    end,
    case when support_case.state in ('open', 'assigned')
      then 'open' else 'in_progress' end,
    support_case.response_due_at, null, null, support_case.opened_at
  from ss.hosted_support_cases support_case
  where support_case.state <> 'closed'

  union all
  select
    'ss.publication_control_commands', command.id::text,
    command.entitlement_revision, command.command_digest,
    command.state, command.organization_id, command.project_id,
    'publication_hold', 'low', 'blocked', null, null, null,
    command.requested_at
  from ss.publication_control_commands command
  where command.state = 'held' or command.projection_state = 'failed'

  union all
  select
    'ss.domain_provider_operations', operation.id::text,
    operation.attempt_count::bigint, operation.request_digest,
    operation.state, operation.organization_id, operation.project_id,
    'domain_failure', 'high', 'blocked', null, null, null,
    operation.requested_at
  from ss.domain_provider_operations operation
  where operation.state in ('failed', 'manual_review')

  union all
  select
    'ss.alakazam_35_care_requests', care.id::text,
    care.subscription_revision, care.request_digest, care.state,
    care.organization_id, care.project_id, 'care_hold', 'low',
    'blocked', null, null, null, care.requested_at
  from ss.alakazam_35_care_requests care
  where care.state = 'held'

  union all
  select
    'ss.alakazam_50_care_requests', care.id::text,
    care.subscription_revision, care.request_digest, care.state,
    care.organization_id, care.project_id, 'care_hold', 'low',
    'blocked', null, null, null, care.requested_at
  from ss.alakazam_50_care_requests care
  where care.state = 'held'

  union all
  select
    'ss.hosted_mail_exception_projection', exception.id::text,
    exception.revision, exception.safe_reference_digest, exception.state,
    exception.organization_id, exception.project_id, 'mail_exception',
    case when exception.exception_kind in ('complained', 'suppressed')
      then 'high' else 'normal' end,
    'open', null, null, null, exception.opened_at
  from ss.hosted_mail_exception_projection exception
  where exception.state = 'open'

  union all
  select
    'ss.stripe_invoice_finalization_failures', failure.id::text,
    failure.revision, failure.payload_digest, failure.state,
    null, null, 'invoice_finalization_failure', 'high', 'open',
    null, null, null, failure.recorded_at
  from ss.stripe_invoice_finalization_failures failure
  where failure.state = 'open'

  union all
  select
    'ss.provider_reconciliation_cases', reconciliation.id::text,
    reconciliation.revision, reconciliation.case_digest,
    reconciliation.state, reconciliation.organization_id,
    reconciliation.project_id, 'provider_reconciliation_case',
    case reconciliation.case_kind
      when 'suppression_conflict' then 'critical'
      when 'abandoned_claim' then 'high'
      when 'ambiguous_number_binding' then 'high'
      when 'ambiguous_message_create' then 'high'
      else 'normal'
    end,
    'open', null, null, null, reconciliation.opened_at
  from ss.provider_reconciliation_cases reconciliation
  where reconciliation.state = 'open';

  insert into ss.operator_work_queue_items (
    id, source_table, source_id, source_revision, source_digest,
    source_state, organization_id, project_id, item_kind, severity,
    status, deadline_at, repair_kind, repair_reference_id, opened_at,
    resolved_at, revision, item_digest, created_at, updated_at
  )
  select
    gen_random_uuid(), desired.source_table, desired.source_id,
    desired.source_revision, desired.source_digest, desired.source_state,
    desired.organization_id, desired.project_id, desired.item_kind,
    desired.severity, desired.status, desired.deadline_at,
    desired.repair_kind, desired.repair_reference_id, desired.opened_at,
    null, 1, desired.source_digest, desired.opened_at, selected_observed_at
  from operator_queue_desired desired
  on conflict (source_table, source_id) do update
  set source_revision = excluded.source_revision,
      source_digest = excluded.source_digest,
      source_state = excluded.source_state,
      item_kind = excluded.item_kind,
      severity = excluded.severity,
      status = excluded.status,
      deadline_at = excluded.deadline_at,
      repair_kind = excluded.repair_kind,
      repair_reference_id = excluded.repair_reference_id,
      resolved_at = null,
      updated_at = selected_observed_at
  where row(
    operator_work_queue_items.source_revision,
    operator_work_queue_items.source_digest,
    operator_work_queue_items.source_state,
    operator_work_queue_items.item_kind,
    operator_work_queue_items.severity,
    operator_work_queue_items.status,
    operator_work_queue_items.deadline_at,
    operator_work_queue_items.repair_kind,
    operator_work_queue_items.repair_reference_id,
    operator_work_queue_items.resolved_at
  ) is distinct from row(
    excluded.source_revision,
    excluded.source_digest,
    excluded.source_state,
    excluded.item_kind,
    excluded.severity,
    excluded.status,
    excluded.deadline_at,
    excluded.repair_kind,
    excluded.repair_reference_id,
    null::timestamptz
  );
  get diagnostics changed_rows = row_count;

  update ss.operator_work_queue_items item
     set status = 'resolved', resolved_at = selected_observed_at,
         repair_kind = null, repair_reference_id = null,
         updated_at = selected_observed_at
   where item.status <> 'resolved'
     and not exists (
       select 1 from operator_queue_desired desired
       where desired.source_table = item.source_table
         and desired.source_id = item.source_id
     );
  get diagnostics resolved_rows = row_count;

  return query
  select count(*) filter (where item.status <> 'resolved'),
         changed_rows,
         resolved_rows
    from ss.operator_work_queue_items item;
end
$$;

alter table ss.provider_reconciliation_cases enable row level security;
alter table ss.provider_reconciliation_cases force row level security;
alter table ss.responder_inbound_resolutions enable row level security;
alter table ss.responder_inbound_resolutions force row level security;

revoke all on
  ss.provider_reconciliation_cases,
  ss.responder_inbound_resolutions
from public, anon, authenticated, service_role;

grant select, insert, update on ss.provider_reconciliation_cases
to service_role;
grant select, insert on ss.responder_inbound_resolutions to service_role;

revoke all on function ss.provider_reconciliation_case_digest(
  text, text, text
) from public, anon, authenticated;
grant execute on function ss.provider_reconciliation_case_digest(
  text, text, text
) to service_role;
revoke all on function ss.provider_reconciliation_case_subject(
  ss.provider_reconciliation_cases
) from public, anon, authenticated;
grant execute on function ss.provider_reconciliation_case_subject(
  ss.provider_reconciliation_cases
) to service_role;
revoke all on function ss.guard_provider_reconciliation_case()
from public, anon, authenticated, service_role;
revoke all on function ss.guard_responder_inbound_resolution()
from public, anon, authenticated, service_role;

create function ss.hosted_provider_reconciliation_contract_v1()
returns text
language sql
stable
set search_path = pg_catalog
as $$
select 'canonical-provider-reconciliation-v1-readback-evidence-bound'
$$;

revoke all on function ss.hosted_provider_reconciliation_contract_v1()
from public, anon, authenticated, service_role;
grant execute on function ss.hosted_provider_reconciliation_contract_v1()
to service_role;

commit;
