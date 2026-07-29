begin;

create table ss.projects (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references ss.organizations(id),
  created_by_user_id uuid not null references auth.users(id),
  billing_policy_id uuid not null references ss.billing_policies(id),
  name text,
  lifecycle text not null default 'active'
    check (lifecycle in ('active', 'cancelled', 'deleting', 'deleted')),
  revision bigint not null default 1 check (revision > 0),
  cancelled_at timestamptz,
  retention_ends_at timestamptz,
  deletion_started_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (organization_id, id),
  constraint projects_name_by_lifecycle check (
    (
      lifecycle in ('active', 'cancelled')
      and name is not null
      and char_length(name) between 2 and 120
    )
    or (
      lifecycle in ('deleting', 'deleted')
      and name is null
    )
  ),
  check (
    retention_ends_at is null
    or cancelled_at is null
    or retention_ends_at >= cancelled_at
  )
);

create index projects_org_updated
  on ss.projects(organization_id, updated_at desc);

create trigger projects_updated_at
before update on ss.projects
for each row execute function ss.set_updated_at();

alter table ss.audit_events
  add constraint audit_events_project_fk
  foreign key (organization_id, project_id)
  references ss.projects(organization_id, id);

alter table ss.lifecycle_jobs
  add constraint lifecycle_jobs_project_fk
  foreign key (organization_id, project_id)
  references ss.projects(organization_id, id);

create table ss.term_acceptances (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  user_id uuid not null references auth.users(id),
  document_id uuid not null references ss.legal_documents(id),
  accepted_at timestamptz not null,
  request_id uuid not null,
  ip_address inet,
  user_agent_digest ss.sha256_hex,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  unique (project_id, document_id, user_id, request_id),
  unique (organization_id, id)
);

create table ss.project_required_terms (
  organization_id uuid not null,
  project_id uuid not null,
  kind text not null check (kind in ('product', 'privacy', 'website')),
  acceptance_id uuid not null,
  primary key (project_id, kind),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, acceptance_id)
    references ss.term_acceptances(organization_id, id),
  unique (acceptance_id)
);

create function ss.validate_project_term()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  acceptance_record record;
begin
  select
    acceptance.organization_id,
    acceptance.project_id,
    document.kind
  into acceptance_record
  from ss.term_acceptances acceptance
  join ss.legal_documents document on document.id = acceptance.document_id
  where acceptance.id = new.acceptance_id;

  if not found
    or acceptance_record.organization_id <> new.organization_id
    or acceptance_record.project_id <> new.project_id
    or acceptance_record.kind <> new.kind
  then
    raise exception 'project required term does not match its acceptance'
      using errcode = '23514';
  end if;

  return new;
end
$$;

create constraint trigger project_required_terms_match
after insert or update on ss.project_required_terms
deferrable initially deferred
for each row execute function ss.validate_project_term();

create table ss.project_safety_projection (
  organization_id uuid not null,
  project_id uuid primary key,
  state text not null default 'clear'
    check (state in ('clear', 'held', 'appeal_pending', 'closed')),
  previous_serving_state text
    check (previous_serving_state is null or previous_serving_state in ('unpublished', 'live')),
  held_at timestamptz,
  restored_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id) on delete cascade
);

create table ss.safety_events (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  kind text not null
    check (kind in ('hold', 'appeal', 'restore', 'closed_by_deletion')),
  actor_kind text not null check (actor_kind in ('user', 'operator', 'system')),
  actor_id text,
  narrative text,
  previous_serving_state text,
  resulting_serving_state text,
  occurred_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id) on delete cascade
);

create trigger safety_events_no_update
before update on ss.safety_events
for each row execute function ss.reject_update();

create table ss.project_access_credentials (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  password_phc text not null,
  credential_fingerprint ss.sha256_hex not null,
  created_at timestamptz not null default clock_timestamp(),
  revoked_at timestamptz,
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id) on delete cascade,
  unique (organization_id, id)
);

