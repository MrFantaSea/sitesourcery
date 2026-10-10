begin;

-- Reuse existing revision/updated_at for durable fair readback scheduling.
-- A reservation is not provider evidence and never resolves uncertainty.
create or replace function ss.guard_provider_reconciliation_case()
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
    -- Reserving a read-only lookup changes only attempt recency/revision.
    -- No evidence, outcome, subject, or resolution can change on this path.
    if old.readback_state = 'none' and new.readback_state = 'none' then
      if (to_jsonb(new) - 'updated_at' - 'revision') is distinct from
         (to_jsonb(old) - 'updated_at' - 'revision') then
        raise exception 'Readback reservation may only advance recency and revision'
          using errcode = '23514';
      end if;
      return new;
    end if;
    if old.readback_state <> 'none' then
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

create index provider_reconciliation_cases_readback_fair
  on ss.provider_reconciliation_cases(updated_at, opened_at, id)
  where state = 'open' and readback_state = 'none'
    and organization_id is not null;

create function ss.hosted_provider_reconciliation_fairness_contract_v1()
returns text language sql immutable parallel safe
set search_path = pg_catalog, ss
as $$ select 'canonical-provider-reconciliation-fairness-v1'::text $$;
revoke all on function ss.hosted_provider_reconciliation_fairness_contract_v1()
  from public, anon, authenticated;
grant execute on function ss.hosted_provider_reconciliation_fairness_contract_v1()
  to service_role;

commit;
