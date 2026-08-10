-- ACCOUNTING-01
begin;

do $$
begin
  if to_regprocedure('ss.service_json_digest(jsonb)') is null
    or to_regprocedure('ss.current_service_actor_kind()') is null
    or to_regprocedure('ss.current_service_actor_user_id()') is null
    or to_regprocedure(
      'ss.service_operator_has_capability(uuid,text,timestamp with time zone)'
    ) is null
    or to_regclass('ss.commerce_v2_download_payment_receipts') is null
    or to_regclass('ss.commerce_v2_download_stripe_events') is null
    or to_regclass('ss.service_assessment_payment_receipts') is null
    or to_regclass('ss.service_custom_build_payment_receipts') is null
    or to_regclass('ss.service_custom_build_change_payment_receipts') is null
    or to_regclass('ss.service_custom_build_final_payment_receipts') is null
    or to_regclass('ss.alakazam_payment_receipts') is null
    or to_regclass('ss.domain_payment_allocations') is null
    or to_regclass('ss.provider_receipts') is null
  then
    raise exception
      'authoritative receipt and operator foundations must precede ACCOUNTING-01'
      using errcode = '55000';
  end if;
end
$$;

create function ss.accounting_purpose_evidence_digests_are_valid(
  selected_digests jsonb
)
returns boolean
language sql
immutable
parallel safe
set search_path = pg_catalog, ss
as $$
  select
    jsonb_typeof(selected_digests) = 'object'
    and pg_column_size(selected_digests) <= 4096
    and (
      select count(*) between 1 and 8
        and bool_and(
          digest_record.key ~ '^[a-z][A-Za-z0-9]{2,79}$'
          and digest_record.value ~ '^[0-9a-f]{64}$'
        )
      from jsonb_each_text(selected_digests) digest_record
    )
$$;

create function ss.accounting_purpose_idempotency_digest(
  selected_source_relation text,
  selected_source_receipt_id text
)
returns ss.sha256_hex
language sql
immutable
parallel safe
set search_path = pg_catalog, ss
as $$
  select ss.service_json_digest(jsonb_build_object(
    'schema', 'sitesourcery.accounting-purpose-idempotency/v1',
    'sourceReceiptId', selected_source_receipt_id,
    'sourceRelation', selected_source_relation
  ))
$$;

create function ss.accounting_purpose_entry_digest(
  selected_source_relation text,
  selected_source_receipt_id text,
  selected_organization_id uuid,
  selected_project_id uuid,
  selected_purpose text,
  selected_charged_amount_minor bigint,
  selected_tax_minor bigint,
  selected_tax_mode text,
  selected_tax_evidence_state text,
  selected_fee_minor bigint,
  selected_fee_evidence_state text,
  selected_payout_available_at timestamptz,
  selected_payout_aging_state text,
  selected_currency text,
  selected_evidence_digests jsonb,
  selected_occurred_at timestamptz
)
returns ss.sha256_hex
language sql
immutable
parallel safe
set search_path = pg_catalog, ss
as $$
  select ss.service_json_digest(jsonb_build_object(
    'chargedAmountMinor', selected_charged_amount_minor,
    'currency', selected_currency,
    'evidenceDigests', selected_evidence_digests,
    'feeEvidenceState', selected_fee_evidence_state,
    'feeMinor', selected_fee_minor,
    'occurredAt', selected_occurred_at,
    'organizationId', selected_organization_id,
    'payoutAgingState', selected_payout_aging_state,
    'payoutAvailableAt', selected_payout_available_at,
    'projectId', selected_project_id,
    'purpose', selected_purpose,
    'schema', 'sitesourcery.accounting-purpose-journal-entry/v1',
    'sourceReceiptId', selected_source_receipt_id,
    'sourceRelation', selected_source_relation,
    'taxEvidenceState', selected_tax_evidence_state,
    'taxMinor', selected_tax_minor,
    'taxMode', selected_tax_mode
  ))
$$;

