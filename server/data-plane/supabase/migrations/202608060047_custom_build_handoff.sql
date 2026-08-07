begin;

do $$
begin
  if to_regprocedure('ss.hosted_runtime_contract_v46()') is null
    or to_regclass('ss.service_custom_build_final_obligations') is null
    or to_regclass(
      'ss.service_custom_build_final_zero_balance_clearances'
    ) is null
    or to_regclass(
      'ss.service_custom_build_final_payment_receipts'
    ) is null
    or to_regclass('ss.service_documents') is null
    or to_regclass('ss.service_document_payloads') is null
  then
    raise exception
      'Site Sourcery migration 046 must be applied before Custom build handoff'
      using errcode = '55000';
  end if;

  -- Every pre-v47 document guard rejected handoff. Refuse to guess how an
  -- out-of-band row was produced instead of silently blessing it.
  if exists (
    select 1
    from ss.service_documents document
    where document.document_kind = 'handoff'
  ) then
    raise exception
      'Custom build handoff cannot backfill unbound legacy handoff documents'
      using errcode = '55000';
  end if;
end
$$;

-- A final-payment receipt may arrive from the provider while an owner handoff
-- transaction is already evaluating the same immutable completion package.
-- Acquire the shared H1M job lock in the production receipt boundary itself,
-- before the v46 receipt guard reads any mutable payment context. The trigger
-- name sorts before the existing receipt guard, so direct service-role inserts
-- cannot bypass the same serialization used by final handoff.
create function ss.lock_service_custom_build_final_payment_receipt_h1m()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
begin
  if new.job_id is null then
    raise exception 'Custom build final receipt requires an immutable job ID'
      using errcode = '23502';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'ss-custom-build-h1m:' || new.job_id::text,
      0
    )
  );
  return new;
end
$$;

create trigger service_custom_build_final_payment_receipt_00_h1m_lock
before insert on ss.service_custom_build_final_payment_receipts
for each row execute function
  ss.lock_service_custom_build_final_payment_receipt_h1m();

-- A fixed UTC calculation makes the legal 30-day interval independent of the
-- writer's session timezone and of daylight-saving transitions.
create function ss.service_custom_build_workmanship_end(
  handed_off_at timestamptz
)
returns timestamptz
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select (
    (handed_off_at at time zone 'UTC') + interval '30 days'
  ) at time zone 'UTC'
$$;

-- Document timestamps are immutable JSON strings, not PostgreSQL display
-- values. Emit the same millisecond UTC form as Date#toISOString before the
-- payload is canonicalized and hashed; relational receipt columns retain
-- their full timestamptz precision.
create function ss.service_custom_build_handoff_iso_millisecond(
  selected_value timestamptz
)
returns text
language sql
immutable
strict
parallel safe
set search_path = pg_catalog
as $$
  select to_char(
    selected_value at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  )
$$;

-- Compact, recursively key-sorted JSON matches server/hosted/security.mjs
-- canonicalJson for this ASCII-keyed contract. Stored document bytes, their
-- advertised byte count, and their SHA-256 therefore describe the exact
-- customer payload returned by the hosted API.
create function ss.service_custom_build_handoff_canonical_json(
  selected_value jsonb
)
returns text
language plpgsql
immutable
strict
parallel safe
set search_path = pg_catalog, ss
as $$
declare
  selected_type text := jsonb_typeof(selected_value);
  result text;
begin
  if selected_type = 'object' then
    select '{' || coalesce(string_agg(
      pg_catalog.to_jsonb(entry.key)::text || ':' ||
        ss.service_custom_build_handoff_canonical_json(entry.value),
      ',' order by entry.key collate "C"
    ), '') || '}'
    into result
    from jsonb_each(selected_value) entry(key, value);
    return result;
  elsif selected_type = 'array' then
    select '[' || coalesce(string_agg(
      ss.service_custom_build_handoff_canonical_json(entry.value),
      ',' order by entry.ordinality
    ), '') || ']'
    into result
    from jsonb_array_elements(selected_value)
      with ordinality entry(value, ordinality);
    return result;
  end if;
  return selected_value::text;
end
$$;

create function ss.service_custom_build_handoff_text_is_valid(
  selected_value text,
  minimum_length integer,
  maximum_length integer
)
returns boolean
language sql
immutable
strict
parallel safe
set search_path = pg_catalog, ss
as $$
  select minimum_length >= 0
    and maximum_length >= minimum_length
    and char_length(selected_value) between minimum_length and maximum_length
    and selected_value = btrim(
      selected_value,
      chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) ||
      chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) ||
      chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) ||
      chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) ||
      chr(8239) || chr(8287) || chr(12288) || chr(65279)
    )
    and ss.service_text_excludes_credentials(selected_value)
    and selected_value !~*
      'bearer[[:space:]]+[a-z0-9._~-]+'
    and selected_value !~*
      '[?&](token|key|secret|password)='
    and selected_value !~*
      '(^|[^a-z0-9_])(cs|pi|ch|cus|evt|pm|seti|src|tok|sub|price|prod|re)_[a-z0-9][a-z0-9_-]{5,}($|[^a-z0-9_])'
$$;

