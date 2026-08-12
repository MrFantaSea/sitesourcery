-- RESPONDER-PRIVATE-MATERIAL-01
begin;

do $$
begin
  if to_regprocedure(
      'ss.hosted_responder_fulfillment_queue_contract_v1()'
    ) is null
    or ss.hosted_responder_fulfillment_queue_contract_v1() <>
      'canonical-responder-fulfillment-queue-v1-held-default'
  then
    raise exception 'RESPONDER-FULFILLMENT-QUEUE-01 must be applied first'
      using errcode = '55000';
  end if;
end
$$;

-- Raw routes and message bodies exist only inside this authenticated
-- ciphertext envelope. The durable queue continues to store digests only.
-- One immutable snapshot is bound to one delivery operation so a later
-- template or contact change cannot alter an already authorized effect.
create table ss.responder_private_delivery_materials (
  operation_id uuid primary key,
  organization_id uuid not null,
  project_id uuid not null,
  interaction_id uuid not null,
  contact_authority_id uuid not null,
  message_kind text not null check (
    message_kind in ('missed_call_ack', 'human_handoff_ack')
  ),
  route_digest ss.sha256_hex not null,
  content_digest ss.sha256_hex not null,
  key_version text not null check (
    char_length(key_version) between 2 and 64
    and key_version ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$'
  ),
  nonce bytea,
  authentication_tag bytea,
  ciphertext bytea,
  envelope_digest ss.sha256_hex not null,
  state text not null check (state in ('active', 'destroyed')),
  destroy_reason text check (
    destroy_reason is null or destroy_reason in (
      'accepted_retention', 'opt_out', 'cancellation',
      'account_deletion', 'manual_reconciliation_closed'
    )
  ),
  created_at timestamptz not null,
  destroyed_at timestamptz,
  updated_at timestamptz not null,
  foreign key (organization_id, operation_id)
    references ss.responder_delivery_operations(organization_id, id),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, interaction_id)
    references ss.responder_interactions(organization_id, id),
  foreign key (organization_id, contact_authority_id)
    references ss.responder_contact_authorities(organization_id, id),
  unique (organization_id, operation_id),
  check (updated_at >= created_at),
  check (
    (state = 'active'
      and nonce is not null and octet_length(nonce) = 12
      and authentication_tag is not null
      and octet_length(authentication_tag) = 16
      and ciphertext is not null
      and octet_length(ciphertext) between 16 and 1024
      and destroy_reason is null and destroyed_at is null)
    or (state = 'destroyed'
      and nonce is null and authentication_tag is null and ciphertext is null
      and destroy_reason is not null and destroyed_at is not null
      and destroyed_at >= created_at)
  )
);

create index responder_private_delivery_materials_retention
  on ss.responder_private_delivery_materials(created_at, operation_id)
  where state = 'active';

create function ss.responder_private_material_envelope_digest(
  selected_operation_id uuid,
  selected_organization_id uuid,
  selected_project_id uuid,
  selected_interaction_id uuid,
  selected_contact_authority_id uuid,
  selected_message_kind text,
  selected_route_digest ss.sha256_hex,
  selected_content_digest ss.sha256_hex,
  selected_key_version text,
  selected_nonce bytea,
  selected_authentication_tag bytea,
  selected_ciphertext bytea
)
returns ss.sha256_hex
language sql
immutable
parallel safe
set search_path = pg_catalog, ss
as $$
  select ss.service_json_digest(jsonb_build_object(
    'authenticationTag', encode(selected_authentication_tag, 'base64'),
    'ciphertext', encode(selected_ciphertext, 'base64'),
    'contactAuthorityId', selected_contact_authority_id,
    'contentDigest', selected_content_digest,
    'interactionId', selected_interaction_id,
    'keyVersion', selected_key_version,
    'messageKind', selected_message_kind,
    'nonce', encode(selected_nonce, 'base64'),
    'operationId', selected_operation_id,
    'organizationId', selected_organization_id,
    'projectId', selected_project_id,
    'routeDigest', selected_route_digest,
    'schema', 'sitesourcery.responder-private-material-envelope/v1'
  ))