create unique index project_access_credentials_one_current
  on ss.project_access_credentials(project_id)
  where revoked_at is null;

create table ss.project_access_projection (
  organization_id uuid not null,
  project_id uuid primary key,
  visibility text not null default 'public'
    check (visibility in ('public', 'private', 'closed')),
  current_credential_id uuid,
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id) on delete cascade,
  foreign key (organization_id, current_credential_id)
    references ss.project_access_credentials(organization_id, id),
  check (
    (visibility = 'private' and current_credential_id is not null)
    or (visibility in ('public', 'closed') and current_credential_id is null)
  )
);

create table ss.project_addresses (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  kind text not null
    check (kind in ('licensed', 'customer_purchase', 'customer_byod')),
  ownership text not null check (ownership in ('licensed', 'customer')),
  label text check (
    label is null
    or (
      char_length(label) between 1 and 63
      and label ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'
    )
  ),
  retained_domain ss.canonical_hostname,
  serving_hostname ss.canonical_hostname,
  state text not null
    check (state in ('pending', 'pending_review', 'configured', 'detached', 'released')),
  allocated_at timestamptz not null default clock_timestamp(),
  configured_at timestamptz,
  detached_at timestamptz,
  released_at timestamptz,
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id) on delete cascade,
  unique (organization_id, id),
  check (
    (kind = 'licensed' and ownership = 'licensed')
    or (kind <> 'licensed' and ownership = 'customer')
  ),
  check (
    kind <> 'licensed'
    or retained_domain is null
  ),
  check (
    kind = 'licensed'
    or retained_domain is not null
  ),
  check (
    state in ('detached', 'released')
    or serving_hostname is not null
  )
);

create unique index project_addresses_active_hostname
  on ss.project_addresses(lower(serving_hostname::text))
  where serving_hostname is not null
    and state not in ('detached', 'released');

create index project_addresses_project
  on ss.project_addresses(organization_id, project_id, allocated_at desc);

create table ss.project_address_projection (
  organization_id uuid not null,
  project_id uuid primary key,
  current_address_id uuid,
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id) on delete cascade,
  foreign key (organization_id, current_address_id)
    references ss.project_addresses(organization_id, id)
);

create table ss.domain_verification_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  address_id uuid not null,
  method text not null check (method in ('registrar_receipt', 'dns_challenge')),
  proof_reference_ciphertext bytea not null,
  proof_reference_digest ss.sha256_hex not null,
  state text not null
    check (state in ('pending_review', 'approved', 'rejected', 'superseded')),
  requested_by_user_id uuid not null references auth.users(id),
  requested_at timestamptz not null default clock_timestamp(),
  reviewed_at timestamptz,
  superseded_at timestamptz,
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id) on delete cascade,
  foreign key (organization_id, address_id)
    references ss.project_addresses(organization_id, id) on delete cascade,
  unique (organization_id, id)
);

create unique index domain_verification_one_pending
  on ss.domain_verification_requests(address_id)
  where state = 'pending_review';

create table ss.domain_verification_attempts (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  request_id uuid not null,
  verifier_kind text not null
    check (verifier_kind in ('dns_worker', 'registrar_adapter', 'operator')),
  outcome text not null check (outcome in ('passed', 'failed', 'inconclusive')),
  observed_digest ss.sha256_hex,
  provider_receipt_id uuid,
  checked_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id) on delete cascade,
  foreign key (organization_id, request_id)
    references ss.domain_verification_requests(organization_id, id) on delete cascade
);

create trigger domain_verification_attempts_no_update
before update on ss.domain_verification_attempts
for each row execute function ss.reject_update();

create table ss.project_drafts (
  organization_id uuid not null,
  project_id uuid primary key,
  raw_facts jsonb not null check (jsonb_typeof(raw_facts) = 'object'),
  revision bigint not null default 1 check (revision > 0),
  updated_by_user_id uuid not null references auth.users(id),
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id) on delete cascade
);