-- Keep the immutable database payload readable by the hosted boundary. A
-- handoff manifest is exactly one `items` array; each item is exactly a safe,
-- bounded label and description. No caller-specific URLs, paths, types, or
-- extra metadata can be frozen into the canonical customer document.
create function ss.service_custom_build_handoff_manifest_is_valid(
  selected_manifest jsonb
)
returns boolean
language plpgsql
immutable
strict
parallel safe
set search_path = pg_catalog, ss
as $$
declare
  selected_item jsonb;
  selected_label text;
  selected_description text;
  selected_label_key text;
  selected_manifest_key_count bigint;
  selected_item_key_count bigint;
  retained_labels text[] := array[]::text[];
begin
  if jsonb_typeof(selected_manifest) <> 'object' then
    return false;
  end if;
  select pg_catalog.count(*)
  into selected_manifest_key_count
  from pg_catalog.jsonb_object_keys(selected_manifest);
  if selected_manifest_key_count <> 1
    or not (selected_manifest ? 'items')
    or jsonb_typeof(selected_manifest -> 'items') <> 'array'
    or jsonb_array_length(selected_manifest -> 'items') not between 1 and 40
  then
    return false;
  end if;

  for selected_item in
    select item.value
    from jsonb_array_elements(selected_manifest -> 'items') item(value)
  loop
    if jsonb_typeof(selected_item) <> 'object' then
      return false;
    end if;
    select pg_catalog.count(*)
    into selected_item_key_count
    from pg_catalog.jsonb_object_keys(selected_item);
    if selected_item_key_count <> 2
      or not (selected_item ?& array['label', 'description'])
      or jsonb_typeof(selected_item -> 'label') <> 'string'
      or jsonb_typeof(selected_item -> 'description') <> 'string'
    then
      return false;
    end if;

    selected_label := selected_item ->> 'label';
    selected_description := selected_item ->> 'description';
    if not ss.service_custom_build_handoff_text_is_valid(
        selected_label,
        2,
        120
      )
      or not ss.service_custom_build_handoff_text_is_valid(
        selected_description,
        2,
        500
      )
      or pg_catalog.translate(
        selected_label,
        'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
        'abcdefghijklmnopqrstuvwxyz'
      ) = any (retained_labels)
    then
      return false;
    end if;
    selected_label_key := pg_catalog.translate(
      selected_label,
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
      'abcdefghijklmnopqrstuvwxyz'
    );
    retained_labels := pg_catalog.array_append(
      retained_labels,
      selected_label_key
    );
  end loop;

  return pg_catalog.octet_length(
    pg_catalog.convert_to(
      ss.service_custom_build_handoff_canonical_json(selected_manifest),
      'UTF8'
    )
  ) <= 30 * 1024;
end
$$;

create function ss.service_custom_build_handoff_request_digest(
  command_id text,
  organization_id uuid,
  job_id uuid,
  expected_completion_package_digest ss.sha256_hex,
  expected_final_obligation_digest ss.sha256_hex,
  customer_summary text,
  delivery_manifest jsonb,
  operator_user_id uuid
)
returns ss.sha256_hex
language sql
immutable
parallel safe
set search_path = pg_catalog, ss
as $$
  select ss.service_json_digest(jsonb_build_object(
    'commandId', command_id,
    'customerSummary', customer_summary,
    'deliveryManifest', delivery_manifest,
    'expectedCompletionPackageDigest',
      expected_completion_package_digest,
    'expectedFinalObligationDigest', expected_final_obligation_digest,
    'jobId', job_id,
    'operatorUserId', operator_user_id,
    'organizationId', organization_id,
    'schema', 'sitesourcery.custom-build-handoff-command/v1'
  ))
$$;

create function ss.service_custom_build_handoff_digest(
  handoff_id uuid,
  organization_id uuid,
  project_id uuid,
  customer_user_id uuid,
  job_id uuid,
  completion_package_id uuid,
  completion_package_digest ss.sha256_hex,
  final_obligation_id uuid,
  final_obligation_digest ss.sha256_hex,
  final_due_minor bigint,
  currency text,
  financial_clearance_kind text,
  financial_clearance_id uuid,
  financial_clearance_digest ss.sha256_hex,
  financial_cleared_at timestamptz,
  final_invoice_id uuid,
  final_invoice_digest ss.sha256_hex,
  document_id uuid,
  document_content_digest ss.sha256_hex,
  document_byte_count bigint,
  command_id text,
  request_digest ss.sha256_hex,
  customer_summary text,
  delivery_manifest jsonb,
  handed_off_by_operator_user_id uuid,
  handed_off_at timestamptz,
  workmanship_starts_at timestamptz,
  workmanship_ends_at timestamptz
)
returns ss.sha256_hex
language sql
immutable
parallel safe
set search_path = pg_catalog, ss
as $$
  select ss.service_json_digest(jsonb_build_object(
    'commandId', command_id,
    'completionPackageDigest', completion_package_digest,
    'completionPackageId', completion_package_id,
    'currency', currency,
    'customerSummary', customer_summary,
    'customerUserId', customer_user_id,
    'deliveryManifest', delivery_manifest,
    'documentByteCount', document_byte_count,
    'documentContentDigest', document_content_digest,
    'documentId', document_id,
    'finalDueMinor', final_due_minor,
    'finalInvoiceDigest', final_invoice_digest,
    'finalInvoiceId', final_invoice_id,
    'finalObligationDigest', final_obligation_digest,
    'finalObligationId', final_obligation_id,
    'financialClearanceDigest', financial_clearance_digest,
    'financialClearanceId', financial_clearance_id,
    'financialClearanceKind', financial_clearance_kind,
    'financialClearedAt', financial_cleared_at,
    'handedOffAt', handed_off_at,
    'handedOffByOperatorUserId', handed_off_by_operator_user_id,
    'handoffId', handoff_id,
    'jobId', job_id,
    'organizationId', organization_id,
    'projectId', project_id,
    'requestDigest', request_digest,
    'schema', 'sitesourcery.custom-build-handoff-receipt/v1',
    'workmanshipEndsAt', workmanship_ends_at,
    'workmanshipIntervalBounds', '[)',
    'workmanshipStartsAt', workmanship_starts_at
  ))