$$;

create function ss.guard_responder_private_delivery_material()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  operation ss.responder_delivery_operations%rowtype;
begin
  if tg_op = 'DELETE'
    or ss.current_service_actor_kind() <> 'system'
    or ss.current_service_actor_org_id() is distinct from new.organization_id
  then
    raise exception 'Responder private material lacks system authority'
      using errcode = '42501';
  end if;

  select * into strict operation
    from ss.responder_delivery_operations delivery
   where delivery.id = new.operation_id
     and delivery.organization_id = new.organization_id;

  if row(
      new.organization_id, new.project_id, new.interaction_id,
      new.contact_authority_id, new.message_kind,
      new.route_digest, new.content_digest
    ) is distinct from row(
      operation.organization_id, operation.project_id,
      operation.interaction_id, operation.contact_authority_id,
      operation.message_kind, operation.route_digest,
      operation.content_digest
    )
  then
    raise exception 'Responder private material does not match its operation'
      using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    if operation.state not in ('held', 'queued')
      or operation.attempt_count <> 0
      or new.state <> 'active'
      or new.envelope_digest <>
        ss.responder_private_material_envelope_digest(
          new.operation_id, new.organization_id, new.project_id,
          new.interaction_id, new.contact_authority_id,
          new.message_kind, new.route_digest, new.content_digest,
          new.key_version, new.nonce, new.authentication_tag,
          new.ciphertext
        )
      or new.created_at <> new.updated_at
    then
      raise exception 'Responder private material insert is invalid'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if old.state <> 'active'
    or new.state <> 'destroyed'
    or row(
      new.operation_id, new.organization_id, new.project_id,
      new.interaction_id, new.contact_authority_id, new.message_kind,
      new.route_digest, new.content_digest, new.key_version,
      new.envelope_digest, new.created_at
    ) is distinct from row(
      old.operation_id, old.organization_id, old.project_id,
      old.interaction_id, old.contact_authority_id, old.message_kind,
      old.route_digest, old.content_digest, old.key_version,
      old.envelope_digest, old.created_at
    )
    or new.updated_at < old.updated_at
  then
    raise exception 'Responder private material destruction is invalid'
      using errcode = '55000';
  end if;
  return new;
end
$$;

create trigger responder_private_delivery_materials_guard
before insert or update or delete
on ss.responder_private_delivery_materials
for each row execute function ss.guard_responder_private_delivery_material();

alter table ss.responder_private_delivery_materials enable row level security;
alter table ss.responder_private_delivery_materials force row level security;

revoke all on ss.responder_private_delivery_materials
from public, anon, authenticated, service_role;
grant select, insert, update on ss.responder_private_delivery_materials
to service_role;

revoke all on function ss.responder_private_material_envelope_digest(
  uuid, uuid, uuid, uuid, uuid, text, ss.sha256_hex, ss.sha256_hex,
  text, bytea, bytea, bytea
) from public, anon, authenticated;
grant execute on function ss.responder_private_material_envelope_digest(
  uuid, uuid, uuid, uuid, uuid, text, ss.sha256_hex, ss.sha256_hex,
  text, bytea, bytea, bytea
) to service_role;

revoke all on function ss.guard_responder_private_delivery_material()
from public, anon, authenticated, service_role;

create function ss.hosted_responder_private_material_contract_v1()
returns text
language sql
stable
set search_path = pg_catalog
as $$
select 'canonical-responder-private-material-v1-operation-bound-aes-gcm'
$$;

revoke all on function ss.hosted_responder_private_material_contract_v1()
from public, anon, authenticated, service_role;
grant execute on function ss.hosted_responder_private_material_contract_v1()
to service_role;

commit;