create table ss.fact_sets (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  schema_version text not null
    check (schema_version = 'abracadabra.spark/v1'),
  theme text not null check (theme in ('clear', 'warm', 'arcane')),
  business_name text not null check (char_length(business_name) between 1 and 80),
  summary text not null check (char_length(summary) between 1 and 180),
  about text check (about is null or char_length(about) <= 800),
  offerings_count smallint not null check (offerings_count between 0 and 6),
  location text check (location is null or char_length(location) <= 160),
  hours text check (hours is null or char_length(hours) <= 240),
  phone_display text check (phone_display is null or char_length(phone_display) <= 32),
  phone_href text,
  email_display text check (email_display is null or char_length(email_display) <= 254),
  email_href text,
  website_display text check (website_display is null or char_length(website_display) <= 2048),
  website_href text,
  primary_action text not null
    check (primary_action in ('none', 'phone', 'email', 'website')),
  content_digest ss.sha256_hex not null,
  normalized_digest ss.sha256_hex not null,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id) on delete cascade,
  unique (organization_id, project_id, normalized_digest),
  unique (organization_id, id),
  check (
    about is not null
    or offerings_count > 0
    or location is not null
    or hours is not null
  ),
  check (phone_href is not null or email_href is not null or website_href is not null),
  check (primary_action <> 'phone' or phone_href is not null),
  check (primary_action <> 'email' or email_href is not null),
  check (primary_action <> 'website' or website_href is not null),
  check ((phone_display is null) = (phone_href is null)),
  check ((email_display is null) = (email_href is null)),
  check ((website_display is null) = (website_href is null))
);

create table ss.fact_offerings (
  organization_id uuid not null,
  fact_set_id uuid not null,
  position smallint not null check (position between 1 and 6),
  offering text not null check (char_length(offering) between 1 and 100),
  primary key (fact_set_id, position),
  foreign key (organization_id, fact_set_id)
    references ss.fact_sets(organization_id, id) on delete cascade
);

create function ss.validate_fact_offering_count()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  target_fact_set_id uuid;
  expected_count integer;
  actual_count integer;
begin
  target_fact_set_id := coalesce(
    nullif(to_jsonb(new) ->> 'fact_set_id', '')::uuid,
    nullif(to_jsonb(old) ->> 'fact_set_id', '')::uuid,
    nullif(to_jsonb(new) ->> 'id', '')::uuid,
    nullif(to_jsonb(old) ->> 'id', '')::uuid
  );

  select offerings_count
  into expected_count
  from ss.fact_sets
  where id = target_fact_set_id;

  if not found then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  select count(*)
  into actual_count
  from ss.fact_offerings
  where fact_set_id = target_fact_set_id;

  if expected_count <> actual_count then
    raise exception 'fact offering count mismatch for %', target_fact_set_id
      using errcode = '23514';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$$;

create constraint trigger fact_offering_count_from_fact_set
after insert or update on ss.fact_sets
deferrable initially deferred
for each row execute function ss.validate_fact_offering_count();

create constraint trigger fact_offering_count_from_offering
after insert or update or delete on ss.fact_offerings
deferrable initially deferred
for each row execute function ss.validate_fact_offering_count();

create table ss.artifacts (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  media_type text not null default 'text/html; charset=utf-8'
    check (media_type = 'text/html; charset=utf-8'),
  html_bytes bytea not null
    check (octet_length(html_bytes) between 64 and 250000),
  artifact_digest ss.sha256_hex generated always as
    (encode(extensions.digest(html_bytes, 'sha256'), 'hex')) stored,
  byte_count integer generated always as (octet_length(html_bytes)) stored,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id) on delete cascade,
  unique (organization_id, project_id, artifact_digest),
  unique (organization_id, id)
);