$$;

create table ss.service_custom_build_handoff_receipts (
  id uuid primary key,
  organization_id uuid not null,
  project_id uuid not null,
  case_id uuid not null,
  customer_user_id uuid not null references auth.users(id),
  job_id uuid not null,
  completion_package_id uuid not null,
  final_obligation_id uuid not null,
  final_payment_receipt_id uuid,
  zero_balance_clearance_id uuid,
  final_invoice_id uuid,
  document_id uuid not null,
  command_id text not null check (
    ss.service_custom_build_handoff_text_is_valid(command_id, 8, 200)
  ),
  request_digest ss.sha256_hex not null,
  completion_package_digest ss.sha256_hex not null,
  final_obligation_digest ss.sha256_hex not null,
  final_invoice_digest ss.sha256_hex,
  final_due_minor bigint not null check (final_due_minor >= 0),
  currency text not null check (currency = 'USD'),
  financial_clearance_kind text not null check (
    financial_clearance_kind in (
      'provider_confirmed_final_payment',
      'zero_balance_clearance'
    )
  ),
  financial_clearance_digest ss.sha256_hex not null,
  financial_cleared_at timestamptz not null,
  customer_summary text not null check (
    ss.service_custom_build_handoff_text_is_valid(
      customer_summary,
      20,
      2000
    )
  ),
  delivery_manifest jsonb not null check (
    ss.service_custom_build_handoff_manifest_is_valid(delivery_manifest)
  ),
  document_content_digest ss.sha256_hex not null,
  document_byte_count bigint not null check (
    document_byte_count between 1 and 65536
  ),
  document_media_type text not null check (
    document_media_type = 'application/json'
  ),
  handed_off_by_operator_user_id uuid not null
    references ss.operator_profiles(user_id),
  handed_off_at timestamptz not null,
  workmanship_starts_at timestamptz not null,
  workmanship_ends_at timestamptz not null,
  workmanship_interval_bounds text not null check (
    workmanship_interval_bounds = '[)'
  ),
  created_at timestamptz not null default clock_timestamp(),
  handoff_digest ss.sha256_hex generated always as (
    ss.service_custom_build_handoff_digest(
      id,
      organization_id,
      project_id,
      customer_user_id,
      job_id,
      completion_package_id,
      completion_package_digest,
      final_obligation_id,
      final_obligation_digest,
      final_due_minor,
      currency,
      financial_clearance_kind,
      coalesce(final_payment_receipt_id, zero_balance_clearance_id),
      financial_clearance_digest,
      financial_cleared_at,
      final_invoice_id,
      final_invoice_digest,
      document_id,
      document_content_digest,
      document_byte_count,
      command_id,
      request_digest,
      customer_summary,
      delivery_manifest,
      handed_off_by_operator_user_id,
      handed_off_at,
      workmanship_starts_at,
      workmanship_ends_at
    )
  ) stored,
  foreign key (organization_id, project_id, case_id)
    references ss.service_cases(organization_id, project_id, id),
  foreign key (organization_id, job_id)
    references ss.service_custom_build_jobs(organization_id, id),
  foreign key (organization_id, completion_package_id)
    references ss.service_custom_build_completion_packages(
      organization_id, id
    ),
  foreign key (organization_id, final_obligation_id)
    references ss.service_custom_build_final_obligations(
      organization_id, id
    ),
  foreign key (organization_id, final_payment_receipt_id)
    references ss.service_custom_build_final_payment_receipts(
      organization_id, id
    ),
  foreign key (organization_id, zero_balance_clearance_id)
    references ss.service_custom_build_final_zero_balance_clearances(
      organization_id, id
    ),
  foreign key (organization_id, final_invoice_id)
    references ss.service_custom_build_final_invoices(
      organization_id, id
    ),
  foreign key (organization_id, customer_user_id)
    references ss.organization_memberships(organization_id, user_id),
  foreign key (
    organization_id,
    document_id,
    document_content_digest,
    document_byte_count,
    document_media_type
  ) references ss.service_documents(
    organization_id,
    id,
    content_digest,
    byte_count,
    media_type
  ) deferrable initially deferred,
  foreign key (organization_id, document_id)
    references ss.service_document_payloads(organization_id, document_id)
    deferrable initially deferred,
  unique (organization_id, id),
  unique (job_id),
  unique (completion_package_id),
  unique (final_obligation_id),
  unique (final_payment_receipt_id),
  unique (zero_balance_clearance_id),
  unique (document_id),
  unique (handed_off_by_operator_user_id, job_id, command_id),
  check (
    (
      financial_clearance_kind = 'provider_confirmed_final_payment'
      and final_due_minor > 0
      and final_payment_receipt_id is not null
      and zero_balance_clearance_id is null
      and final_invoice_id is not null
      and final_invoice_digest is not null
    )
    or (
      financial_clearance_kind = 'zero_balance_clearance'
      and final_due_minor = 0
      and final_payment_receipt_id is null
      and zero_balance_clearance_id is not null
      and final_invoice_id is null
      and final_invoice_digest is null
    )
  ),
  check (created_at = handed_off_at),
  check (workmanship_starts_at = handed_off_at),
  check (
    workmanship_ends_at =
      ss.service_custom_build_workmanship_end(handed_off_at)
  ),
  check (
    workmanship_ends_at - workmanship_starts_at = interval '720 hours'
  )
);