create function ss.accounting_purpose_source_projection_v1()
returns table (
  source_relation text,
  source_receipt_id text,
  organization_id uuid,
  project_id uuid,
  purpose text,
  charged_amount_minor bigint,
  tax_minor bigint,
  tax_mode text,
  tax_evidence_state text,
  fee_minor bigint,
  fee_evidence_state text,
  payout_available_at timestamptz,
  payout_aging_state text,
  currency text,
  evidence_digests jsonb,
  occurred_at timestamptz,
  idempotency_digest ss.sha256_hex,
  entry_digest ss.sha256_hex
)
language sql
stable
security definer
set search_path = pg_catalog, ss
as $$
  with source_rows as (
    select
      'ss.commerce_v2_download_payment_receipts'::text as source_relation,
      receipt.id::text as source_receipt_id,
      receipt.organization_id,
      receipt.project_id,
      'download_purchase'::text as purpose,
      receipt.total_minor::bigint as charged_amount_minor,
      receipt.tax_minor::bigint as tax_minor,
      receipt.tax_mode,
      'evidenced'::text as tax_evidence_state,
      null::bigint as fee_minor,
      'not_present_in_source'::text as fee_evidence_state,
      null::timestamptz as payout_available_at,
      'not_present_in_source'::text as payout_aging_state,
      receipt.currency,
      jsonb_build_object(
        'acceptedDisclosure', receipt.accepted_disclosure_digest,
        'providerEventPayload', event.payload_digest,
        'purpose', receipt.purpose_digest
      ) as evidence_digests,
      receipt.settled_at as occurred_at
    from ss.commerce_v2_download_payment_receipts receipt
    join ss.commerce_v2_download_stripe_events event
      on event.id = receipt.stripe_event_id
     and event.organization_id = receipt.organization_id

    union all
    select
      'ss.service_assessment_payment_receipts', receipt.id::text,
      receipt.organization_id, receipt.project_id,
      'assessment_payment', receipt.total_minor, receipt.tax_minor,
      receipt.tax_mode, 'evidenced', null, 'not_present_in_source',
      null, 'not_present_in_source', receipt.currency,
      jsonb_build_object(
        'acceptedDisclosure', receipt.accepted_disclosure_digest,
        'invoice', receipt.invoice_digest,
        'providerFacts', receipt.provider_facts_digest,
        'purpose', receipt.purpose_digest
      ),
      receipt.settled_at
    from ss.service_assessment_payment_receipts receipt

    union all
    select
      'ss.service_custom_build_payment_receipts', receipt.id::text,
      receipt.organization_id, receipt.project_id,
      'custom_start_payment', receipt.total_minor, receipt.tax_minor,
      receipt.tax_mode, 'evidenced', null, 'not_present_in_source',
      null, 'not_present_in_source', receipt.currency,
      jsonb_build_object(
        'acceptedDisclosure', receipt.accepted_disclosure_digest,
        'acceptedQuote', receipt.accepted_quote_digest,
        'invoice', receipt.invoice_digest,
        'providerFacts', receipt.provider_facts_digest,
        'purpose', receipt.purpose_digest
      ),
      receipt.settled_at
    from ss.service_custom_build_payment_receipts receipt

    union all
    select
      'ss.service_custom_build_change_payment_receipts', receipt.id::text,
      receipt.organization_id, receipt.project_id,
      'custom_change_payment', receipt.total_minor, receipt.tax_minor,
      receipt.tax_mode, 'evidenced', null, 'not_present_in_source',
      null, 'not_present_in_source', receipt.currency,
      jsonb_build_object(
        'acceptedDisclosure', receipt.accepted_disclosure_digest,
        'acceptedQuote', receipt.accepted_quote_digest,
        'invoice', receipt.invoice_digest,
        'providerFacts', receipt.provider_facts_digest,
        'purpose', receipt.purpose_digest
      ),
      receipt.settled_at
    from ss.service_custom_build_change_payment_receipts receipt

    union all
    select
      'ss.service_custom_build_final_payment_receipts', receipt.id::text,
      receipt.organization_id, receipt.project_id,
      'custom_final_payment', receipt.total_minor, receipt.tax_minor,
      receipt.tax_mode, 'evidenced', null, 'not_present_in_source',
      null, 'not_present_in_source', receipt.currency,
      jsonb_build_object(
        'acceptedDisclosure', receipt.accepted_disclosure_digest,
        'acceptedQuote', receipt.accepted_quote_digest,
        'completionPackage', receipt.completion_package_digest,
        'invoice', receipt.invoice_digest,
        'obligation', receipt.obligation_digest,
        'providerFacts', receipt.provider_facts_digest,
        'purpose', receipt.purpose_digest
      ),
      receipt.settled_at
    from ss.service_custom_build_final_payment_receipts receipt

    union all
    select
      'ss.alakazam_payment_receipts', receipt.id::text,
      receipt.organization_id, receipt.project_id,
      case receipt.receipt_kind
        when 'start_payment' then 'alakazam_start_payment'
        when 'upgrade_difference' then 'alakazam_upgrade_difference'
        when 'renewal_payment' then 'alakazam_renewal_payment'
      end,
      receipt.total_minor, receipt.tax_minor, receipt.tax_mode,
      'evidenced', null, 'not_present_in_source', null,
      'not_present_in_source', receipt.currency,
      jsonb_build_object('providerFacts', receipt.provider_facts_digest),
      receipt.settled_at
    from ss.alakazam_payment_receipts receipt

    union all
    select
      'ss.provider_receipts', receipt.id::text,
      receipt.organization_id, receipt.project_id,
      'domain_payment', allocation.amount_minor, null, null,
      'not_present_in_source', null, 'not_present_in_source', null,
      'not_present_in_source', allocation.currency,
      jsonb_build_object('providerReceiptFacts', receipt.facts_digest),
      receipt.occurred_at
    from ss.provider_receipts receipt
    join ss.domain_payment_allocations allocation
      on allocation.organization_id = receipt.organization_id
     and allocation.project_id = receipt.project_id
     and allocation.stripe_payment_reference = receipt.external_object_ref
     and allocation.currency = receipt.facts ->> 'currency'
     and allocation.amount_minor =
       (receipt.facts ->> 'amountMinor')::bigint
    where receipt.provider_code = 'stripe'
      and receipt.receipt_kind = 'domain_payment_captured'
  ), identified as (
    select
      source_rows.*,
      ss.accounting_purpose_idempotency_digest(
        source_rows.source_relation,
        source_rows.source_receipt_id
      ) as idempotency_digest
    from source_rows
  )
  select
    identified.*,
    ss.accounting_purpose_entry_digest(
      identified.source_relation,
      identified.source_receipt_id,
      identified.organization_id,
      identified.project_id,
      identified.purpose,
      identified.charged_amount_minor,
      identified.tax_minor,
      identified.tax_mode,
      identified.tax_evidence_state,
      identified.fee_minor,
      identified.fee_evidence_state,
      identified.payout_available_at,
      identified.payout_aging_state,
      identified.currency,
      identified.evidence_digests,
      identified.occurred_at
    ) as entry_digest
  from identified