create table ss.artifact_replicas (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  artifact_id uuid not null,
  provider_code text not null,
  object_key text not null,
  replica_digest ss.sha256_hex not null,
  verified_at timestamptz,
  deleted_at timestamptz,
  foreign key (organization_id, artifact_id)
    references ss.artifacts(organization_id, id) on delete cascade,
  unique (provider_code, object_key)
);

create table ss.site_versions (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  version_number bigint not null check (version_number > 0),
  fact_set_id uuid not null,
  artifact_id uuid not null,
  raw_facts jsonb not null check (jsonb_typeof(raw_facts) = 'object'),
  compiler_schema text not null,
  compiler_revision text not null,
  created_by_user_id uuid not null references auth.users(id),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id) on delete cascade,
  foreign key (organization_id, fact_set_id)
    references ss.fact_sets(organization_id, id),
  foreign key (organization_id, artifact_id)
    references ss.artifacts(organization_id, id),
  unique (project_id, version_number),
  unique (project_id, fact_set_id, artifact_id),
  unique (organization_id, id)
);

create table ss.release_screenings (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  version_id uuid not null,
  stage text not null check (stage in ('pre_acceptance', 'pre_publication')),
  method text not null,
  passed boolean not null,
  artifact_digest ss.sha256_hex not null,
  findings jsonb not null default '[]'::jsonb
    check (jsonb_typeof(findings) = 'array'),
  checker_revision text not null,
  checked_at timestamptz not null,
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id) on delete cascade,
  foreign key (organization_id, version_id)
    references ss.site_versions(organization_id, id),
  unique (organization_id, id)
);

create table ss.version_attestations (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  version_id uuid not null,
  user_id uuid not null references auth.users(id),
  statement_version text not null,
  attested_at timestamptz not null,
  request_id uuid not null,
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id) on delete cascade,
  foreign key (organization_id, version_id)
    references ss.site_versions(organization_id, id),
  unique (version_id, user_id, request_id),
  unique (organization_id, id)
);

create table ss.version_state_events (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  version_id uuid not null,
  state text not null
    check (state in ('draft', 'ready', 'accepted_release', 'rejected')),
  screening_id uuid,
  attestation_id uuid,
  actor_user_id uuid references auth.users(id),
  occurred_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id) on delete cascade,
  foreign key (organization_id, version_id)
    references ss.site_versions(organization_id, id),
  foreign key (organization_id, screening_id)
    references ss.release_screenings(organization_id, id),
  foreign key (organization_id, attestation_id)
    references ss.version_attestations(organization_id, id),
  unique (organization_id, id),
  check (
    state <> 'accepted_release'
    or (screening_id is not null and attestation_id is not null)
  )
);

create table ss.version_state_projection (
  organization_id uuid not null,
  project_id uuid not null,
  version_id uuid primary key,
  state text not null
    check (state in ('draft', 'ready', 'accepted_release', 'rejected')),
  last_event_id uuid not null,
  updated_at timestamptz not null,
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id) on delete cascade,
  foreign key (organization_id, version_id)
    references ss.site_versions(organization_id, id),
  foreign key (organization_id, last_event_id)
    references ss.version_state_events(organization_id, id)
);

create trigger legal_documents_no_update
before update on ss.legal_documents
for each row execute function ss.reject_update();

create trigger billing_policies_no_update
before update on ss.billing_policies
for each row execute function ss.reject_update();

create trigger fact_sets_no_update
before update on ss.fact_sets
for each row execute function ss.reject_update();

create trigger fact_offerings_no_update
before update on ss.fact_offerings
for each row execute function ss.reject_update();

create trigger artifacts_no_update
before update on ss.artifacts
for each row execute function ss.reject_update();

create trigger site_versions_no_update
before update on ss.site_versions
for each row execute function ss.reject_update();

create trigger release_screenings_no_update
before update on ss.release_screenings
for each row execute function ss.reject_update();

create trigger version_attestations_no_update
before update on ss.version_attestations
for each row execute function ss.reject_update();

create trigger version_state_events_no_update
before update on ss.version_state_events
for each row execute function ss.reject_update();

commit;