create trigger service_custom_build_handoff_receipts_immutable
before update or delete on ss.service_custom_build_handoff_receipts
for each row execute function ss.reject_update();

-- Preserve the assessment and job-evidence branches exactly; add only the
-- receipt-bound JSON handoff branch. The receipt is inserted first and its
-- document FKs are deferred, so no unbound handoff document can be created.
create or replace function ss.guard_service_assessment_document()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  recorded_at timestamptz := clock_timestamp();
begin
  if ss.current_service_actor_kind() <> 'operator'
    or ss.current_service_actor_org_id() is distinct from new.organization_id
    or ss.current_service_actor_user_id() is distinct from new.created_by_user_id
    or new.created_by_kind <> 'operator'
    or new.document_kind not in (
      'assessment_evidence', 'assessment_report', 'job_evidence', 'handoff'
    )
    or new.visibility <> 'customer'
    or new.retention_class <> 'project'
    or new.object_key not like
      'service-documents/' || new.organization_id::text || '/' ||
      new.project_id::text || '/%'
    or not ss.service_operator_has_capability(
      ss.current_service_actor_user_id(),
      'service_document_manage',
      recorded_at
    )
    or (
      new.document_kind = 'job_evidence'
      and (
        new.media_type not in ('image/jpeg', 'image/png', 'image/webp')
        or not ss.service_operator_has_capability(
          ss.current_service_actor_user_id(),
          'service_job_manage',
          recorded_at
        )
        or not exists (
          select 1
          from ss.service_custom_build_jobs job
          where job.organization_id = new.organization_id
            and job.project_id = new.project_id
            and job.case_id = new.case_id
            and job.state = 'open'
            and new.object_key like
              'service-documents/' || new.organization_id::text || '/' ||
              new.project_id::text || '/custom-build-jobs/' ||
              job.id::text || '/evidence/%'
        )
      )
    )
    or (
      new.document_kind = 'handoff'
      and (
        new.media_type <> 'application/json'
        or new.byte_count not between 1 and 65536
        or not ss.service_operator_has_capability(
          ss.current_service_actor_user_id(),
          'service_job_manage',
          recorded_at
        )
        or not exists (
          select 1
          from ss.service_custom_build_handoff_receipts receipt
          where receipt.organization_id = new.organization_id
            and receipt.project_id = new.project_id
            and receipt.case_id = new.case_id
            and receipt.document_id = new.id
            and receipt.document_content_digest = new.content_digest
            and receipt.document_byte_count = new.byte_count
            and receipt.document_media_type = new.media_type
            and receipt.handed_off_by_operator_user_id =
              new.created_by_user_id
            and new.object_key =
              'service-documents/' || new.organization_id::text || '/' ||
              new.project_id::text || '/custom-build-jobs/' ||
              receipt.job_id::text || '/handoff/' || new.id::text || '.json'
        )
      )
    )
  then
    raise exception 'service document mutation lacks bounded authority'
      using errcode = '42501';
  end if;
  return new;
end
$$;

-- Keep the v44 job-evidence checks byte-for-contract. The new handoff branch
-- additionally proves decodable canonical JSON and exact receipt identity.
create or replace function ss.guard_service_custom_build_completion_payload()
returns trigger
language plpgsql
set search_path = pg_catalog, extensions, ss
as $$
declare
  selected_document record;
  recorded_at timestamptz := clock_timestamp();
  calculated_digest ss.sha256_hex;
  decoded_payload jsonb;
begin
  select document.* into selected_document
  from ss.service_documents document
  where document.organization_id = new.organization_id
    and document.id = new.document_id;

  if not found then
    raise exception 'Custom build evidence payload lacks document identity'
      using errcode = '23514';
  end if;

  if selected_document.document_kind = 'job_evidence'
    and (
      ss.current_service_actor_kind() <> 'operator'
      or ss.current_service_actor_org_id() is distinct from
        selected_document.organization_id
      or ss.current_service_actor_user_id() is distinct from
        selected_document.created_by_user_id
      or not ss.service_operator_has_capability(
        ss.current_service_actor_user_id(),
        'service_document_manage',
        recorded_at
      )
      or not ss.service_operator_has_capability(
        ss.current_service_actor_user_id(),
        'service_job_manage',
        recorded_at
      )
    )
  then
    raise exception 'Custom build evidence payload lacks bounded authority'
      using errcode = '42501';
  end if;

  if selected_document.document_kind = 'handoff' then
    begin
      decoded_payload := convert_from(new.payload, 'UTF8')::jsonb;
    exception when others then
      raise exception 'Custom build handoff payload is not decodable JSON'
        using errcode = '23514';
    end;
    calculated_digest := encode(
      extensions.digest(new.payload, 'sha256'),
      'hex'
    )::ss.sha256_hex;

    if ss.current_service_actor_kind() <> 'operator'
      or ss.current_service_actor_org_id() is distinct from
        selected_document.organization_id
      or ss.current_service_actor_user_id() is distinct from
        selected_document.created_by_user_id
      or new.media_type <> 'application/json'
      or octet_length(new.payload) not between 1 and 65536
      or convert_to(
        ss.service_custom_build_handoff_canonical_json(decoded_payload),
        'UTF8'
      ) <> new.payload
      or calculated_digest <> selected_document.content_digest
      or octet_length(new.payload)::bigint <> selected_document.byte_count
      or not ss.service_operator_has_capability(
        ss.current_service_actor_user_id(),
        'service_document_manage',
        recorded_at
      )
      or not ss.service_operator_has_capability(
        ss.current_service_actor_user_id(),
        'service_job_manage',
        recorded_at
      )
      or not exists (
        select 1
        from ss.service_custom_build_handoff_receipts receipt
        where receipt.organization_id = new.organization_id
          and receipt.document_id = new.document_id
          and receipt.document_content_digest = calculated_digest
          and receipt.document_byte_count = octet_length(new.payload)::bigint
          and receipt.document_media_type = new.media_type
          and receipt.handed_off_by_operator_user_id =
            ss.current_service_actor_user_id()
      )
    then
      raise exception 'Custom build handoff payload is not exact'
        using errcode = '23514';
    end if;
  end if;
  return new;
