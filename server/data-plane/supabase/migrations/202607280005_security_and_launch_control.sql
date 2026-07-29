begin;

insert into ss.billing_policies (
  id,
  policy_key,
  grace_period,
  retention_period,
  effective_at
) values (
  '00000000-0000-4000-8000-000000000014',
  'abracadabra-hosted-14d-grace-90d-retention/v1',
  interval '14 days',
  interval '90 days',
  '2026-07-28T00:00:00Z'
)
on conflict (policy_key) do nothing;

alter table ss.organizations enable row level security;
alter table ss.organizations force row level security;
alter table ss.organization_memberships enable row level security;
alter table ss.organization_memberships force row level security;

create policy organizations_read_current_member
on ss.organizations
for select
using (
  id = ss.current_org_id()
  and ss.is_org_member(id)
);

create policy memberships_read_current_org
on ss.organization_memberships
for select
using (
  organization_id = ss.current_org_id()
  and ss.is_org_member(organization_id)
);

do $$
declare
  table_name text;
  tenant_tables text[] := array[
    'audit_events',
    'idempotency_keys',
    'projects',
    'term_acceptances',
    'project_required_terms',
    'project_safety_projection',
    'safety_events',
    'project_access_credentials',
    'project_access_projection',
    'project_addresses',
    'project_address_projection',
    'domain_verification_requests',
    'domain_verification_attempts',
    'project_drafts',
    'fact_sets',
    'fact_offerings',
    'artifacts',
    'artifact_replicas',
    'site_versions',
    'release_screenings',
    'version_attestations',
    'version_state_events',
    'version_state_projection',
    'provider_receipts',
    'stripe_customers',
    'checkout_intents',
    'stripe_subscriptions',
    'stripe_receipts',
    'subscription_state_events',
    'release_requests',
    'release_events',
    'releases',
    'project_serving_projection',
    'serving_events',
    'viewer_sessions',
    'support_tickets',
    'support_messages',
    'export_requests',
    'deletion_requests',
    'project_deletion_tombstones',
    'project_retained_events'
  ];
begin
  foreach table_name in array tenant_tables loop
    execute format('alter table ss.%I enable row level security', table_name);
    execute format('alter table ss.%I force row level security', table_name);
    execute format(
      'create policy %I on ss.%I for select using (ss.can_access_org(organization_id))',
      table_name || '_tenant_read',
      table_name
    );
  end loop;
end
$$;

alter table ss.transactional_outbox enable row level security;
alter table ss.transactional_outbox force row level security;
alter table ss.lifecycle_jobs enable row level security;
alter table ss.lifecycle_jobs force row level security;
alter table ss.stripe_events enable row level security;
alter table ss.stripe_events force row level security;
alter table ss.stripe_event_processing enable row level security;
alter table ss.stripe_event_processing force row level security;

alter table ss.legal_documents enable row level security;
alter table ss.legal_documents force row level security;
alter table ss.billing_policies enable row level security;
alter table ss.billing_policies force row level security;
alter table ss.catalog_plans enable row level security;
alter table ss.catalog_plans force row level security;
alter table ss.catalog_prices enable row level security;
alter table ss.catalog_prices force row level security;
alter table ss.commerce_control enable row level security;
alter table ss.commerce_control force row level security;

create policy legal_documents_authenticated_read
on ss.legal_documents for select
using (ss.current_user_id() is not null);

create policy billing_policies_authenticated_read
on ss.billing_policies for select
using (ss.current_user_id() is not null);

create policy catalog_plans_authenticated_read
on ss.catalog_plans for select
using (ss.current_user_id() is not null);

create policy catalog_prices_authenticated_read
on ss.catalog_prices for select
using (ss.current_user_id() is not null);

create policy commerce_control_authenticated_read
on ss.commerce_control for select
using (ss.current_user_id() is not null);

revoke all on schema ss from public;
revoke all on all tables in schema ss from public;
revoke all on all functions in schema ss from public;

grant usage on schema ss to authenticated, anon, service_role;

grant select on
  ss.organizations,
  ss.organization_memberships,
  ss.legal_documents,
  ss.billing_policies,
  ss.catalog_plans,
  ss.catalog_prices,
  ss.commerce_control,
  ss.projects,
  ss.project_required_terms,
  ss.project_safety_projection,
  ss.project_access_projection,
  ss.project_addresses,
  ss.project_address_projection,
  ss.project_drafts,
  ss.fact_sets,
  ss.fact_offerings,
  ss.artifacts,
  ss.site_versions,
  ss.release_screenings,
  ss.version_attestations,
  ss.version_state_projection,
  ss.stripe_subscriptions,
  ss.releases,
  ss.project_serving_projection,
  ss.support_tickets,
  ss.support_messages,
  ss.export_requests,
  ss.deletion_requests,
  ss.project_deletion_tombstones
to authenticated;

grant execute on function ss.create_organization(text) to authenticated;
grant execute on function ss.transition_version(uuid, text, uuid, uuid) to authenticated;
grant execute on function ss.request_release(uuid, uuid, uuid) to authenticated;
grant execute on function ss.cancel_project(uuid) to authenticated;

grant execute on function ss.acknowledge_private_lifecycle(
  ss.sha256_hex,
  uuid,
  uuid,
  ss.sha256_hex,
  ss.canonical_hostname,
  text
) to anon, authenticated, service_role;

grant execute on function ss.complete_release(uuid, uuid) to service_role;
grant execute on function ss.begin_terminal_project_purge(uuid, text, uuid)
  to service_role;
grant execute on function ss.finalize_terminal_project_purge(uuid)
  to service_role;

grant all privileges on all tables in schema ss to service_role;
grant execute on all functions in schema ss to service_role;

commit;
