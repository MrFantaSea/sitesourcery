begin;

do $$
begin
  if to_regprocedure('ss.hosted_runtime_contract_v108()') is null
    or ss.hosted_runtime_contract_v108() <>
      'canonical-ss-v108-professional-services-reversals'
    or to_regprocedure('ss.hosted_support_case_contract_v1()') is null
    or ss.hosted_support_case_contract_v1() <>
      'canonical-support-case-v1-auditable-held-lifecycle'
    or to_regclass('ss.hosted_mail_exception_projection') is null
    or to_regclass('ss.publication_control_commands') is null
    or to_regclass('ss.domain_provider_operations') is null
  then
    raise exception
      'professional reversals, support cases, mail, publication, and domain foundations must precede OPS-QUEUE-01'
      using errcode = '55000';
  end if;
end
$$;

-- Stripe's invoice.finalization_failed event is owner-review evidence only.
-- The verified router supplies opaque digests; provider objects, payloads,
-- customer data, invoice lines, and error messages are never retained here.
create table ss.stripe_invoice_finalization_failures (
  id uuid primary key,
  command_id text not null unique check (
    char_length(command_id) between 8 and 200
    and command_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
  ),
  request_digest ss.sha256_hex not null,
  provider_event_id_digest ss.sha256_hex not null unique,
  invoice_id_digest ss.sha256_hex not null,
  payload_digest ss.sha256_hex not null,
  signature_verification_digest ss.sha256_hex not null,
  reason_code text not null check (
    reason_code in (
      'automatic_tax',
      'invoice_settings',
      'provider_rejected',
      'unknown_review'
    )
  ),
  event_type text not null default 'invoice.finalization_failed'
    check (event_type = 'invoice.finalization_failed'),
  state text not null default 'open' check (state = 'open'),
  owner_alert_required boolean not null default true
    check (owner_alert_required),
  provider_created_at timestamptz not null,
  recorded_at timestamptz not null,
  revision bigint not null default 1 check (revision = 1),
  created_at timestamptz not null,
  check (created_at = recorded_at),
  check (recorded_at >= provider_created_at)
);

create function ss.guard_stripe_invoice_finalization_failure()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if tg_op <> 'INSERT'
    or ss.current_service_actor_kind() <> 'system'
    or new.state <> 'open'
    or not new.owner_alert_required
    or new.revision <> 1
    or new.recorded_at < clock_timestamp() - interval '5 minutes'
    or new.recorded_at > clock_timestamp() + interval '5 minutes'
  then
    raise exception 'invoice finalization evidence is append-only system authority'
      using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger stripe_invoice_finalization_failures_guard
before insert or update or delete on ss.stripe_invoice_finalization_failures
for each row execute function
  ss.guard_stripe_invoice_finalization_failure();

-- This is a projection, never an alternate source of commercial, fulfillment,
-- support, publication, domain, Care, or delivery truth. Every live row keeps
-- the exact source relation, stable source key, source revision, and source
-- digest used to derive it. A later refresh can resolve a row only because the
-- underlying source no longer requires operator work.
create table ss.operator_work_queue_items (
  id uuid primary key,
  source_table text not null check (
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
      'ss.stripe_invoice_finalization_failures'
    )
  ),
  source_id text not null check (
    char_length(source_id) between 1 and 200
    and source_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'
  ),
  source_revision bigint not null check (source_revision >= 0),
  source_digest ss.sha256_hex not null,
  source_state text not null check (
    char_length(source_state) between 1 and 64
    and source_state ~ '^[a-z][a-z0-9_:-]{0,63}$'
  ),
  organization_id uuid,
  project_id uuid,
  item_kind text not null check (
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
      'invoice_finalization_failure'
    )
  ),
  severity text not null check (
    severity in ('low', 'normal', 'high', 'critical')
  ),
  status text not null check (
    status in ('open', 'in_progress', 'blocked', 'resolved')
  ),
  deadline_at timestamptz,
  repair_kind text check (
    repair_kind is null or repair_kind = 'professional_reversal_reconcile'
  ),
  repair_reference_id uuid,
  opened_at timestamptz not null,
  resolved_at timestamptz,
  revision bigint not null default 1 check (revision > 0),
  item_digest ss.sha256_hex not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (source_table, source_id),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  check (
    (organization_id is null and project_id is null)
    or organization_id is not null
  ),
  check (created_at = opened_at),
  check (updated_at >= created_at),
  check (
    (status = 'resolved' and resolved_at is not null)
    or (status <> 'resolved' and resolved_at is null)
  ),
  check (
    (repair_kind is null and repair_reference_id is null)
    or (
      repair_kind = 'professional_reversal_reconcile'
      and repair_reference_id is not null
      and source_table = 'ss.service_professional_payment_lifecycles'
      and item_kind = 'reversal_reconciliation'
      and status = 'open'
    )
  )
);

create index operator_work_queue_active
  on ss.operator_work_queue_items(
    severity, deadline_at, opened_at, id
  ) where status <> 'resolved';