$$;

create table ss.accounting_purpose_journal (
  idempotency_digest ss.sha256_hex primary key,
  source_relation text not null check (
    source_relation in (
      'ss.commerce_v2_download_payment_receipts',
      'ss.service_assessment_payment_receipts',
      'ss.service_custom_build_payment_receipts',
      'ss.service_custom_build_change_payment_receipts',
      'ss.service_custom_build_final_payment_receipts',
      'ss.alakazam_payment_receipts',
      'ss.provider_receipts'
    )
  ),
  source_receipt_id text not null check (
    source_receipt_id ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  organization_id uuid not null,
  project_id uuid not null,
  purpose text not null check (
    purpose in (
      'download_purchase',
      'assessment_payment',
      'custom_start_payment',
      'custom_change_payment',
      'custom_final_payment',
      'alakazam_start_payment',
      'alakazam_upgrade_difference',
      'alakazam_renewal_payment',
      'domain_payment'
    )
  ),
  charged_amount_minor bigint not null check (charged_amount_minor >= 0),
  tax_minor bigint check (tax_minor >= 0),
  tax_mode text check (
    tax_mode is null
    or tax_mode in ('automatic', 'disabled_by_owner')
  ),
  tax_evidence_state text not null check (
    tax_evidence_state in ('evidenced', 'not_present_in_source')
  ),
  fee_minor bigint check (fee_minor >= 0),
  fee_evidence_state text not null check (
    fee_evidence_state = 'not_present_in_source'
  ),
  payout_available_at timestamptz,
  payout_aging_state text not null check (
    payout_aging_state = 'not_present_in_source'
  ),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  evidence_digests jsonb not null check (
    ss.accounting_purpose_evidence_digests_are_valid(evidence_digests)
  ),
  occurred_at timestamptz not null,
  projected_at timestamptz not null default clock_timestamp(),
  entry_digest ss.sha256_hex not null,
  unique (source_relation, source_receipt_id),
  check (projected_at >= occurred_at),
  check (
    (tax_evidence_state = 'evidenced'
      and tax_minor is not null and tax_mode is not null)
    or (tax_evidence_state = 'not_present_in_source'
      and tax_minor is null and tax_mode is null)
  ),
  check (fee_minor is null),
  check (payout_available_at is null),
  check (
    (source_relation = 'ss.commerce_v2_download_payment_receipts'
      and purpose = 'download_purchase')
    or (source_relation = 'ss.service_assessment_payment_receipts'
      and purpose = 'assessment_payment')
    or (source_relation = 'ss.service_custom_build_payment_receipts'
      and purpose = 'custom_start_payment')
    or (source_relation = 'ss.service_custom_build_change_payment_receipts'
      and purpose = 'custom_change_payment')
    or (source_relation = 'ss.service_custom_build_final_payment_receipts'
      and purpose = 'custom_final_payment')
    or (source_relation = 'ss.alakazam_payment_receipts'
      and purpose in (
        'alakazam_start_payment',
        'alakazam_upgrade_difference',
        'alakazam_renewal_payment'
      ))
    or (source_relation = 'ss.provider_receipts'
      and purpose = 'domain_payment')
  ),
  check (
    idempotency_digest = ss.accounting_purpose_idempotency_digest(
      source_relation, source_receipt_id
    )
  ),
  check (
    entry_digest = ss.accounting_purpose_entry_digest(
      source_relation, source_receipt_id, organization_id, project_id,
      purpose, charged_amount_minor, tax_minor, tax_mode,
      tax_evidence_state, fee_minor, fee_evidence_state,
      payout_available_at, payout_aging_state, currency,
      evidence_digests, occurred_at
    )
  )
);

create index accounting_purpose_journal_chronology
  on ss.accounting_purpose_journal(occurred_at, idempotency_digest);

create index accounting_purpose_journal_scope
  on ss.accounting_purpose_journal(
    organization_id, project_id, occurred_at, idempotency_digest
  );

create function ss.guard_accounting_purpose_journal()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  expected record;
begin
  if tg_op <> 'INSERT'
    or not (
      ss.current_service_actor_kind() = 'system'
      or (
        ss.current_service_actor_kind() = 'operator'
        and ss.service_operator_has_capability(
          ss.current_service_actor_user_id(),
          'service_management_manage',
          clock_timestamp()
        )
      )
    )
  then
    raise exception
      'accounting purpose journal mutation lacks exact authority'
      using errcode = '42501';
  end if;

  select * into expected
  from ss.accounting_purpose_source_projection_v1() projection
  where projection.source_relation = new.source_relation
    and projection.source_receipt_id = new.source_receipt_id;

  if not found
    or row(
      new.organization_id, new.project_id, new.purpose,
      new.charged_amount_minor, new.tax_minor, new.tax_mode,
      new.tax_evidence_state, new.fee_minor, new.fee_evidence_state,
      new.payout_available_at, new.payout_aging_state, new.currency,
      new.evidence_digests, new.occurred_at,
      new.idempotency_digest, new.entry_digest
    ) is distinct from row(
      expected.organization_id, expected.project_id, expected.purpose,
      expected.charged_amount_minor, expected.tax_minor, expected.tax_mode,
      expected.tax_evidence_state, expected.fee_minor,
      expected.fee_evidence_state, expected.payout_available_at,
      expected.payout_aging_state, expected.currency,
      expected.evidence_digests, expected.occurred_at,
      expected.idempotency_digest, expected.entry_digest
    )
  then
    raise exception
      'accounting purpose journal entry does not match source evidence'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger accounting_purpose_journal_guard
before insert or update or delete on ss.accounting_purpose_journal
for each row execute function ss.guard_accounting_purpose_journal();

create function ss.project_accounting_purpose_journal_v1()
returns table (
  source_count bigint,
  inserted_count bigint,
  journal_count bigint
)
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
declare
  inserted_rows bigint := 0;
begin
  if not (
    ss.current_service_actor_kind() = 'system'
    or (
      ss.current_service_actor_kind() = 'operator'
      and ss.service_operator_has_capability(
        ss.current_service_actor_user_id(),
        'service_management_manage',
        clock_timestamp()
      )
    )
  )
  then
    raise exception
      'accounting purpose projection lacks exact authority'
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'sitesourcery.accounting-purpose-journal/v1', 0
  ));

  insert into ss.accounting_purpose_journal (
    idempotency_digest, source_relation, source_receipt_id,
    organization_id, project_id, purpose, charged_amount_minor,
    tax_minor, tax_mode, tax_evidence_state, fee_minor,
    fee_evidence_state, payout_available_at, payout_aging_state,
    currency, evidence_digests, occurred_at, projected_at, entry_digest
  )
  select
    projection.idempotency_digest, projection.source_relation,
    projection.source_receipt_id, projection.organization_id,
    projection.project_id, projection.purpose,
    projection.charged_amount_minor, projection.tax_minor,
    projection.tax_mode, projection.tax_evidence_state,
    projection.fee_minor, projection.fee_evidence_state,
    projection.payout_available_at, projection.payout_aging_state,
    projection.currency, projection.evidence_digests,
    projection.occurred_at, clock_timestamp(), projection.entry_digest
  from ss.accounting_purpose_source_projection_v1() projection
  on conflict (source_relation, source_receipt_id) do nothing;
  get diagnostics inserted_rows = row_count;

  if exists (
    select 1
    from ss.accounting_purpose_source_projection_v1() projection
    join ss.accounting_purpose_journal journal
      on journal.source_relation = projection.source_relation
     and journal.source_receipt_id = projection.source_receipt_id
    where journal.idempotency_digest <> projection.idempotency_digest
      or journal.entry_digest <> projection.entry_digest
  )
  then
    raise exception
      'accounting purpose source replay changed immutable evidence'
      using errcode = '55000';
  end if;

  return query
  select
    (select count(*)
       from ss.accounting_purpose_source_projection_v1()),
    inserted_rows,
    (select count(*) from ss.accounting_purpose_journal);
