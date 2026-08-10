begin;

do $$
begin
  if to_regprocedure('ss.hosted_runtime_contract_v47()') is null
    or to_regprocedure('ss.hosted_runtime_contract_v53()') is null
    or to_regclass('ss.service_assessment_payment_receipts') is null
    or to_regclass('ss.service_custom_build_payment_receipts') is null
    or to_regclass('ss.service_custom_build_change_payment_receipts') is null
    or to_regclass('ss.service_custom_build_final_payment_receipts') is null
  then
    raise exception
      'Site Sourcery Custom payment and joint legal authority must precede professional reversals'
      using errcode = '55000';
  end if;
end
$$;

-- One normalized read boundary over the four immutable professional-service
-- receipts. The view does not grant access; only the two fenced SECURITY
-- DEFINER entry points below may consume it.
create view ss.service_professional_payment_bindings as
select
  'assessment'::text as payment_purpose,
  receipt.id as receipt_id,
  receipt.organization_id,
  receipt.project_id,
  receipt.customer_user_id,
  receipt.payment_intent_id,
  receipt.total_minor,
  receipt.currency,
  coalesce(application.state, 'none') as credit_state,
  coalesce(quote.state, 'none') as quote_state
from ss.service_assessment_payment_receipts receipt
left join ss.service_credit_grants credit
  on credit.organization_id = receipt.organization_id
 and credit.source_payment_receipt_id = receipt.id
left join lateral (
  select selected.state
  from ss.service_credit_applications selected
  where selected.organization_id = credit.organization_id
    and selected.credit_grant_id = credit.id
  order by selected.created_at desc, selected.id desc
  limit 1
) application on true
left join ss.service_assessment_reports report
  on report.organization_id = receipt.organization_id
 and report.payment_receipt_id = receipt.id
left join lateral (
  select selected.state
  from ss.service_custom_build_quotes selected
  where selected.organization_id = receipt.organization_id
    and selected.source_report_id = report.id
  order by selected.created_at desc, selected.id desc
  limit 1
) quote on true

union all

select
  'custom_build_initial'::text,
  receipt.id,
  receipt.organization_id,
  receipt.project_id,
  receipt.customer_user_id,
  receipt.payment_intent_id,
  receipt.total_minor,
  receipt.currency,
  application.state,
  quote.state
from ss.service_custom_build_payment_receipts receipt
join ss.service_credit_applications application
  on application.organization_id = receipt.organization_id
 and application.id = receipt.credit_application_id
join ss.service_custom_build_quotes quote
  on quote.organization_id = application.organization_id
 and quote.id = application.quote_id

union all

select
  'custom_build_change'::text,
  receipt.id,
  receipt.organization_id,
  receipt.project_id,
  receipt.customer_user_id,
  receipt.payment_intent_id,
  receipt.total_minor,
  receipt.currency,
  application.state,
  quote.state
from ss.service_custom_build_change_payment_receipts receipt
join ss.service_custom_build_jobs job
  on job.organization_id = receipt.organization_id
 and job.id = receipt.job_id
join ss.service_custom_build_payment_receipts initial_receipt
  on initial_receipt.organization_id = job.organization_id
 and initial_receipt.id = job.payment_receipt_id
join ss.service_credit_applications application
  on application.organization_id = initial_receipt.organization_id
 and application.id = initial_receipt.credit_application_id
join ss.service_custom_build_quotes quote
  on quote.organization_id = application.organization_id
 and quote.id = application.quote_id

union all

select
  'custom_build_final'::text,
  receipt.id,
  receipt.organization_id,
  receipt.project_id,
  receipt.customer_user_id,
  receipt.payment_intent_id,
  receipt.total_minor,
  receipt.currency,
  application.state,
  quote.state
from ss.service_custom_build_final_payment_receipts receipt
join ss.service_custom_build_jobs job
  on job.organization_id = receipt.organization_id
 and job.id = receipt.job_id
join ss.service_custom_build_payment_receipts initial_receipt
  on initial_receipt.organization_id = job.organization_id
 and initial_receipt.id = job.payment_receipt_id
join ss.service_credit_applications application
  on application.organization_id = initial_receipt.organization_id
 and application.id = initial_receipt.credit_application_id
join ss.service_custom_build_quotes quote
  on quote.organization_id = application.organization_id
 and quote.id = application.quote_id;

revoke all on ss.service_professional_payment_bindings
from public, anon, authenticated, service_role;

