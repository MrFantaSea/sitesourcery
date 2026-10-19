-- Care catalog events reserve existing digest-only mail atomically. No backfill,
-- delivery activation, recipient address, message content or provider payload.
begin;

do $$ begin
  if to_regclass('ss.care_catalog_paid_periods') is null
    or ss.hosted_mail_purpose_notification_contract_v1() <>
      'canonical-mail-purpose-notifications-v1-five-families-14-sources-held'
  then raise exception 'Care catalog and existing purpose mail are required' using errcode='55000'; end if;
end $$;

create table ss.care_catalog_notification_events (
  id uuid primary key,
  agreement_id uuid not null references ss.care_catalog_agreements(id),
  organization_id uuid not null,
  project_id uuid not null,
  customer_user_id uuid not null references auth.users(id),
  notification_kind text not null,
  state text not null,
  subject_id uuid not null,
  paid_period_id uuid references ss.care_catalog_paid_periods(id),
  request_id uuid references ss.care_catalog_requests(id),
  event_sequence bigint not null check(event_sequence>0),
  event_digest ss.sha256_hex not null,
  occurred_at timestamptz not null,
  unique(agreement_id,event_sequence),
  foreign key(organization_id,project_id) references ss.projects(organization_id,id),
  foreign key(organization_id,customer_user_id) references ss.organization_memberships(organization_id,user_id),
  check(subject_id=coalesce(paid_period_id,request_id,agreement_id)),
  check(not(paid_period_id is not null and request_id is not null)),
  check(
    (notification_kind='care_catalog_paid_month_receipt' and state='paid' and paid_period_id is not null and request_id is null)
    or (notification_kind='care_catalog_payment_problem' and state in('past_due','unpaid','refunded','disputed','resolved') and request_id is null)
    or (notification_kind='care_catalog_cancellation_updated' and state in('requested','scheduled','cancelled','resumed') and paid_period_id is null and request_id is null)
    or (notification_kind='care_catalog_request_acknowledgment' and state='requested' and request_id is not null and paid_period_id is null)
    or (notification_kind='care_catalog_request_updated' and state in('in_progress','completed','declined') and request_id is not null and paid_period_id is null)
  )
);
create unique index care_catalog_notification_paid_once on ss.care_catalog_notification_events(paid_period_id)
  where notification_kind='care_catalog_paid_month_receipt';
create index care_catalog_notification_subject on ss.care_catalog_notification_events
  (agreement_id,notification_kind,subject_id,event_sequence desc);

create function ss.guard_care_catalog_notification_event() returns trigger
language plpgsql set search_path=pg_catalog,ss as $$
declare a ss.care_catalog_agreements%rowtype; p ss.care_catalog_paid_periods%rowtype;
  r ss.care_catalog_requests%rowtype; prior_state text; last_sequence bigint;