end
$$;

create function ss.create_service_custom_build_handoff(
  target_job_id uuid,
  selected_command_id text,
  selected_organization_id uuid,
  expected_completion_package_digest ss.sha256_hex,
  expected_final_obligation_digest ss.sha256_hex,
  selected_customer_summary text,
  selected_delivery_manifest jsonb
)
returns table (
  receipt_id uuid,
  document_id uuid,
  handoff_digest ss.sha256_hex,
  handed_off_at timestamptz,
  workmanship_starts_at timestamptz,
  workmanship_ends_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, extensions, ss
as $$
declare
  discovered_job_id uuid;
  operator_user_id uuid := ss.current_service_actor_user_id();
  recorded_at timestamptz;
  calculated_request_digest ss.sha256_hex;
  retained_receipt record;
  source record;
  selected_handoff_id uuid := extensions.gen_random_uuid();
  selected_document_id uuid := extensions.gen_random_uuid();
  selected_object_key text;
  selected_financial_kind text;
  selected_financial_digest ss.sha256_hex;
  selected_financial_cleared_at timestamptz;
  selected_invoice_id uuid;
  selected_invoice_digest ss.sha256_hex;
  selected_workmanship_end timestamptz;
  payload_json jsonb;
  payload_bytes bytea;
  payload_digest ss.sha256_hex;
begin
  if target_job_id is null
    or selected_organization_id is null
    or expected_completion_package_digest is null
    or expected_final_obligation_digest is null
    or selected_command_id is null
    or not coalesce(
      ss.service_custom_build_handoff_text_is_valid(
        selected_command_id,
        8,
        200
      ),
      false
    )
    or selected_customer_summary is null
    or not coalesce(
      ss.service_custom_build_handoff_text_is_valid(
        selected_customer_summary,
        20,
        2000
      ),
      false
    )
    or selected_delivery_manifest is null
    or not coalesce(
      ss.service_custom_build_handoff_manifest_is_valid(
        selected_delivery_manifest
      ),
      false
    )
    or ss.current_service_actor_kind() <> 'operator'
    or operator_user_id is null
    or ss.current_service_actor_org_id() is distinct from
      selected_organization_id
  then
    raise exception 'Custom build handoff input lacks bounded owner authority'
      using errcode = '42501';
  end if;

  -- Immutable job discovery is the first table read. No mutable row or
  -- idempotency authority is touched before the shared H1M lock.
  select job.id into discovered_job_id
  from ss.service_custom_build_jobs job
  where job.id = target_job_id
    and job.organization_id = selected_organization_id;
  if not found then
    raise exception 'Custom build handoff lacks an exact completed job'
      using errcode = '23514';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'ss-custom-build-h1m:' || discovered_job_id::text,
      0
    )
  );
  recorded_at := clock_timestamp();

  if not ss.service_operator_has_capability(
      operator_user_id,
      'service_job_manage',
      recorded_at
    )
    or not ss.service_operator_has_capability(
      operator_user_id,
      'service_document_manage',
      recorded_at
    )
  then
    raise exception 'Custom build handoff lacks operator capabilities'
      using errcode = '42501';
  end if;

  calculated_request_digest :=
    ss.service_custom_build_handoff_request_digest(
      selected_command_id,
      selected_organization_id,
      discovered_job_id,
      expected_completion_package_digest,
      expected_final_obligation_digest,
      selected_customer_summary,
      selected_delivery_manifest,
      operator_user_id
    );

  select receipt.* into retained_receipt
  from ss.service_custom_build_handoff_receipts receipt
  where receipt.organization_id = selected_organization_id
    and receipt.handed_off_by_operator_user_id = operator_user_id
    and receipt.job_id = discovered_job_id
    and receipt.command_id = selected_command_id;
  if found then
    if retained_receipt.request_digest is distinct from
      calculated_request_digest
    then
      raise exception 'Custom build handoff command digest conflicts'
        using errcode = '23505';
    end if;
    return query select
      retained_receipt.id,
      retained_receipt.document_id,
      retained_receipt.handoff_digest,
      retained_receipt.handed_off_at,
      retained_receipt.workmanship_starts_at,
      retained_receipt.workmanship_ends_at;
    return;
  end if;

  if exists (
    select 1
    from ss.service_custom_build_handoff_receipts receipt
    where receipt.organization_id = selected_organization_id
      and receipt.job_id = discovered_job_id
  ) then
    raise exception 'Custom build job already has an immutable handoff'
      using errcode = '23505';
  end if;

  select
    job.organization_id,
    job.project_id,
    job.case_id,
    job.customer_user_id,
    job.state as job_state,
    package.id as completion_package_id,
    package.package_digest as completion_package_digest,
    package.state as completion_state,
    package.prepared_at as completed_at,
    obligation.id as final_obligation_id,
    obligation.obligation_digest as final_obligation_digest,
    obligation.completion_package_id as obligation_completion_package_id,
    obligation.completion_package_digest as obligation_completion_digest,
    obligation.final_due_minor,
    obligation.credit_minor,
    obligation.currency,
    obligation.workmanship_correction_days,
    payment.id as final_payment_receipt_id,
    payment.invoice_id as payment_invoice_id,
    payment.obligation_digest as payment_obligation_digest,
    payment.completion_package_digest as payment_completion_digest,
    payment.invoice_digest as payment_invoice_digest,
    payment.provider_facts_digest,
    payment.payment_status,
    payment.charge_captured,
    payment.amount_refunded_minor,
    payment.disputed,
    payment.subtotal_minor as payment_subtotal_minor,
    payment.tax_minor as payment_tax_minor,
    payment.total_minor as payment_total_minor,
    payment.currency as payment_currency,
    payment.provider_paid_at,
    payment.settled_at,
    clearance.id as zero_balance_clearance_id,
    clearance.obligation_digest as clearance_obligation_digest,
    clearance.completion_package_digest as clearance_completion_digest,
    clearance.clearance_digest,
    clearance.reason as clearance_reason,
    clearance.cleared_at,
    invoice.id as final_invoice_id,
    invoice.invoice_number,
    invoice.invoice_digest,
    invoice.subtotal_minor as invoice_subtotal_minor,
    invoice.credit_minor as invoice_credit_minor,
    invoice.currency as invoice_currency
  into source
  from ss.service_custom_build_jobs job
  join ss.service_custom_build_completion_packages package
    on package.organization_id = job.organization_id
   and package.job_id = job.id
  join ss.service_custom_build_final_obligations obligation
    on obligation.organization_id = job.organization_id
   and obligation.job_id = job.id
  left join ss.service_custom_build_final_payment_receipts payment
    on payment.organization_id = job.organization_id
   and payment.job_id = job.id
  left join ss.service_custom_build_final_zero_balance_clearances clearance
    on clearance.organization_id = job.organization_id
   and clearance.job_id = job.id
  left join ss.service_custom_build_final_invoices invoice
    on invoice.organization_id = job.organization_id
   and invoice.job_id = job.id
  where job.organization_id = selected_organization_id
    and job.id = discovered_job_id;

  if not found
    or source.job_state <> 'open'
    or source.completion_package_digest is distinct from
      expected_completion_package_digest
    or source.final_obligation_digest is distinct from
      expected_final_obligation_digest
    or source.obligation_completion_package_id is distinct from
      source.completion_package_id
    or source.obligation_completion_digest is distinct from
      source.completion_package_digest
    or source.credit_minor <> 0
    or source.currency <> 'USD'
    or source.workmanship_correction_days <> 30
    or exists (
      select 1
      from ss.service_custom_build_final_checkout_attempts attempt
      where attempt.organization_id = source.organization_id
        and attempt.job_id = discovered_job_id
        and attempt.state in (
          'provider_pending', 'ready', 'persistence_unknown'
        )
    )
    or exists (
      select 1
      from ss.service_custom_build_final_stripe_events event
      where event.organization_id = source.organization_id
        and event.job_id = discovered_job_id
        and event.state in ('pending', 'reconciliation_required')
    )
    or exists (
      select 1
      from ss.service_custom_build_final_reconciliation_commands command
      where command.organization_id = source.organization_id
        and command.job_id = discovered_job_id
        and command.state = 'running'
    )
    or (
      source.final_due_minor > 0
      and (
        source.completion_state <> 'ready_for_final_payment'
        or source.final_payment_receipt_id is null
        or source.zero_balance_clearance_id is not null
        or source.final_invoice_id is null
        or source.payment_invoice_id is distinct from source.final_invoice_id
        or source.payment_obligation_digest is distinct from
          source.final_obligation_digest
        or source.payment_completion_digest is distinct from
          source.completion_package_digest
        or source.payment_invoice_digest is distinct from
          source.invoice_digest
        or source.payment_status <> 'paid'
        or not source.charge_captured
        or source.amount_refunded_minor <> 0
        or source.disputed
        or source.payment_subtotal_minor <> source.final_due_minor
        or source.invoice_subtotal_minor <> source.final_due_minor
        or source.invoice_credit_minor <> 0
        or source.payment_currency <> source.currency
        or source.invoice_currency <> source.currency
        or not exists (
          select 1
          from ss.service_custom_build_final_checkout_attempts attempt
          where attempt.organization_id = source.organization_id
            and attempt.job_id = discovered_job_id
            and attempt.id = (
              select receipt.checkout_attempt_id
              from ss.service_custom_build_final_payment_receipts receipt
              where receipt.id = source.final_payment_receipt_id
            )
            and attempt.state = 'paid'
        )
      )
    )
    or (
      source.final_due_minor = 0
      and (
        source.completion_state <> 'ready_for_delivery'
        or source.final_payment_receipt_id is not null
        or source.zero_balance_clearance_id is null
        or source.final_invoice_id is not null
        or source.clearance_obligation_digest is distinct from
          source.final_obligation_digest
        or source.clearance_completion_digest is distinct from
          source.completion_package_digest
        or source.clearance_reason <>
          'accepted_quote_has_no_final_balance'
        or exists (
          select 1
          from ss.service_custom_build_final_checkout_attempts attempt
          where attempt.organization_id = source.organization_id
            and attempt.job_id = discovered_job_id
        )
        or exists (
          select 1
          from ss.service_custom_build_final_stripe_events event
          where event.organization_id = source.organization_id
            and event.job_id = discovered_job_id
        )
      )
    )
  then
    raise exception
      'Custom build handoff lacks exact completion and financial clearance'
      using errcode = '23514';
  end if;

  selected_financial_kind := case
    when source.final_due_minor > 0
      then 'provider_confirmed_final_payment'
    else 'zero_balance_clearance'
  end;
  selected_financial_digest := case
    when source.final_due_minor > 0
      then source.provider_facts_digest
    else source.clearance_digest
  end;
  selected_financial_cleared_at := case
    when source.final_due_minor > 0
      then source.settled_at
    else source.cleared_at
  end;
  selected_invoice_id := case
    when source.final_due_minor > 0 then source.final_invoice_id
    else null
  end;
  selected_invoice_digest := case
    when source.final_due_minor > 0 then source.invoice_digest
    else null
  end;
  selected_workmanship_end :=
    ss.service_custom_build_workmanship_end(recorded_at);
  selected_object_key :=
    'service-documents/' || source.organization_id::text || '/' ||
    source.project_id::text || '/custom-build-jobs/' ||
    discovered_job_id::text || '/handoff/' ||
    selected_document_id::text || '.json';

  payload_json := jsonb_build_object(
    'completion', jsonb_build_object(
      'packageDigest', source.completion_package_digest,
      'packageId', source.completion_package_id
    ),
    'customerSummary', selected_customer_summary,
    'deliveryManifest', selected_delivery_manifest -> 'items',
    'finalObligation', jsonb_build_object(
      'obligationDigest', source.final_obligation_digest,
      'obligationId', source.final_obligation_id
    ),
    'financialClearance', case
      when source.final_due_minor > 0 then jsonb_build_object(
        'clearedAt', ss.service_custom_build_handoff_iso_millisecond(
          source.settled_at
        ),
        'kind', 'provider_confirmed_final_payment',
        'referenceId', source.final_payment_receipt_id
      )
      else jsonb_build_object(
        'clearedAt', ss.service_custom_build_handoff_iso_millisecond(
          source.cleared_at
        ),
        'kind', 'zero_balance_clearance',
        'referenceId', source.zero_balance_clearance_id
      )
    end,
    'handoff', jsonb_build_object(
      'documentId', selected_document_id,
      'handedOffAt', ss.service_custom_build_handoff_iso_millisecond(
        recorded_at
      ),
      'receiptId', selected_handoff_id,
      'workmanship', jsonb_build_object(
        'coverage', '[start,end)',
        'endsAt', ss.service_custom_build_handoff_iso_millisecond(
          selected_workmanship_end
        ),
        'startsAt', ss.service_custom_build_handoff_iso_millisecond(
          recorded_at
        ),
        'termDays', 30
      )
    ),
    'jobId', discovered_job_id,
    'projectId', source.project_id,
    'schema', 'sitesourcery.custom-build-handoff-document/v1',
    'state', 'handed_off'
  );
  payload_bytes := convert_to(
    ss.service_custom_build_handoff_canonical_json(payload_json),
    'UTF8'
  );
  if octet_length(payload_bytes) not between 1 and 65536
    or not ss.service_text_excludes_credentials(payload_json::text)
  then
    raise exception 'Custom build handoff payload exceeds its safe boundary'
      using errcode = '22001';
  end if;
  payload_digest := encode(
    extensions.digest(payload_bytes, 'sha256'),
    'hex'
  )::ss.sha256_hex;

  insert into ss.service_custom_build_handoff_receipts (
    id,
    organization_id,
    project_id,
    case_id,
    customer_user_id,
    job_id,
    completion_package_id,
    final_obligation_id,
    final_payment_receipt_id,
    zero_balance_clearance_id,
    final_invoice_id,
    document_id,
    command_id,
    request_digest,
    completion_package_digest,
    final_obligation_digest,
    final_invoice_digest,
    final_due_minor,
    currency,
    financial_clearance_kind,
    financial_clearance_digest,
    financial_cleared_at,
    customer_summary,
    delivery_manifest,
    document_content_digest,
    document_byte_count,
    document_media_type,
    handed_off_by_operator_user_id,
    handed_off_at,
    workmanship_starts_at,
    workmanship_ends_at,
    workmanship_interval_bounds,
    created_at
  ) values (
    selected_handoff_id,
    source.organization_id,
    source.project_id,
    source.case_id,
    source.customer_user_id,
    discovered_job_id,
    source.completion_package_id,
    source.final_obligation_id,
    source.final_payment_receipt_id,
    source.zero_balance_clearance_id,
    selected_invoice_id,
    selected_document_id,
    selected_command_id,
    calculated_request_digest,
    source.completion_package_digest,
    source.final_obligation_digest,
    selected_invoice_digest,
    source.final_due_minor,
    source.currency,
    selected_financial_kind,
    selected_financial_digest,
    selected_financial_cleared_at,
    selected_customer_summary,
    selected_delivery_manifest,
    payload_digest,
    octet_length(payload_bytes)::bigint,
    'application/json',
    operator_user_id,
    recorded_at,
    recorded_at,
    selected_workmanship_end,
    '[)',
    recorded_at
  );

  insert into ss.service_documents (
    id,
    organization_id,
    project_id,
    case_id,
    document_kind,
    object_key,
    content_digest,
    media_type,
    byte_count,
    visibility,
    retention_class,
    created_by_kind,
    created_by_user_id,
    created_at
  ) values (
    selected_document_id,
    source.organization_id,
    source.project_id,
    source.case_id,
    'handoff',
    selected_object_key,
    payload_digest,
    'application/json',
    octet_length(payload_bytes)::bigint,
    'customer',
    'project',
    'operator',
    operator_user_id,
    recorded_at
  );

  insert into ss.service_document_payloads (
    organization_id,
    document_id,
    media_type,
    payload,
    created_at
  ) values (
    source.organization_id,
    selected_document_id,
    'application/json',
    payload_bytes,
    recorded_at
  );

  return query
  select
    receipt.id,
    receipt.document_id,
    receipt.handoff_digest,
    receipt.handed_off_at,
    receipt.workmanship_starts_at,
    receipt.workmanship_ends_at
  from ss.service_custom_build_handoff_receipts receipt
  where receipt.id = selected_handoff_id;