create table ss.service_professional_payment_lifecycles (
  id uuid primary key,
  organization_id uuid not null,
  project_id uuid not null,
  customer_user_id uuid not null references auth.users(id),
  payment_purpose text not null check (
    payment_purpose in (
      'assessment',
      'custom_build_initial',
      'custom_build_change',
      'custom_build_final'
    )
  ),
  payment_receipt_id uuid not null,
  assessment_payment_receipt_id uuid,
  custom_build_payment_receipt_id uuid,
  custom_build_change_payment_receipt_id uuid,
  custom_build_final_payment_receipt_id uuid,
  state text not null default 'active'
    check (state in ('active', 'held', 'terminated')),
  severity smallint not null default 0
    check (severity between 0 and 100),
  revision bigint not null default 0 check (revision >= 0),
  credit_state_snapshot text not null check (
    credit_state_snapshot in (
      'none', 'reserved', 'settled', 'released',
      'reconciliation_required'
    )
  ),
  quote_state_snapshot text not null check (
    quote_state_snapshot in ('none', 'issued', 'accepted', 'voided')
  ),
  access_consequence text not null default 'unchanged' check (
    access_consequence in (
      'unchanged',
      'preserve_records_hold_new_work',
      'preserve_records_terminate_new_work'
    )
  ),
  credit_consequence text not null default 'unchanged' check (
    credit_consequence in (
      'unchanged',
      'block_unapplied_credit',
      'freeze_reserved_credit_no_reissue',
      'preserve_settled_credit_no_reissue'
    )
  ),
  quote_consequence text not null default 'unchanged' check (
    quote_consequence in (
      'unchanged',
      'hold_effective_quote_authority',
      'terminate_effective_quote_authority'
    )
  ),
  reconciliation_required boolean not null default false,
  latest_evidence_id uuid,
  latest_reconciliation_id uuid,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, customer_user_id)
    references ss.organization_memberships(organization_id, user_id),
  foreign key (organization_id, assessment_payment_receipt_id)
    references ss.service_assessment_payment_receipts(organization_id, id),
  foreign key (organization_id, custom_build_payment_receipt_id)
    references ss.service_custom_build_payment_receipts(organization_id, id),
  foreign key (organization_id, custom_build_change_payment_receipt_id)
    references ss.service_custom_build_change_payment_receipts(
      organization_id, id
    ),
  foreign key (organization_id, custom_build_final_payment_receipt_id)
    references ss.service_custom_build_final_payment_receipts(
      organization_id, id
    ),
  unique (organization_id, id),
  constraint service_professional_lifecycle_payment_uniq
    unique (payment_purpose, payment_receipt_id),
  unique (organization_id, id, payment_purpose, payment_receipt_id),
  check (
    (payment_purpose = 'assessment'
      and assessment_payment_receipt_id = payment_receipt_id
      and custom_build_payment_receipt_id is null
      and custom_build_change_payment_receipt_id is null
      and custom_build_final_payment_receipt_id is null)
    or (payment_purpose = 'custom_build_initial'
      and assessment_payment_receipt_id is null
      and custom_build_payment_receipt_id = payment_receipt_id
      and custom_build_change_payment_receipt_id is null
      and custom_build_final_payment_receipt_id is null)
    or (payment_purpose = 'custom_build_change'
      and assessment_payment_receipt_id is null
      and custom_build_payment_receipt_id is null
      and custom_build_change_payment_receipt_id = payment_receipt_id
      and custom_build_final_payment_receipt_id is null)
    or (payment_purpose = 'custom_build_final'
      and assessment_payment_receipt_id is null
      and custom_build_payment_receipt_id is null
      and custom_build_change_payment_receipt_id is null
      and custom_build_final_payment_receipt_id = payment_receipt_id)
  ),
  constraint service_professional_lifecycle_consequence_check check (
    (state = 'active'
      and access_consequence = 'unchanged'
      and credit_consequence = 'unchanged'
      and quote_consequence = 'unchanged')
    or (state = 'held'
      and access_consequence = 'preserve_records_hold_new_work'
      and credit_consequence <> 'unchanged'
      and quote_consequence = 'hold_effective_quote_authority')
    or (state = 'terminated'
      and access_consequence = 'preserve_records_terminate_new_work'
      and credit_consequence <> 'unchanged'
      and quote_consequence = 'terminate_effective_quote_authority')
  ),
  constraint service_professional_lifecycle_credit_check check (
    state = 'active'
    or (credit_state_snapshot = 'settled'
      and credit_consequence = 'preserve_settled_credit_no_reissue')
    or (credit_state_snapshot in ('reserved', 'reconciliation_required')
      and credit_consequence = 'freeze_reserved_credit_no_reissue')
    or (credit_state_snapshot in ('none', 'released')
      and credit_consequence = 'block_unapplied_credit')
  )
);

create table ss.service_professional_reversal_evidence (
  id uuid primary key,
  lifecycle_id uuid not null,
  organization_id uuid not null,
  project_id uuid not null,
  customer_user_id uuid not null,
  payment_purpose text not null,
  payment_receipt_id uuid not null,
  provider text not null check (provider = 'stripe'),
  provider_event_id text not null unique
    check (provider_event_id ~ '^evt_[A-Za-z0-9_]+$'),
  provider_event_type text not null check (
    provider_event_type in (
      'charge.refunded',
      'refund.created',
      'refund.updated',
      'refund.failed',
      'charge.dispute.created',
      'charge.dispute.updated',
      'charge.dispute.closed',
      'charge.dispute.funds_withdrawn',
      'charge.dispute.funds_reinstated'
    )
  ),
  payment_intent_id text not null
    check (payment_intent_id ~ '^pi_[A-Za-z0-9_]+$'),
  provider_object_id text not null
    check (provider_object_id ~ '^(ch|re|dp)_[A-Za-z0-9_]+$'),
  evidence_certainty text not null
    check (evidence_certainty in ('verified', 'ambiguous')),
  outcome text check (
    outcome is null or outcome in (
      'refund_failed',
      'dispute_won',
      'dispute_funds_reinstated',
      'dispute_open',
      'refund_partial',
      'dispute_funds_withdrawn',
      'refund_full',
      'dispute_lost'
    )
  ),
  amount_charged_minor bigint not null check (amount_charged_minor > 0),
  amount_reversed_minor bigint check (
    amount_reversed_minor is null
    or amount_reversed_minor between 0 and amount_charged_minor
  ),
  currency text not null check (currency = 'USD'),
  prior_state text not null check (prior_state in ('active', 'held', 'terminated')),
  prior_severity smallint not null check (prior_severity between 0 and 100),
  observed_severity smallint check (observed_severity between 0 and 100),
  resulting_state text not null
    check (resulting_state in ('active', 'held', 'terminated')),
  resulting_severity smallint not null check (resulting_severity between 0 and 100),
  access_consequence text not null,
  credit_consequence text not null,
  quote_consequence text not null,
  owner_review_required boolean not null,
  provider_facts jsonb not null check (
    jsonb_typeof(provider_facts) = 'object'
    and pg_column_size(provider_facts) <= 32768
  ),
  provider_facts_digest ss.sha256_hex not null,
  provider_observed_at timestamptz not null,
  recorded_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (
    organization_id,
    lifecycle_id,
    payment_purpose,
    payment_receipt_id
  ) references ss.service_professional_payment_lifecycles(
    organization_id,
    id,
    payment_purpose,
    payment_receipt_id
  ),
  unique (organization_id, id),
  unique (lifecycle_id, id),
  check (recorded_at >= provider_observed_at),
  check (
    (evidence_certainty = 'ambiguous'
      and outcome is null
      and amount_reversed_minor is null
      and observed_severity is null
      and resulting_state = prior_state
      and resulting_severity = prior_severity
      and owner_review_required)
    or (evidence_certainty = 'verified'
      and outcome is not null
      and amount_reversed_minor is not null
      and observed_severity is not null)
  ),
  check (resulting_severity >= prior_severity),
  check (
    case prior_state when 'active' then 0 when 'held' then 1 else 2 end
    <= case resulting_state when 'active' then 0 when 'held' then 1 else 2 end
  )
);

