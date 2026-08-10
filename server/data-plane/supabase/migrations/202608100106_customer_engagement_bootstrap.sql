begin;

do $$
begin
  if to_regprocedure('ss.hosted_runtime_contract_v53()') is null
    or ss.hosted_runtime_contract_v53() <>
      'canonical-ss-v53-joint-legal-v4-authority'
    or to_regclass('ss.service_project_profiles') is null
    or to_regclass('ss.service_assessment_reports') is null
    or to_regclass('ss.project_legal_acceptance_receipts') is null
  then
    raise exception
      'released joint legal V4 and Custom service foundations must be applied first'
      using errcode = '55000';
  end if;
end
$$;

-- Invitations contain no bearer secret. Only a SHA-256 digest is persisted;
-- the application derives and returns the one-time token at the issue edge.
create table ss.customer_engagement_invitations (
  id uuid primary key,
  issue_command_id text not null
    check (
      char_length(issue_command_id) between 8 and 200
      and issue_command_id !~ '[[:cntrl:]]'
    ),
  issued_by_operator_user_id uuid not null
    references ss.operator_profiles(user_id),
  provenance text not null
    check (
      provenance in (
        'direct_custom_inquiry',
        'delivered_assessment_successor'
      )
    ),
  account_mode text not null
    check (account_mode in ('new_account', 'existing_account')),
  reserved_customer_user_id uuid not null,
  reserved_organization_id uuid not null,
  reserved_project_id uuid not null,
  customer_email text not null
    check (
      customer_email = lower(customer_email)
      and char_length(customer_email) between 3 and 254
      and customer_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    ),
  customer_name text not null
    check (char_length(customer_name) between 1 and 100),
  organization_name text not null
    check (char_length(organization_name) between 2 and 120),
  project_name text not null
    check (char_length(project_name) between 2 and 120),
  site_kind text not null
    check (site_kind in ('new_site', 'external_site')),
  external_site_url text,
  external_site_hostname ss.canonical_hostname,
  source_organization_id uuid,
  source_assessment_report_id uuid,
  source_assessment_delivery_digest ss.sha256_hex,
  billing_policy_id uuid not null references ss.billing_policies(id),
  legal_acceptance_schema text not null
    check (
      legal_acceptance_schema =
        'sitesourcery.project-legal-acceptance/v4'
    ),
  legal_authority_digest ss.sha256_hex not null,
  token_digest ss.sha256_hex not null unique,
  issue_request_digest ss.sha256_hex not null,
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  state text not null default 'active'
    check (state in ('active', 'claimed')),
  claim_command_id text,
  claim_request_id uuid,
  claim_request_digest ss.sha256_hex,
  claimed_by_user_id uuid references auth.users(id),
  claimed_at timestamptz,
  claim_receipt_digest ss.sha256_hex,
  created_at timestamptz not null,
  unique (issued_by_operator_user_id, issue_command_id),
  unique (reserved_project_id),
  foreign key (source_organization_id, source_assessment_report_id)
    references ss.service_assessment_reports(organization_id, id),
  check (expires_at > issued_at),
  check (created_at = issued_at),
  check (
    (site_kind = 'new_site'
      and external_site_url is null
      and external_site_hostname is null)
    or (site_kind = 'external_site'
      and external_site_url is not null
      and external_site_hostname is not null
      and external_site_url =
        'https://' || external_site_hostname::text || '/')
  ),
  check (
    (provenance = 'direct_custom_inquiry'
      and source_organization_id is null
      and source_assessment_report_id is null
      and source_assessment_delivery_digest is null)
    or (provenance = 'delivered_assessment_successor'
      and account_mode = 'existing_account'
      and source_organization_id = reserved_organization_id
      and source_assessment_report_id is not null
      and source_assessment_delivery_digest is not null)
  ),
  check (
    (state = 'active'
      and claim_command_id is null
      and claim_request_id is null
      and claim_request_digest is null
      and claimed_by_user_id is null
      and claimed_at is null
      and claim_receipt_digest is null)
    or (state = 'claimed'
      and char_length(claim_command_id) between 8 and 200
      and claim_command_id !~ '[[:cntrl:]]'
      and claim_request_id is not null
      and claim_request_digest is not null
      and claimed_by_user_id = reserved_customer_user_id
      and claimed_at >= issued_at
      and claimed_at < expires_at
      and claim_receipt_digest is not null)
  )
);