begin
  if tg_op<>'INSERT' or ss.current_service_actor_kind()<>'system' then
    raise exception 'Care notification events are immutable system evidence' using errcode='42501';
  end if;
  select * into strict a from ss.care_catalog_agreements where id=new.agreement_id for update;
  if row(new.organization_id,new.project_id,new.customer_user_id) is distinct from
     row(a.organization_id,a.project_id,a.customer_user_id)
    or new.occurred_at<clock_timestamp()-interval '5 minutes'
    or new.occurred_at>clock_timestamp()+interval '5 minutes' then
    raise exception 'Care notification scope or observation is invalid' using errcode='23514';
  end if;
  select coalesce(max(event_sequence),0) into last_sequence from ss.care_catalog_notification_events where agreement_id=a.id;
  select state into prior_state from ss.care_catalog_notification_events
    where agreement_id=a.id and notification_kind=new.notification_kind and subject_id=new.subject_id
    order by event_sequence desc limit 1;
  if new.event_sequence<>last_sequence+1 or prior_state=new.state
     or (new.state='resolved' and prior_state is null) then
    raise exception 'Care notification must record one new transition' using errcode='23514';
  end if;
  if new.paid_period_id is not null then
    select * into strict p from ss.care_catalog_paid_periods where id=new.paid_period_id and agreement_id=a.id and organization_id=a.organization_id;
  end if;
  if new.request_id is not null then
    select * into strict r from ss.care_catalog_requests where id=new.request_id and agreement_id=a.id and organization_id=a.organization_id;
  end if;
  if (
    (new.notification_kind='care_catalog_paid_month_receipt' and p.id is not null and p.invalidated_at is null and p.settled_at is not null and p.amount_minor=(a.binding->>'amountMinor')::integer and p.currency='USD')
    or (new.notification_kind='care_catalog_payment_problem' and
      ((p.id is not null and ((new.state=p.invalidation_reason and p.invalidated_at is not null) or (new.state='resolved' and p.invalidated_at is null)))
       or (new.paid_period_id is null and ((new.state in('past_due','unpaid') and a.provider_status=new.state) or (new.state='resolved' and a.provider_status in('active','trialing'))))))
    or (new.notification_kind='care_catalog_cancellation_updated' and
      ((new.state='requested' and a.cancel_requested_at is not null and not a.cancel_at_period_end and a.cancelled_at is null)
       or (new.state='scheduled' and a.cancel_at_period_end and a.cancelled_at is null)
       or (new.state='cancelled' and a.cancelled_at is not null)
       or (new.state='resumed' and not a.cancel_at_period_end and a.cancelled_at is null and prior_state='scheduled')))
    or (new.notification_kind in('care_catalog_request_acknowledgment','care_catalog_request_updated') and r.id is not null and r.state=new.state)
  ) is not true then raise exception 'Care notification lacks its exact persisted business fact' using errcode='23514'; end if;
  new.event_digest:=ss.service_json_digest(jsonb_build_object(
    'schema','sitesourcery.care-catalog-notification-event/v1','id',new.id,
    'agreementId',a.id,'organizationId',a.organization_id,'projectId',a.project_id,
    'customerUserId',a.customer_user_id,'kind',new.notification_kind,'state',new.state,
    'subjectId',new.subject_id,'sequence',new.event_sequence,
    'occurredAt',to_char(new.occurred_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
  return new;
end $$;
create trigger care_catalog_notification_event_guard before insert or update or delete
  on ss.care_catalog_notification_events for each row execute function ss.guard_care_catalog_notification_event();
alter table ss.care_catalog_notification_events enable row level security;
alter table ss.care_catalog_notification_events force row level security;
revoke all on ss.care_catalog_notification_events from public,anon,authenticated,service_role;
grant select,insert on ss.care_catalog_notification_events to service_role;
revoke all on function ss.guard_care_catalog_notification_event() from public,anon,authenticated,service_role;

-- Retain the complete existing view definition and append only the new source.
do $$ declare original_view text; begin
  original_view:=regexp_replace(pg_get_viewdef('ss.mail_purpose_notification_sources'::regclass,true),';\s*$','');
  execute 'create or replace view ss.mail_purpose_notification_sources as '||original_view||$view$
    union all select 'care',event.notification_kind,
      replace(event.notification_kind,'_','-')||'.v1',
      'ss.care_catalog_notification_events',event.id::text,1::bigint,event.event_digest,
      event.state,event.occurred_at,event.agreement_id::text,event.organization_id,
      event.project_id,event.customer_user_id from ss.care_catalog_notification_events event
  $view$;
end $$;

alter table ss.mail_purpose_notification_outbox
  drop constraint mail_purpose_notification_outbox_notification_kind_check,
  add constraint mail_purpose_notification_outbox_notification_kind_check check(notification_kind in(
    'custom_progress_updated','publication_state_changed','domain_lifecycle_updated',
    'care_ticket_acknowledgment','care_ticket_update','care_ticket_resolved','care_commerce_quote_held',
    'care_commerce_reservation_held','care_commerce_reservation_cancelled',
    'responder_commerce_quote_held','responder_commerce_reservation_held','responder_commerce_reservation_cancelled',
    'responder_forwarding_updated','engagement_followup_ready',
    'care_catalog_paid_month_receipt','care_catalog_payment_problem','care_catalog_cancellation_updated',
    'care_catalog_request_acknowledgment','care_catalog_request_updated')),
  drop constraint mail_purpose_notification_outbox_source_table_check,
  add constraint mail_purpose_notification_outbox_source_table_check check(source_table in(
    'ss.service_custom_build_progress_updates','ss.publication_control_commands','ss.domain_provider_lifecycle_states',
    'ss.care_commands','ss.care_commerce_quotes','ss.care_commerce_reservation_events','ss.responder_commerce_quotes',
    'ss.responder_commerce_reservation_events','ss.responder_forwarding_commands','ss.customer_engagements',
    'ss.care_catalog_notification_events'));
-- Extend the existing exact family/kind pair CHECK, without relaxing old arms.
do $$ declare item record; selected_count integer:=0; begin
  for item in select conname,pg_get_constraintdef(oid) as definition from pg_constraint
    where conrelid='ss.mail_purpose_notification_outbox'::regclass and contype='c'
      and pg_get_constraintdef(oid) like '%purpose_kind%' and pg_get_constraintdef(oid) like '%notification_kind%'
  loop
    selected_count:=selected_count+1;
    execute format('alter table ss.mail_purpose_notification_outbox drop constraint %I',item.conname);
    execute format('alter table ss.mail_purpose_notification_outbox add constraint %I check ((%s) or (purpose_kind=''care'' and notification_kind in (''care_catalog_paid_month_receipt'',''care_catalog_payment_problem'',''care_catalog_cancellation_updated'',''care_catalog_request_acknowledgment'',''care_catalog_request_updated'')))',item.conname,substring(item.definition from 8 for char_length(item.definition)-8));
  end loop;
  if selected_count<>1 then raise exception 'Expected one exact purpose family constraint' using errcode='55000'; end if;
end $$;

create function ss.require_care_catalog_notification_reservation() returns trigger
language plpgsql set search_path=pg_catalog,ss as $$ begin
  if not exists(select 1 from ss.mail_purpose_notification_outbox o
    where o.source_table='ss.care_catalog_notification_events' and o.source_id=new.id::text
      and o.source_digest=new.event_digest and o.source_revision=1
      and o.source_customer_user_id=new.customer_user_id and o.organization_id=new.organization_id
      and o.project_id=new.project_id and o.state='held' and not o.provider_effects_authorized and not o.delivery_claimed)
  then raise exception 'Care event must atomically reserve its existing mail outbox' using errcode='23514'; end if;
  return null;
end $$;
create constraint trigger care_catalog_notification_reservation_required
  after insert on ss.care_catalog_notification_events deferrable initially deferred
  for each row execute function ss.require_care_catalog_notification_reservation();
revoke all on function ss.require_care_catalog_notification_reservation() from public,anon,authenticated,service_role;

create function ss.hosted_mail_purpose_notification_contract_v2() returns text language sql stable
  set search_path=pg_catalog as $$select 'canonical-mail-purpose-notifications-v2-five-families-19-sources-held'::text$$;
create function ss.care_catalog_notifications_contract_v1() returns text language sql stable
  set search_path=pg_catalog as $$select 'care-catalog-notifications-v1-atomic-held-five-events'::text$$;
revoke all on function ss.hosted_mail_purpose_notification_contract_v2(),ss.care_catalog_notifications_contract_v1() from public,anon,authenticated;
grant execute on function ss.hosted_mail_purpose_notification_contract_v2(),ss.care_catalog_notifications_contract_v1() to service_role;
commit;