create table ss.service_professional_reversal_reconciliations (
  id uuid primary key,
  organization_id uuid not null,
  lifecycle_id uuid not null,
  evidence_id uuid not null,
  operator_user_id uuid not null references ss.operator_profiles(user_id),
  command_id text not null check (
    char_length(command_id) between 8 and 200
    and command_id !~ '[[:cntrl:]]'
  ),
  request_digest ss.sha256_hex not null,
  expected_lifecycle_revision bigint not null check (expected_lifecycle_revision > 0),
  resolution text not null check (resolution in ('confirmed', 'not_effective')),
  confirmed_outcome text check (
    confirmed_outcome is null or confirmed_outcome in (
      'refund_failed',
      'dispute_won',
      'dispute_funds_reinstated',
      'dispute_open',
      'refund_partial',
      'dispute_funds_withdrawn',
      'refund_full',
      'dispute_lost'
    )
  ),
  verified_facts jsonb not null check (
    jsonb_typeof(verified_facts) = 'object'
    and pg_column_size(verified_facts) <= 32768
  ),
  verified_facts_digest ss.sha256_hex not null,
  verified_observed_at timestamptz not null,
  prior_state text not null check (prior_state in ('active', 'held', 'terminated')),
  prior_severity smallint not null check (prior_severity between 0 and 100),
  resulting_state text not null
    check (resulting_state in ('active', 'held', 'terminated')),
  resulting_severity smallint not null check (resulting_severity between 0 and 100),
  access_consequence text not null,
  credit_consequence text not null,
  quote_consequence text not null,
  reconciled_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, lifecycle_id)
    references ss.service_professional_payment_lifecycles(organization_id, id),
  foreign key (organization_id, evidence_id)
    references ss.service_professional_reversal_evidence(organization_id, id),
  unique (evidence_id),
  unique (operator_user_id, command_id),
  unique (organization_id, id),
  unique (lifecycle_id, id),
  check (
    (resolution = 'confirmed' and confirmed_outcome is not null)
    or (resolution = 'not_effective' and confirmed_outcome is null)
  ),
  check (resulting_severity >= prior_severity),
  check (
    case prior_state when 'active' then 0 when 'held' then 1 else 2 end
    <= case resulting_state when 'active' then 0 when 'held' then 1 else 2 end
  )
);

alter table ss.service_professional_payment_lifecycles
  add constraint service_professional_lifecycle_latest_evidence_fk
  foreign key (id, latest_evidence_id)
  references ss.service_professional_reversal_evidence(lifecycle_id, id),
  add constraint service_professional_lifecycle_latest_reconciliation_fk
  foreign key (id, latest_reconciliation_id)
  references ss.service_professional_reversal_reconciliations(lifecycle_id, id);

create index service_professional_reversals_by_payment
  on ss.service_professional_reversal_evidence(
    organization_id, payment_purpose, payment_receipt_id, recorded_at
  );

create index service_professional_reversals_reconciliation_queue
  on ss.service_professional_payment_lifecycles(
    organization_id, updated_at, id
  ) where reconciliation_required;

create function ss.service_professional_reversal_severity(selected_outcome text)
returns smallint
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select case selected_outcome
    when 'refund_failed' then 10
    when 'dispute_won' then 20
    when 'dispute_funds_reinstated' then 30
    when 'dispute_open' then 40
    when 'refund_partial' then 50
    when 'dispute_funds_withdrawn' then 60
    when 'refund_full' then 70
    when 'dispute_lost' then 80
  end::smallint
$$;

create function ss.service_professional_reversal_target_state(
  selected_outcome text
)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select case
    when selected_outcome in (
      'refund_full', 'dispute_lost'
    ) then 'terminated'
    when selected_outcome in (
      'dispute_open', 'refund_partial', 'dispute_funds_withdrawn'
    ) then 'held'
    else 'active'
  end
$$;

create function ss.service_professional_state_rank(selected_state text)
returns smallint
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select case selected_state
    when 'active' then 0
    when 'held' then 1
    when 'terminated' then 2
  end::smallint
$$;

create function ss.service_professional_credit_consequence(
  selected_state text,
  selected_credit_state text
)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select case
    when selected_state = 'active' then 'unchanged'
    when selected_credit_state = 'settled'
      then 'preserve_settled_credit_no_reissue'
    when selected_credit_state in ('reserved', 'reconciliation_required')
      then 'freeze_reserved_credit_no_reissue'
    else 'block_unapplied_credit'
  end
$$;

create function ss.service_professional_canonical_json(selected_value jsonb)
returns text
language plpgsql
immutable
parallel safe
set search_path = pg_catalog, ss
as $$
declare
  selected_type text := jsonb_typeof(selected_value);
  result text;