create index customer_engagement_invitations_active_expiry
  on ss.customer_engagement_invitations(expires_at, id)
  where state = 'active';

create table ss.customer_engagements (
  id uuid primary key,
  invitation_id uuid not null unique
    references ss.customer_engagement_invitations(id),
  organization_id uuid not null,
  project_id uuid not null,
  customer_user_id uuid not null references auth.users(id),
  provenance text not null
    check (
      provenance in (
        'direct_custom_inquiry',
        'delivered_assessment_successor'
      )
    ),
  site_kind text not null
    check (site_kind in ('new_site', 'external_site')),
  external_site_url text,
  external_site_hostname ss.canonical_hostname,
  source_organization_id uuid,
  source_assessment_report_id uuid,
  source_assessment_delivery_digest ss.sha256_hex,
  created_by_operator_user_id uuid not null
    references ss.operator_profiles(user_id),
  project_legal_receipt_id uuid not null,
  legal_authority_digest ss.sha256_hex not null,
  claim_request_id uuid not null unique,
  engagement_digest ss.sha256_hex not null,
  claimed_at timestamptz not null,
  created_at timestamptz not null,
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, customer_user_id)
    references ss.organization_memberships(organization_id, user_id),
  foreign key (organization_id, project_legal_receipt_id)
    references ss.project_legal_acceptance_receipts(organization_id, id),
  foreign key (source_organization_id, source_assessment_report_id)
    references ss.service_assessment_reports(organization_id, id),
  unique (organization_id, id),
  unique (organization_id, project_id),
  check (created_at = claimed_at),
  check (
    (site_kind = 'new_site'
      and external_site_url is null
      and external_site_hostname is null)
    or (site_kind = 'external_site'
      and external_site_url is not null
      and external_site_hostname is not null
      and external_site_url =
        'https://' || external_site_hostname::text || '/')
  ),
  check (
    (provenance = 'direct_custom_inquiry'
      and source_organization_id is null
      and source_assessment_report_id is null
      and source_assessment_delivery_digest is null)
    or (provenance = 'delivered_assessment_successor'
      and source_organization_id is not null
      and source_assessment_report_id is not null
      and source_assessment_delivery_digest is not null)
  )
);