end
$$;

-- Completion already closes work. This second lock-aware fence makes the
-- handoff boundary independently durable and also closes final Checkout.
create function ss.guard_service_custom_build_after_handoff()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  discovered_job_id uuid;
  selected_organization_id uuid := new.organization_id;
begin
  if tg_table_name = 'service_access_requests' then
    if new.job_id is null
      or new.reason_code <> 'custom_build_execution'
    then
      return new;
    end if;
  end if;
  if new.job_id is null or selected_organization_id is null then
    return new;
  end if;

  select job.id into discovered_job_id
  from ss.service_custom_build_jobs job
  where job.organization_id = selected_organization_id
    and job.id = new.job_id;
  if not found then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'ss-custom-build-h1m:' || discovered_job_id::text,
      0
    )
  );
  if exists (
    select 1
    from ss.service_custom_build_handoff_receipts receipt
    where receipt.organization_id = selected_organization_id
      and receipt.job_id = discovered_job_id
  ) then
    raise exception 'Custom build mutation is closed by immutable handoff'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger service_custom_build_progress_updates_00_handoff_guard
before insert on ss.service_custom_build_progress_updates
for each row execute function ss.guard_service_custom_build_after_handoff();

create trigger service_custom_build_work_requests_00_handoff_guard
before insert or update on ss.service_custom_build_work_requests
for each row execute function ss.guard_service_custom_build_after_handoff();