begin
  if selected_type = 'object' then
    select '{' || coalesce(string_agg(
      to_jsonb(entry.key)::text || ':' ||
        ss.service_professional_canonical_json(entry.value),
      ',' order by entry.key collate "C"
    ), '') || '}' into result
    from jsonb_each(selected_value) entry;
    return result;
  elsif selected_type = 'array' then
    select '[' || coalesce(string_agg(
      ss.service_professional_canonical_json(entry.value),
      ',' order by entry.ordinality
    ), '') || ']' into result
    from jsonb_array_elements(selected_value)
      with ordinality as entry(value, ordinality);
    return result;
  elsif selected_type = 'string' then
    return to_jsonb(selected_value #>> '{}')::text;
  end if;
  return selected_value::text;
end
$$;

create function ss.service_professional_json_digest(selected_value jsonb)
returns ss.sha256_hex
language sql
immutable
parallel safe
security definer
set search_path = pg_catalog, extensions, ss
as $$
  select encode(
    extensions.digest(
      convert_to(
        ss.service_professional_canonical_json(selected_value),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )::ss.sha256_hex
$$;

create function ss.service_professional_payment_binding_by_intent(
  target_organization_id uuid,
  target_payment_intent_id text
)
returns table (
  payment_purpose text,
  receipt_id uuid,
  organization_id uuid,
  project_id uuid,
  customer_user_id uuid,
  payment_intent_id text,
  total_minor bigint,
  currency text,
  current_state text,
  current_severity smallint,
  lifecycle_revision bigint,
  credit_state text,
  quote_state text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, ss
as $$
declare
  selected_count integer;
begin
  select count(*) into selected_count
  from ss.service_professional_payment_bindings binding
  where binding.organization_id = target_organization_id
    and binding.payment_intent_id = target_payment_intent_id;
  if selected_count > 1 then
    raise exception 'professional payment intent maps to multiple receipts'
      using errcode = '23514';
  end if;
  return query
  select
    binding.payment_purpose,
    binding.receipt_id,
    binding.organization_id,
    binding.project_id,
    binding.customer_user_id,
    binding.payment_intent_id,
    binding.total_minor,
    binding.currency,
    coalesce(lifecycle.state, 'active'),
    coalesce(lifecycle.severity, 0::smallint),
    coalesce(lifecycle.revision, 0::bigint),
    binding.credit_state,
    binding.quote_state
  from ss.service_professional_payment_bindings binding
  left join ss.service_professional_payment_lifecycles lifecycle
    on lifecycle.payment_purpose = binding.payment_purpose
   and lifecycle.payment_receipt_id = binding.receipt_id
  where binding.organization_id = target_organization_id
    and binding.payment_intent_id = target_payment_intent_id;
end
$$;

create function ss.reject_service_professional_reversal_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'professional reversal evidence is immutable'
    using errcode = '55000';
end
$$;

create function ss.guard_service_professional_lifecycle()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if ss.current_service_actor_org_id() is distinct from new.organization_id
    or ss.current_service_actor_kind() not in ('system', 'operator')
  then
    raise exception 'professional lifecycle lacks exact service authority'
      using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if new.id <> old.id
      or new.organization_id <> old.organization_id
      or new.project_id <> old.project_id
      or new.customer_user_id <> old.customer_user_id
      or new.payment_purpose <> old.payment_purpose
      or new.payment_receipt_id <> old.payment_receipt_id
      or new.assessment_payment_receipt_id
        is distinct from old.assessment_payment_receipt_id
      or new.custom_build_payment_receipt_id
        is distinct from old.custom_build_payment_receipt_id
      or new.custom_build_change_payment_receipt_id
        is distinct from old.custom_build_change_payment_receipt_id
      or new.custom_build_final_payment_receipt_id
        is distinct from old.custom_build_final_payment_receipt_id
      or new.created_at <> old.created_at
      or new.revision <> old.revision + 1
      or new.severity < old.severity
      or ss.service_professional_state_rank(new.state)
        < ss.service_professional_state_rank(old.state)
    then
      raise exception 'professional lifecycle cannot move backward or change identity'
        using errcode = '23514';
    end if;
  end if;
  return new;
end
$$;

create trigger service_professional_lifecycle_guard
before insert or update on ss.service_professional_payment_lifecycles
for each row execute function ss.guard_service_professional_lifecycle();

create trigger service_professional_lifecycle_no_delete
before delete on ss.service_professional_payment_lifecycles
for each row execute function ss.reject_service_professional_reversal_mutation();

create function ss.guard_service_professional_reversal_evidence()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if ss.current_service_actor_kind() <> 'system'
    or ss.current_service_actor_org_id() is distinct from new.organization_id
  then
    raise exception 'professional reversal evidence lacks system authority'
      using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger service_professional_reversal_evidence_guard
before insert on ss.service_professional_reversal_evidence
for each row execute function ss.guard_service_professional_reversal_evidence();

create trigger service_professional_reversal_evidence_immutable
before update or delete on ss.service_professional_reversal_evidence
for each row execute function ss.reject_service_professional_reversal_mutation();

create function ss.guard_service_professional_reconciliation()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if ss.current_service_actor_kind() <> 'operator'
    or ss.current_service_actor_org_id() is distinct from new.organization_id
    or ss.current_service_actor_user_id() is distinct from new.operator_user_id
    or not ss.service_operator_has_capability(
      new.operator_user_id,
      'service_payment_reconcile',
      new.reconciled_at
    )
  then
    raise exception 'professional reversal reconciliation lacks operator authority'
      using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger service_professional_reconciliation_guard
before insert on ss.service_professional_reversal_reconciliations
for each row execute function ss.guard_service_professional_reconciliation();

create trigger service_professional_reconciliation_immutable
before update or delete on ss.service_professional_reversal_reconciliations
for each row execute function ss.reject_service_professional_reversal_mutation();

create function ss.record_service_professional_reversal(
  target_evidence_id uuid,
  target_lifecycle_id uuid,
  target_payment_purpose text,
  target_payment_receipt_id uuid,
  target_provider_event_id text,
  target_provider_event_type text,
  target_payment_intent_id text,
  target_provider_object_id text,
  target_evidence_certainty text,
  target_outcome text,
  target_amount_charged_minor bigint,
  target_amount_reversed_minor bigint,
  target_currency text,
  target_provider_facts jsonb,
  target_provider_facts_digest ss.sha256_hex,
  target_provider_observed_at timestamptz,
  target_recorded_at timestamptz
)
returns table (
  result_status text,
  evidence_id uuid,
  lifecycle_id uuid,
  organization_id uuid,
  project_id uuid,
  customer_user_id uuid,
  payment_purpose text,
  receipt_id uuid,
  lifecycle_state text,
  severity smallint,
  lifecycle_revision bigint,
  access_consequence text,
  credit_consequence text,
  quote_consequence text,
  reconciliation_required boolean
)
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
declare
  binding record;
  retained record;
  lifecycle record;
  selected_observed_severity smallint;
  selected_target_state text;
  selected_resulting_state text;
  selected_resulting_severity smallint;
  selected_access text;
  selected_credit text;
  selected_quote text;
  selected_owner_review boolean;
  selected_status text;
begin
  if ss.current_service_actor_kind() <> 'system'
    or ss.current_service_actor_org_id() is null
  then
    raise exception 'professional reversal recording lacks system authority'
      using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended(target_payment_purpose || ':' || target_payment_receipt_id::text, 108)
  );

  select * into binding
  from ss.service_professional_payment_bindings selected
  where selected.payment_purpose = target_payment_purpose
    and selected.receipt_id = target_payment_receipt_id;
  if not found
    or binding.organization_id <> ss.current_service_actor_org_id()
    or binding.payment_intent_id <> target_payment_intent_id
    or binding.total_minor <> target_amount_charged_minor
    or binding.currency <> target_currency
  then
    raise exception 'professional reversal does not bind one exact paid receipt'
      using errcode = '23514';
  end if;
  if target_recorded_at < target_provider_observed_at
    or target_provider_facts_digest <>
      ss.service_professional_json_digest(target_provider_facts)
    or jsonb_typeof(target_provider_facts) <> 'object'
    or pg_column_size(target_provider_facts) > 32768
  then
    raise exception 'professional reversal provider evidence is invalid'
      using errcode = '23514';
  end if;

  select * into retained
  from ss.service_professional_reversal_evidence evidence
  where evidence.provider_event_id = target_provider_event_id;
  if found then
    if retained.payment_purpose <> target_payment_purpose
      or retained.payment_receipt_id <> target_payment_receipt_id
      or retained.payment_intent_id <> target_payment_intent_id
      or retained.provider_event_type <> target_provider_event_type
      or retained.provider_object_id <> target_provider_object_id
      or retained.evidence_certainty <> target_evidence_certainty
      or retained.outcome is distinct from target_outcome
      or retained.amount_charged_minor <> target_amount_charged_minor
      or retained.amount_reversed_minor is distinct from target_amount_reversed_minor
      or retained.currency <> target_currency
      or retained.provider_facts_digest <> target_provider_facts_digest
      or retained.provider_observed_at <> target_provider_observed_at
    then
      raise exception 'professional reversal event replay changed evidence'
        using errcode = '23514';
    end if;
    return query
    select
      'replay'::text,
      retained.id,
      current_lifecycle.id,
      current_lifecycle.organization_id,
      current_lifecycle.project_id,
      current_lifecycle.customer_user_id,
      current_lifecycle.payment_purpose,
      current_lifecycle.payment_receipt_id,
      current_lifecycle.state,
      current_lifecycle.severity,
      current_lifecycle.revision,
      current_lifecycle.access_consequence,
      current_lifecycle.credit_consequence,
      current_lifecycle.quote_consequence,
      current_lifecycle.reconciliation_required
    from ss.service_professional_payment_lifecycles current_lifecycle
    where current_lifecycle.id = retained.lifecycle_id;
    return;
  end if;

  if target_evidence_certainty not in ('verified', 'ambiguous')
    or not (
      (target_evidence_certainty = 'ambiguous'
        and target_outcome is null
        and target_amount_reversed_minor is null)
      or (target_evidence_certainty = 'verified'
        and ss.service_professional_reversal_severity(target_outcome) is not null
        and target_amount_reversed_minor is not null)
    )
  then
    raise exception 'professional reversal certainty and outcome conflict'
      using errcode = '23514';
  end if;
  if (target_provider_event_type = 'charge.refunded'
      and target_provider_object_id !~ '^ch_[A-Za-z0-9_]+$')
    or (target_provider_event_type in (
        'refund.created', 'refund.updated', 'refund.failed'
      ) and target_provider_object_id !~ '^re_[A-Za-z0-9_]+$')
    or (target_provider_event_type like 'charge.dispute.%'
      and target_provider_object_id !~ '^dp_[A-Za-z0-9_]+$')
  then
    raise exception 'professional reversal provider object does not match its event'
      using errcode = '23514';
  end if;
  if target_evidence_certainty = 'verified' then
    if target_amount_reversed_minor < 0
      or target_amount_reversed_minor > target_amount_charged_minor
      or (target_outcome = 'refund_failed' and target_amount_reversed_minor <> 0)
      or (target_outcome = 'refund_full'
        and target_amount_reversed_minor <> target_amount_charged_minor)
      or (target_outcome in ('dispute_won', 'dispute_funds_reinstated')
        and target_amount_reversed_minor <> 0)
      or (target_outcome in (
          'refund_partial', 'dispute_open',
          'dispute_funds_withdrawn', 'dispute_lost'
        ) and target_amount_reversed_minor <= 0)
      or (target_outcome like 'refund_%'
        and target_provider_event_type not in (
          'charge.refunded', 'refund.created', 'refund.updated', 'refund.failed'
        ))
      or (target_outcome like 'dispute_%'
        and target_provider_event_type not like 'charge.dispute.%')
    then
      raise exception 'professional reversal outcome lacks exact provider facts'
        using errcode = '23514';
    end if;
  end if;

  insert into ss.service_professional_payment_lifecycles (
    id, organization_id, project_id, customer_user_id,
    payment_purpose, payment_receipt_id,
    assessment_payment_receipt_id,
    custom_build_payment_receipt_id,
    custom_build_change_payment_receipt_id,
    custom_build_final_payment_receipt_id,
    credit_state_snapshot, quote_state_snapshot,
    created_at, updated_at
  ) values (
    target_lifecycle_id,
    binding.organization_id,
    binding.project_id,
    binding.customer_user_id,
    binding.payment_purpose,
    binding.receipt_id,
    case when binding.payment_purpose = 'assessment' then binding.receipt_id end,
    case when binding.payment_purpose = 'custom_build_initial' then binding.receipt_id end,
    case when binding.payment_purpose = 'custom_build_change' then binding.receipt_id end,
    case when binding.payment_purpose = 'custom_build_final' then binding.receipt_id end,
    binding.credit_state,
    binding.quote_state,
    target_recorded_at,
    target_recorded_at
  ) on conflict on constraint
    service_professional_lifecycle_payment_uniq do nothing;

  select * into lifecycle
  from ss.service_professional_payment_lifecycles selected
  where selected.payment_purpose = target_payment_purpose
    and selected.payment_receipt_id = target_payment_receipt_id
  for update;

  if target_evidence_certainty = 'ambiguous' then
    selected_observed_severity := null;
    selected_resulting_state := lifecycle.state;
    selected_resulting_severity := lifecycle.severity;
    selected_owner_review := true;
    selected_status := 'reconciliation_required';
  else
    selected_observed_severity :=
      ss.service_professional_reversal_severity(target_outcome);
    selected_target_state :=
      ss.service_professional_reversal_target_state(target_outcome);
    selected_resulting_state := case
      when ss.service_professional_state_rank(selected_target_state)
        > ss.service_professional_state_rank(lifecycle.state)
      then selected_target_state
      else lifecycle.state
    end;
    selected_resulting_severity := greatest(
      lifecycle.severity,
      selected_observed_severity
    );
    selected_owner_review := target_outcome <> 'refund_failed';
    selected_status := 'recorded';
  end if;
  selected_access := case selected_resulting_state
    when 'active' then 'unchanged'
    when 'held' then 'preserve_records_hold_new_work'
    else 'preserve_records_terminate_new_work'
  end;
  selected_credit := ss.service_professional_credit_consequence(
    selected_resulting_state,
    binding.credit_state
  );
  selected_quote := case selected_resulting_state
    when 'active' then 'unchanged'
    when 'held' then 'hold_effective_quote_authority'
    else 'terminate_effective_quote_authority'
  end;

  insert into ss.service_professional_reversal_evidence (
    id, lifecycle_id, organization_id, project_id, customer_user_id,
    payment_purpose, payment_receipt_id, provider, provider_event_id,
    provider_event_type, payment_intent_id, provider_object_id,
    evidence_certainty, outcome, amount_charged_minor,
    amount_reversed_minor, currency, prior_state, prior_severity,
    observed_severity, resulting_state, resulting_severity,
    access_consequence, credit_consequence, quote_consequence,
    owner_review_required, provider_facts, provider_facts_digest,
    provider_observed_at, recorded_at, created_at
  ) values (
    target_evidence_id, lifecycle.id, binding.organization_id,
    binding.project_id, binding.customer_user_id,
    binding.payment_purpose, binding.receipt_id, 'stripe',
    target_provider_event_id, target_provider_event_type,
    target_payment_intent_id, target_provider_object_id,
    target_evidence_certainty, target_outcome,
    target_amount_charged_minor, target_amount_reversed_minor,
    target_currency, lifecycle.state, lifecycle.severity,
    selected_observed_severity, selected_resulting_state,
    selected_resulting_severity, selected_access, selected_credit,
    selected_quote, selected_owner_review, target_provider_facts,
    target_provider_facts_digest, target_provider_observed_at,
    target_recorded_at, target_recorded_at
  );

  update ss.service_professional_payment_lifecycles updated
  set state = selected_resulting_state,
      severity = selected_resulting_severity,
      revision = updated.revision + 1,
      credit_state_snapshot = binding.credit_state,
      quote_state_snapshot = binding.quote_state,
      access_consequence = selected_access,
      credit_consequence = selected_credit,
      quote_consequence = selected_quote,
      reconciliation_required =
        updated.reconciliation_required
        or target_evidence_certainty = 'ambiguous',
      latest_evidence_id = target_evidence_id,
      updated_at = target_recorded_at
  where updated.id = lifecycle.id;

  return query
  select
    selected_status,
    target_evidence_id,
    current_lifecycle.id,
    current_lifecycle.organization_id,
    current_lifecycle.project_id,
    current_lifecycle.customer_user_id,
    current_lifecycle.payment_purpose,
    current_lifecycle.payment_receipt_id,
    current_lifecycle.state,
    current_lifecycle.severity,
    current_lifecycle.revision,
    current_lifecycle.access_consequence,
    current_lifecycle.credit_consequence,
    current_lifecycle.quote_consequence,
    current_lifecycle.reconciliation_required
  from ss.service_professional_payment_lifecycles current_lifecycle
  where current_lifecycle.id = lifecycle.id;
end
$$;

create function ss.reconcile_service_professional_reversal(
  target_reconciliation_id uuid,
  target_organization_id uuid,
  target_evidence_id uuid,
  target_operator_user_id uuid,
  target_command_id text,
  target_expected_lifecycle_revision bigint,
  target_resolution text,
  target_verified_facts jsonb,
  target_verified_facts_digest ss.sha256_hex,
  target_verified_observed_at timestamptz,
  target_confirmed_outcome text,
  target_reconciled_at timestamptz
)
returns table (
  result_status text,
  evidence_id uuid,
  lifecycle_id uuid,
  organization_id uuid,
  project_id uuid,
  customer_user_id uuid,
  payment_purpose text,
  receipt_id uuid,
  lifecycle_state text,
  severity smallint,
  lifecycle_revision bigint,
  access_consequence text,
  credit_consequence text,
  quote_consequence text,
  reconciliation_required boolean
)
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
declare
  evidence record;
  lifecycle record;
  retained record;
  binding record;
  selected_request_digest ss.sha256_hex;
  selected_target_state text;
  selected_resulting_state text;
  selected_resulting_severity smallint;
  selected_access text;
  selected_credit text;
  selected_quote text;
  selected_pending boolean;
begin
  if ss.current_service_actor_kind() <> 'operator'
    or ss.current_service_actor_user_id() is distinct from target_operator_user_id
    or ss.current_service_actor_org_id() is distinct from target_organization_id
    or not ss.service_operator_has_capability(
      target_operator_user_id,
      'service_payment_reconcile',
      target_reconciled_at
    )
  then
    raise exception 'professional reversal reconciliation lacks exact operator authority'
      using errcode = '42501';
  end if;
  if target_reconciled_at < target_verified_observed_at
    or target_verified_facts_digest <>
      ss.service_professional_json_digest(target_verified_facts)
    or jsonb_typeof(target_verified_facts) <> 'object'
    or pg_column_size(target_verified_facts) > 32768
  then
    raise exception 'professional reversal reconciliation facts are invalid'
      using errcode = '23514';
  end if;
  selected_request_digest := ss.service_json_digest(jsonb_build_object(
    'organizationId', target_organization_id,
    'evidenceId', target_evidence_id,
    'operatorId', target_operator_user_id,
    'commandId', target_command_id,
    'expectedLifecycleRevision', target_expected_lifecycle_revision,
    'resolution', target_resolution,
    'confirmedOutcome', target_confirmed_outcome,
    'verifiedFactsDigest', target_verified_facts_digest,
    'verifiedObservedAt', target_verified_observed_at
  ));

  select * into retained
  from ss.service_professional_reversal_reconciliations reconciliation
  where reconciliation.operator_user_id = target_operator_user_id
    and reconciliation.command_id = target_command_id;
  if found then
    if retained.request_digest <> selected_request_digest then
      raise exception 'professional reversal reconciliation replay changed'
        using errcode = '23514';
    end if;
    return query
    select
      'replay'::text,
      retained.evidence_id,
      current_lifecycle.id,
      current_lifecycle.organization_id,
      current_lifecycle.project_id,
      current_lifecycle.customer_user_id,
      current_lifecycle.payment_purpose,
      current_lifecycle.payment_receipt_id,
      current_lifecycle.state,
      current_lifecycle.severity,
      current_lifecycle.revision,
      current_lifecycle.access_consequence,
      current_lifecycle.credit_consequence,
      current_lifecycle.quote_consequence,
      current_lifecycle.reconciliation_required
    from ss.service_professional_payment_lifecycles current_lifecycle
    where current_lifecycle.id = retained.lifecycle_id;
    return;
  end if;

  select selected_evidence.*
  into evidence
  from ss.service_professional_reversal_evidence selected_evidence
  join ss.service_professional_payment_lifecycles selected_lifecycle
    on selected_lifecycle.id = selected_evidence.lifecycle_id
  where selected_evidence.organization_id = target_organization_id
    and selected_evidence.id = target_evidence_id
  for update of selected_lifecycle;
  if not found
    or evidence.evidence_certainty <> 'ambiguous'
    or exists (
      select 1
      from ss.service_professional_reversal_reconciliations prior
      where prior.evidence_id = target_evidence_id
    )
  then
    raise exception 'professional reversal reconciliation is stale or unavailable'
      using errcode = '40001';
  end if;
  select * into lifecycle
  from ss.service_professional_payment_lifecycles selected
  where selected.id = evidence.lifecycle_id;
  if lifecycle.revision <> target_expected_lifecycle_revision then
    raise exception 'professional reversal reconciliation revision is stale'
      using errcode = '40001';
  end if;

  select * into binding
  from ss.service_professional_payment_bindings selected
  where selected.payment_purpose = evidence.payment_purpose
    and selected.receipt_id = evidence.payment_receipt_id;
  if not found then
    raise exception 'professional reversal lost its paid receipt binding'
      using errcode = '23514';
  end if;

  if (select count(*) from jsonb_object_keys(target_verified_facts)) <> 7
    or not target_verified_facts ?& array[
      'amountChargedMinor',
      'amountReversedMinor',
      'currency',
      'paymentIntentId',
      'providerEffectAuthorized',
      'providerObjectId',
      'schema'
    ]
    or target_verified_facts->>'schema'
      <> 'sitesourcery.stripe-professional-reversal-readback/v1'
    or target_verified_facts->>'paymentIntentId' <> evidence.payment_intent_id
    or target_verified_facts->>'providerObjectId' <> evidence.provider_object_id
    or (target_verified_facts->>'amountChargedMinor')::bigint
      <> evidence.amount_charged_minor
    or target_verified_facts->>'currency' <> evidence.currency
    or (target_verified_facts->>'providerEffectAuthorized')::boolean
  then
    raise exception 'professional reversal reconciliation readback is not exact'
      using errcode = '23514';
  end if;

  if target_resolution = 'not_effective' then
    if target_confirmed_outcome is not null
      or (target_verified_facts->>'amountReversedMinor')::bigint <> 0
    then
      raise exception 'non-effective reconciliation cannot carry a reversal'
        using errcode = '23514';
    end if;
    selected_resulting_state := lifecycle.state;
    selected_resulting_severity := lifecycle.severity;
  elsif target_resolution = 'confirmed'
    and ss.service_professional_reversal_severity(target_confirmed_outcome) is not null
  then
    if (target_confirmed_outcome like 'refund_%'
        and evidence.provider_event_type not in (
          'charge.refunded', 'refund.created', 'refund.updated', 'refund.failed'
        ))
      or (target_confirmed_outcome like 'dispute_%'
        and evidence.provider_event_type not like 'charge.dispute.%')
      or (target_verified_facts->>'amountReversedMinor')::bigint < 0
      or (target_verified_facts->>'amountReversedMinor')::bigint
        > evidence.amount_charged_minor
      or (target_confirmed_outcome = 'refund_failed'
        and (target_verified_facts->>'amountReversedMinor')::bigint <> 0)
      or (target_confirmed_outcome = 'refund_full'
        and (target_verified_facts->>'amountReversedMinor')::bigint
          <> evidence.amount_charged_minor)
      or (target_confirmed_outcome in ('dispute_won', 'dispute_funds_reinstated')
        and (target_verified_facts->>'amountReversedMinor')::bigint <> 0)
      or (target_confirmed_outcome in (
          'refund_partial', 'dispute_open',
          'dispute_funds_withdrawn', 'dispute_lost'
        ) and (target_verified_facts->>'amountReversedMinor')::bigint <= 0)
    then
      raise exception 'confirmed professional reversal amount is invalid'
        using errcode = '23514';
    end if;
    selected_target_state :=
      ss.service_professional_reversal_target_state(target_confirmed_outcome);
    selected_resulting_state := case
      when ss.service_professional_state_rank(selected_target_state)
        > ss.service_professional_state_rank(lifecycle.state)
      then selected_target_state
      else lifecycle.state
    end;
    selected_resulting_severity := greatest(
      lifecycle.severity,
      ss.service_professional_reversal_severity(target_confirmed_outcome)
    );
  else
    raise exception 'professional reversal reconciliation resolution is invalid'
      using errcode = '23514';
  end if;

  selected_access := case selected_resulting_state
    when 'active' then 'unchanged'
    when 'held' then 'preserve_records_hold_new_work'
    else 'preserve_records_terminate_new_work'
  end;
  selected_credit := ss.service_professional_credit_consequence(
    selected_resulting_state,
    binding.credit_state
  );
  selected_quote := case selected_resulting_state
    when 'active' then 'unchanged'
    when 'held' then 'hold_effective_quote_authority'
    else 'terminate_effective_quote_authority'
  end;

  insert into ss.service_professional_reversal_reconciliations (
    id, organization_id, lifecycle_id, evidence_id, operator_user_id,
    command_id, request_digest, expected_lifecycle_revision,
    resolution, confirmed_outcome, verified_facts, verified_facts_digest,
    verified_observed_at, prior_state, prior_severity,
    resulting_state, resulting_severity, access_consequence,
    credit_consequence, quote_consequence, reconciled_at, created_at
  ) values (
    target_reconciliation_id, target_organization_id, lifecycle.id,
    target_evidence_id, target_operator_user_id, target_command_id,
    selected_request_digest, target_expected_lifecycle_revision,
    target_resolution, target_confirmed_outcome, target_verified_facts,
    target_verified_facts_digest, target_verified_observed_at,
    lifecycle.state, lifecycle.severity, selected_resulting_state,
    selected_resulting_severity, selected_access, selected_credit,
    selected_quote, target_reconciled_at, target_reconciled_at
  );

  select exists (
    select 1
    from ss.service_professional_reversal_evidence unresolved
    left join ss.service_professional_reversal_reconciliations resolution
      on resolution.evidence_id = unresolved.id
    where unresolved.lifecycle_id = lifecycle.id
      and unresolved.evidence_certainty = 'ambiguous'
      and resolution.id is null
  ) into selected_pending;

  update ss.service_professional_payment_lifecycles updated
  set state = selected_resulting_state,
      severity = selected_resulting_severity,
      revision = updated.revision + 1,
      credit_state_snapshot = binding.credit_state,
      quote_state_snapshot = binding.quote_state,
      access_consequence = selected_access,
      credit_consequence = selected_credit,
      quote_consequence = selected_quote,
      reconciliation_required = selected_pending,
      latest_reconciliation_id = target_reconciliation_id,
      updated_at = target_reconciled_at
  where updated.id = lifecycle.id;

  return query
  select
    'reconciled'::text,
    target_evidence_id,
    current_lifecycle.id,
    current_lifecycle.organization_id,
    current_lifecycle.project_id,
    current_lifecycle.customer_user_id,
    current_lifecycle.payment_purpose,
    current_lifecycle.payment_receipt_id,
    current_lifecycle.state,
    current_lifecycle.severity,
    current_lifecycle.revision,
    current_lifecycle.access_consequence,
    current_lifecycle.credit_consequence,
    current_lifecycle.quote_consequence,
    current_lifecycle.reconciliation_required
  from ss.service_professional_payment_lifecycles current_lifecycle
  where current_lifecycle.id = lifecycle.id;
end
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'service_professional_payment_lifecycles',
    'service_professional_reversal_evidence',
    'service_professional_reversal_reconciliations'
  ] loop
    execute format('alter table ss.%I enable row level security', table_name);
    execute format('alter table ss.%I force row level security', table_name);
    execute format(
      'revoke all on table ss.%I from public, anon, authenticated, service_role',
      table_name
    );
    execute format('grant select on table ss.%I to service_role', table_name);
  end loop;
end
$$;

do $$
declare
  function_signature regprocedure;
begin
  foreach function_signature in array array[
    'ss.service_professional_reversal_severity(text)'::regprocedure,
    'ss.service_professional_reversal_target_state(text)'::regprocedure,
    'ss.service_professional_state_rank(text)'::regprocedure,
    'ss.service_professional_credit_consequence(text,text)'::regprocedure,
    'ss.service_professional_canonical_json(jsonb)'::regprocedure,
    'ss.service_professional_json_digest(jsonb)'::regprocedure,
    'ss.service_professional_payment_binding_by_intent(uuid,text)'::regprocedure,
    'ss.reject_service_professional_reversal_mutation()'::regprocedure,
    'ss.guard_service_professional_lifecycle()'::regprocedure,
    'ss.guard_service_professional_reversal_evidence()'::regprocedure,
    'ss.guard_service_professional_reconciliation()'::regprocedure,
    'ss.record_service_professional_reversal(uuid,uuid,text,uuid,text,text,text,text,text,text,bigint,bigint,text,jsonb,ss.sha256_hex,timestamptz,timestamptz)'::regprocedure,
    'ss.reconcile_service_professional_reversal(uuid,uuid,uuid,uuid,text,bigint,text,jsonb,ss.sha256_hex,timestamptz,text,timestamptz)'::regprocedure
  ] loop
    execute format(
      'revoke all on function %s from public, anon, authenticated, service_role',
      function_signature
    );
  end loop;
end
$$;

grant execute on function
  ss.service_professional_payment_binding_by_intent(uuid, text),
  ss.record_service_professional_reversal(
    uuid, uuid, text, uuid, text, text, text, text, text, text,
    bigint, bigint, text, jsonb, ss.sha256_hex, timestamptz, timestamptz
  ),
  ss.reconcile_service_professional_reversal(
    uuid, uuid, uuid, uuid, text, bigint, text, jsonb,
    ss.sha256_hex, timestamptz, text, timestamptz
  )
to service_role;

do $$
begin
  if has_table_privilege(
      'service_role',
      'ss.service_professional_payment_lifecycles',
      'INSERT'
    )
    or has_table_privilege(
      'service_role',
      'ss.service_professional_reversal_evidence',
      'UPDATE'
    )
    or has_table_privilege(
      'authenticated',
      'ss.service_professional_payment_lifecycles',
      'SELECT'
    )
    or has_table_privilege(
      'anon',
      'ss.service_professional_reversal_evidence',
      'SELECT'
    )
  then
    raise exception 'professional reversal privilege boundary is unsafe'
      using errcode = '55000';
  end if;
end
$$;

create function ss.hosted_runtime_contract_v108()
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select 'canonical-ss-v108-professional-services-reversals'::text
$$;

revoke all on function ss.hosted_runtime_contract_v108()
from public, anon, authenticated;
grant execute on function ss.hosted_runtime_contract_v108()
to service_role;

commit;