create function ss.guard_customer_engagement_invitation()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  source_report record;
begin
  if tg_op = 'DELETE' then
    raise exception 'customer engagement invitations are immutable'
      using errcode = '55000';
  end if;

  if tg_op = 'INSERT' then
    if ss.current_service_actor_kind() not in ('operator', 'system')
      or ss.current_service_actor_user_id() is distinct from
        new.issued_by_operator_user_id
      or (
        ss.current_service_actor_kind() = 'operator'
        and ss.current_service_actor_org_id() is distinct from
          new.reserved_organization_id
      )
      or not ss.service_operator_has_capability(
        new.issued_by_operator_user_id,
        'service_case_manage',
        new.issued_at
      )
    then
      raise exception 'engagement invitation lacks operator authority'
        using errcode = '42501';
    end if;

    if exists (
      select 1 from auth.users account
       where lower(account.email) = new.customer_email
         and account.id <> new.reserved_customer_user_id
    ) then
      raise exception 'engagement customer identity is ambiguous'
        using errcode = '23505';
    end if;

    if new.account_mode = 'new_account' then
      if exists (
        select 1 from auth.users account
         where account.id = new.reserved_customer_user_id
            or lower(account.email) = new.customer_email
      ) or exists (
        select 1 from ss.organizations organization
         where organization.id = new.reserved_organization_id
      ) then
        raise exception 'reserved engagement identity is unavailable'
          using errcode = '23505';
      end if;
    elsif not exists (
      select 1
        from auth.users account
        join ss.hosted_account_profiles profile
          on profile.user_id = account.id
        join ss.organizations organization
          on organization.id = new.reserved_organization_id
        join ss.organization_memberships membership
          on membership.organization_id = organization.id
         and membership.user_id = account.id
       where account.id = new.reserved_customer_user_id
         and lower(account.email) = new.customer_email
         and account.disabled_at is null
         and profile.state = 'active'
         and profile.display_name = new.customer_name
         and organization.state = 'active'
         and organization.name = new.organization_name
         and membership.state = 'active'
         and membership.role in ('owner', 'admin')
    ) then
      raise exception 'existing engagement customer authority is unavailable'
        using errcode = '23503';
    end if;

    if not exists (
      select 1 from ss.billing_policies policy
       where policy.id = new.billing_policy_id
         and policy.effective_at <= new.issued_at
         and (
           policy.retired_at is null
           or policy.retired_at > new.issued_at
         )
    ) then
      raise exception 'engagement billing lifecycle authority is unavailable'
        using errcode = '23503';
    end if;

    if new.provenance = 'delivered_assessment_successor' then
      select report.* into source_report
        from ss.service_assessment_reports report
       where report.organization_id = new.source_organization_id
         and report.id = new.source_assessment_report_id;
      if not found
        or source_report.customer_user_id <>
          new.reserved_customer_user_id
        or source_report.delivery_digest <>
          new.source_assessment_delivery_digest
      then
        raise exception 'assessment successor provenance is unavailable'
          using errcode = '23503';
      end if;
    end if;
    return new;
  end if;

  if old.state <> 'active'
    or new.state <> 'claimed'
    or ss.current_service_actor_kind() <> 'customer'
    or ss.current_service_actor_user_id() is distinct from
      old.reserved_customer_user_id
    or ss.current_service_actor_org_id() is distinct from
      old.reserved_organization_id
    or row(
      new.id, new.issue_command_id, new.issued_by_operator_user_id,
      new.provenance, new.account_mode, new.reserved_customer_user_id,
      new.reserved_organization_id, new.reserved_project_id,
      new.customer_email, new.customer_name, new.organization_name,
      new.project_name, new.site_kind, new.external_site_url,
      new.external_site_hostname, new.source_organization_id,
      new.source_assessment_report_id,
      new.source_assessment_delivery_digest, new.billing_policy_id,
      new.legal_acceptance_schema, new.legal_authority_digest,
      new.token_digest, new.issue_request_digest, new.issued_at,
      new.expires_at, new.created_at
    ) is distinct from row(
      old.id, old.issue_command_id, old.issued_by_operator_user_id,
      old.provenance, old.account_mode, old.reserved_customer_user_id,
      old.reserved_organization_id, old.reserved_project_id,
      old.customer_email, old.customer_name, old.organization_name,
      old.project_name, old.site_kind, old.external_site_url,
      old.external_site_hostname, old.source_organization_id,
      old.source_assessment_report_id,
      old.source_assessment_delivery_digest, old.billing_policy_id,
      old.legal_acceptance_schema, old.legal_authority_digest,
      old.token_digest, old.issue_request_digest, old.issued_at,
      old.expires_at, old.created_at
    )
  then
    raise exception 'invalid customer engagement invitation transition'
      using errcode = '55000';
  end if;
  return new;
end
$$;

create trigger customer_engagement_invitations_guard
before insert or update or delete on ss.customer_engagement_invitations
for each row execute function ss.guard_customer_engagement_invitation();