end
$$;

alter table ss.accounting_purpose_journal enable row level security;
alter table ss.accounting_purpose_journal force row level security;

revoke all on table ss.accounting_purpose_journal
from public, anon, authenticated, service_role;
grant select on table ss.accounting_purpose_journal to service_role;

revoke all on function ss.accounting_purpose_evidence_digests_are_valid(jsonb)
from public, anon, authenticated, service_role;
revoke all on function ss.accounting_purpose_idempotency_digest(text, text)
from public, anon, authenticated, service_role;
revoke all on function ss.accounting_purpose_entry_digest(
  text, text, uuid, uuid, text, bigint, bigint, text, text, bigint,
  text, timestamptz, text, text, jsonb, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function ss.accounting_purpose_source_projection_v1()
from public, anon, authenticated, service_role;
revoke all on function ss.guard_accounting_purpose_journal()
from public, anon, authenticated, service_role;
revoke all on function ss.project_accounting_purpose_journal_v1()
from public, anon, authenticated;
grant execute on function ss.project_accounting_purpose_journal_v1()
to service_role;

create function ss.hosted_accounting_purpose_journal_contract_v1()
returns text
language sql
stable
set search_path = pg_catalog
as $$
  select
    'canonical-accounting-purpose-journal-v1-projection-only-held'::text
$$;

revoke all on function ss.hosted_accounting_purpose_journal_contract_v1()
from public, anon, authenticated, service_role;
grant execute on function ss.hosted_accounting_purpose_journal_contract_v1()
to service_role;

commit;