create trigger service_access_requests_00_custom_build_handoff_guard
before insert on ss.service_access_requests
for each row execute function ss.guard_service_custom_build_after_handoff();

create trigger service_custom_build_final_checkout_00_handoff_guard
before insert or update on ss.service_custom_build_final_checkout_attempts
for each row execute function ss.guard_service_custom_build_after_handoff();

alter table ss.service_custom_build_handoff_receipts enable row level security;
alter table ss.service_custom_build_handoff_receipts force row level security;
revoke all on table ss.service_custom_build_handoff_receipts
from public, anon, authenticated, service_role;
grant select on table ss.service_custom_build_handoff_receipts
to service_role;

do $$
declare
  function_signature text;
begin
  for function_signature in
    select procedure.oid::regprocedure::text
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'ss'
      and procedure.proname in (
        'service_custom_build_workmanship_end',
        'lock_service_custom_build_final_payment_receipt_h1m',
        'service_custom_build_handoff_request_digest',
        'service_custom_build_handoff_digest',
        'guard_service_assessment_document',
        'guard_service_custom_build_completion_payload',
        'create_service_custom_build_handoff',
        'guard_service_custom_build_after_handoff'
      )
  loop
    execute format(
      'revoke all on function %s from public, anon, authenticated, service_role',
      function_signature
    );
    execute format(
      'grant execute on function %s to service_role',
      function_signature
    );
  end loop;
end
$$;

do $$
begin
  if has_table_privilege(
      'service_role',
      'ss.service_custom_build_handoff_receipts',
      'INSERT'
    )
    or has_table_privilege(
      'service_role',
      'ss.service_custom_build_handoff_receipts',
      'UPDATE'
    )
    or has_table_privilege(
      'service_role',
      'ss.service_custom_build_handoff_receipts',
      'DELETE'
    )
    or has_table_privilege(
      'service_role',
      'ss.service_custom_build_handoff_receipts',
      'TRUNCATE'
    )
    or has_table_privilege(
      'authenticated',
      'ss.service_custom_build_handoff_receipts',
      'SELECT'
    )
    or has_table_privilege(
      'anon',
      'ss.service_custom_build_handoff_receipts',
      'SELECT'
    )
  then
    raise exception 'Custom build handoff privilege boundary is unsafe'
      using errcode = '55000';
  end if;
end
$$;

create function ss.hosted_runtime_contract_v47()
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select 'canonical-ss-v47-custom-build-handoff'::text
$$;

revoke all on function ss.hosted_runtime_contract_v47()
from public, anon, authenticated;
grant execute on function ss.hosted_runtime_contract_v47()
to service_role;

commit;