create function ss.guard_customer_engagement()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  invitation record;
begin
  if tg_op <> 'INSERT' then
    raise exception 'customer engagements are immutable'
      using errcode = '55000';
  end if;
  if ss.current_service_actor_kind() <> 'customer'
    or ss.current_service_actor_user_id() is distinct from
      new.customer_user_id
    or ss.current_service_actor_org_id() is distinct from
      new.organization_id
  then
    raise exception 'customer engagement claim lacks customer authority'
      using errcode = '42501';
  end if;
  select invite.* into invitation
    from ss.customer_engagement_invitations invite
   where invite.id = new.invitation_id;
  if not found
    or invitation.state <> 'claimed'
    or invitation.reserved_organization_id <> new.organization_id
    or invitation.reserved_project_id <> new.project_id
    or invitation.reserved_customer_user_id <> new.customer_user_id
    or invitation.provenance <> new.provenance
    or invitation.site_kind <> new.site_kind
    or invitation.external_site_url is distinct from new.external_site_url
    or invitation.external_site_hostname is distinct from new.external_site_hostname
    or invitation.source_organization_id is distinct from new.source_organization_id
    or invitation.source_assessment_report_id is distinct from new.source_assessment_report_id
    or invitation.source_assessment_delivery_digest is distinct from
      new.source_assessment_delivery_digest
    or invitation.issued_by_operator_user_id <>
      new.created_by_operator_user_id
    or invitation.legal_authority_digest <> new.legal_authority_digest
    or invitation.claim_request_id <> new.claim_request_id
    or invitation.claimed_at <> new.claimed_at
    or not exists (
      select 1
        from ss.projects project
       where project.organization_id = new.organization_id
         and project.id = new.project_id
         and project.created_by_user_id = new.customer_user_id
         and project.billing_policy_id = invitation.billing_policy_id
         and project.name = invitation.project_name
         and project.lifecycle = 'active'
    )
    or not exists (
      select 1
        from ss.project_legal_acceptance_receipts receipt
       where receipt.organization_id = new.organization_id
         and receipt.id = new.project_legal_receipt_id
         and receipt.project_id = new.project_id
         and receipt.user_id = new.customer_user_id
         and receipt.request_id = new.claim_request_id
         and receipt.schema_version = invitation.legal_acceptance_schema
         and receipt.authority_digest = new.legal_authority_digest
         and receipt.accepted_at = new.claimed_at
    )
  then
    raise exception 'customer engagement does not match its claimed invitation'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger customer_engagements_guard
before insert or update or delete on ss.customer_engagements
for each row execute function ss.guard_customer_engagement();

alter table ss.customer_engagement_invitations enable row level security;
alter table ss.customer_engagement_invitations force row level security;
alter table ss.customer_engagements enable row level security;
alter table ss.customer_engagements force row level security;

create policy customer_engagements_customer_read
on ss.customer_engagements for select
using (
  organization_id = ss.current_org_id()
  and customer_user_id = ss.current_user_id()
  and ss.is_org_member(organization_id)
);

revoke all on
  ss.customer_engagement_invitations,
  ss.customer_engagements
from public, anon, authenticated, service_role;
grant select, insert, update on ss.customer_engagement_invitations
to service_role;
grant select, insert on ss.customer_engagements to service_role;
grant select on ss.customer_engagements to authenticated;

revoke all on function ss.guard_customer_engagement_invitation()
from public, anon, authenticated, service_role;
revoke all on function ss.guard_customer_engagement()
from public, anon, authenticated, service_role;

create function ss.hosted_runtime_contract_v106()
returns text
language sql
stable
set search_path = pg_catalog
as $$
select 'canonical-ss-v106-customer-engagement-bootstrap'
$$;

revoke all on function ss.hosted_runtime_contract_v106()
from public, anon, authenticated, service_role;
grant execute on function ss.hosted_runtime_contract_v106()
to service_role;

commit;