create index operator_work_queue_scope
  on ss.operator_work_queue_items(
    organization_id, project_id, status, opened_at, id
  );

create function ss.operator_work_queue_item_digest(
  selected_source_table text,
  selected_source_id text,
  selected_source_revision bigint,
  selected_source_digest ss.sha256_hex,
  selected_source_state text,
  selected_organization_id uuid,
  selected_project_id uuid,
  selected_item_kind text,
  selected_severity text,
  selected_status text,
  selected_deadline_at timestamptz,
  selected_repair_kind text,
  selected_repair_reference_id uuid,
  selected_resolved_at timestamptz
)
returns ss.sha256_hex
language sql
immutable
parallel safe
set search_path = pg_catalog, ss
as $$
  select ss.service_json_digest(jsonb_build_object(
    'deadlineAt', selected_deadline_at,
    'itemKind', selected_item_kind,
    'organizationId', selected_organization_id,
    'projectId', selected_project_id,
    'repairKind', selected_repair_kind,
    'repairReferenceId', selected_repair_reference_id,
    'resolvedAt', selected_resolved_at,
    'schema', 'sitesourcery.operator-work-queue-item/v1',
    'severity', selected_severity,
    'sourceDigest', selected_source_digest,
    'sourceId', selected_source_id,
    'sourceRevision', selected_source_revision,
    'sourceState', selected_source_state,
    'sourceTable', selected_source_table,
    'status', selected_status
  ))
$$;

create function ss.guard_operator_work_queue_item()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if tg_op = 'DELETE'
    or ss.current_service_actor_kind() <> 'operator'
    or not ss.service_operator_has_capability(
      ss.current_service_actor_user_id(),
      'service_management_manage',
      clock_timestamp()
    )
  then
    raise exception 'operator work queue mutation lacks exact authority'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if new.revision <> 1 or new.resolved_at is not null
    then
      raise exception 'operator work queue insert is invalid'
        using errcode = '23514';
    end if;
  else
    if row(
      new.id, new.source_table, new.source_id,
      new.organization_id, new.project_id,
      new.opened_at, new.created_at
    ) is distinct from row(
      old.id, old.source_table, old.source_id,
      old.organization_id, old.project_id,
      old.opened_at, old.created_at
    )
      or new.source_revision < old.source_revision
      or (
        new.source_digest is distinct from old.source_digest
        and new.source_revision <= old.source_revision
      )
    then
      raise exception 'operator work queue source identity moved backwards'
        using errcode = '55000';
    end if;
    new.revision := old.revision + 1;
  end if;

  new.item_digest := ss.operator_work_queue_item_digest(
    new.source_table,
    new.source_id,
    new.source_revision,
    new.source_digest,
    new.source_state,
    new.organization_id,
    new.project_id,
    new.item_kind,
    new.severity,
    new.status,
    new.deadline_at,
    new.repair_kind,
    new.repair_reference_id,
    new.resolved_at
  );
  return new;
end
$$;

create trigger operator_work_queue_items_guard
before insert or update or delete on ss.operator_work_queue_items
for each row execute function ss.guard_operator_work_queue_item();

-- One serialized refresh computes the whole active set directly from source
-- state. Repeating the same refresh changes no row or revision. It neither
-- invokes a repair command nor changes a source table.
create function ss.reconcile_operator_work_queue_v1(selected_observed_at timestamptz)
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
  where failure.state = 'open';

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

alter table ss.stripe_invoice_finalization_failures enable row level security;
alter table ss.stripe_invoice_finalization_failures force row level security;
alter table ss.operator_work_queue_items enable row level security;
alter table ss.operator_work_queue_items force row level security;

revoke all on
  ss.stripe_invoice_finalization_failures,
  ss.operator_work_queue_items
from public, anon, authenticated, service_role;

grant select, insert on ss.stripe_invoice_finalization_failures to service_role;
grant select on ss.operator_work_queue_items to service_role;

revoke all on function ss.guard_stripe_invoice_finalization_failure()
from public, anon, authenticated, service_role;
revoke all on function ss.operator_work_queue_item_digest(
  text, text, bigint, ss.sha256_hex, text, uuid, uuid, text, text,
  text, timestamptz, text, uuid, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function ss.guard_operator_work_queue_item()
from public, anon, authenticated, service_role;
revoke all on function ss.reconcile_operator_work_queue_v1(timestamptz)
from public, anon, authenticated;
grant execute on function ss.reconcile_operator_work_queue_v1(timestamptz)
to service_role;

create function ss.hosted_operator_work_queue_contract_v1()
returns text
language sql
stable
set search_path = pg_catalog
as $$
select 'canonical-operator-work-queue-v1-source-authoritative-held'::text
$$;

revoke all on function ss.hosted_operator_work_queue_contract_v1()
from public, anon, authenticated, service_role;
grant execute on function ss.hosted_operator_work_queue_contract_v1()
to service_role;

commit;
