begin;

-- Current written Care plans are separate from historical effect-held contracts.
create table ss.care_catalog_offers (
 id uuid primary key, organization_id uuid not null, project_id uuid not null,
 customer_user_id uuid not null references auth.users(id),
 handoff_id uuid not null references ss.service_custom_build_handoff_receipts(id),
 plan_id text not null check(plan_id in ('plan_host','plan_care_lite','plan_care','plan_care_plus','plan_partner')),
 amount_minor integer not null check(amount_minor in (2500,6900,11900,19900,34900)),
 included_minutes integer not null check(included_minutes in (0,30,60,120,240)),
 edit_cap integer not null check(edit_cap in (0,3,6,10,16)),
 document jsonb not null check(jsonb_typeof(document)='object'), offer_digest ss.sha256_hex not null,
 issued_at timestamptz not null, expires_at timestamptz not null check(expires_at>issued_at),
 issued_by uuid not null references ss.operator_profiles(user_id),
 unique(organization_id,project_id,id),
 foreign key(organization_id,project_id) references ss.projects(organization_id,id),
 check((plan_id,amount_minor,included_minutes,edit_cap) in
  (('plan_host',2500,0,0),('plan_care_lite',6900,30,3),('plan_care',11900,60,6),('plan_care_plus',19900,120,10),('plan_partner',34900,240,16)))
);
create table ss.care_catalog_offer_voids (
 offer_id uuid primary key references ss.care_catalog_offers(id),
 organization_id uuid not null, reason text not null check(length(reason) between 10 and 2000),
 recorded_at timestamptz not null, actor_user_id uuid not null references ss.operator_profiles(user_id)
);
create table ss.care_catalog_acceptances (
 id uuid primary key, offer_id uuid not null unique references ss.care_catalog_offers(id),
 organization_id uuid not null, customer_user_id uuid not null references auth.users(id),
 document jsonb not null check(jsonb_typeof(document)='object'), acceptance_digest ss.sha256_hex not null,
 accepted_at timestamptz not null
);
create table ss.care_catalog_agreements (
 id uuid primary key, organization_id uuid not null, project_id uuid not null,
 offer_id uuid not null unique references ss.care_catalog_offers(id),
 acceptance_id uuid not null unique references ss.care_catalog_acceptances(id),
 customer_user_id uuid not null references auth.users(id), binding jsonb not null,
 provider_customer_id text, subscription_id text unique,
 provider_status text, cancel_requested_at timestamptz, cancel_command_id text,
 cancel_at_period_end boolean not null default false, cancelled_at timestamptz,
 current_period_start timestamptz, current_period_end timestamptz,
 revision bigint not null default 1 check(revision>0),
 created_at timestamptz not null, reconciled_at timestamptz,
 foreign key(organization_id,project_id,offer_id) references ss.care_catalog_offers(organization_id,project_id,id),
 unique(organization_id,project_id,id)
);
-- Only a confirmed cancelled agreement may be superseded; unknown billing is not expiry.
create unique index care_catalog_one_current_project on ss.care_catalog_agreements(project_id) where cancelled_at is null;
create table ss.care_catalog_payment_attempts (
 id uuid primary key, agreement_id uuid not null references ss.care_catalog_agreements(id),
 organization_id uuid not null, command_id text not null, request_digest ss.sha256_hex not null,
 state text not null check(state in ('pending','ready','ambiguous','paid','expired')),
 checkout_session_id text unique, checkout_url text, expires_at timestamptz,
 created_at timestamptz not null, updated_at timestamptz not null,
 unique(agreement_id,command_id)
);
create unique index care_catalog_one_open_attempt on ss.care_catalog_payment_attempts(agreement_id) where state<>'expired';
create table ss.care_catalog_paid_periods (
 id uuid primary key, agreement_id uuid not null references ss.care_catalog_agreements(id),
 organization_id uuid not null, invoice_id text not null unique, payment_intent_id text, charge_id text,
 starts_at timestamptz not null, ends_at timestamptz not null check(ends_at>starts_at),
 amount_minor integer not null check(amount_minor>0), currency text not null check(currency='USD'),
 settled_at timestamptz not null, readback_digest ss.sha256_hex not null,
 invalidated_at timestamptz, invalidation_reason text check(invalidation_reason in ('refunded','disputed','unpaid')),
 recorded_at timestamptz not null, unique(agreement_id,id)
);
create index care_catalog_period_charge on ss.care_catalog_paid_periods(charge_id) where charge_id is not null;
create table ss.care_catalog_requests (
 id uuid primary key, organization_id uuid not null, agreement_id uuid not null,
 period_id uuid not null, summary text not null check(length(summary) between 10 and 2000),
 state text not null check(state in ('requested','in_progress','completed','declined')),
 minutes integer not null default 0 check(minutes between 0 and 240),
 owner_note text check(length(owner_note) between 10 and 2000), revision integer not null default 1 check(revision>0),
 created_at timestamptz not null, updated_at timestamptz not null,
 foreign key(agreement_id,period_id) references ss.care_catalog_paid_periods(agreement_id,id)
);
create table ss.care_catalog_commands (
 actor_user_id uuid not null references auth.users(id), organization_id uuid not null,
 command_id text not null check(command_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'),
 operation text not null, request_digest ss.sha256_hex not null, result jsonb not null,
 recorded_at timestamptz not null default clock_timestamp(), primary key(actor_user_id,command_id)
);
create table ss.care_catalog_provider_events (
 event_id text primary key, agreement_id uuid not null references ss.care_catalog_agreements(id),
 event_digest ss.sha256_hex not null, recorded_at timestamptz not null default clock_timestamp()
);

-- Deletion must not erase an unresolved recurring payment obligation. Cancel and
-- reconcile it first; a scheduled cancellation retains service through its paid month.
create function ss.guard_care_catalog_project_lifecycle() returns trigger language plpgsql security definer set search_path=ss,pg_temp as $$
begin
 if old.lifecycle='active' and new.lifecycle<>'active' and exists(
  select 1 from ss.care_catalog_agreements a where a.project_id=old.id and (
   (a.subscription_id is not null and (a.cancelled_at is null or a.current_period_end>clock_timestamp())) or
   exists(select 1 from ss.care_catalog_payment_attempts p where p.agreement_id=a.id and p.state in ('pending','ready','ambiguous'))
  )
 ) then raise exception 'Care payment obligation must be reconciled before project deletion' using errcode='55000'; end if;
 return new;
end $$;
create trigger projects_care_catalog_obligation before update of lifecycle on ss.projects for each row execute function ss.guard_care_catalog_project_lifecycle();
revoke all on function ss.guard_care_catalog_project_lifecycle() from public,anon,authenticated,service_role;

do $$ declare t text; begin
 foreach t in array array['care_catalog_offers','care_catalog_offer_voids','care_catalog_acceptances','care_catalog_agreements','care_catalog_payment_attempts','care_catalog_paid_periods','care_catalog_requests','care_catalog_commands','care_catalog_provider_events'] loop
 execute format('alter table ss.%I enable row level security',t);
 execute format('alter table ss.%I force row level security',t);
 execute format('revoke all on ss.%I from public,anon,authenticated,service_role',t);
 execute format('grant select,insert on ss.%I to service_role',t);
 end loop;
 foreach t in array array['care_catalog_offers','care_catalog_offer_voids','care_catalog_acceptances','care_catalog_commands','care_catalog_provider_events'] loop
 execute format('create trigger %I before update or delete on ss.%I for each row execute function ss.reject_update()',t||'_immutable',t);
 end loop;
end $$;
grant update on ss.care_catalog_agreements,ss.care_catalog_payment_attempts,ss.care_catalog_paid_periods,ss.care_catalog_requests to service_role;

-- Reuse the existing care-lifecycle loop for bounded provider catch-up.
alter table ss.care_catalog_agreements
 add column reconcile_after timestamptz not null default clock_timestamp(),
 add column reconcile_lease_owner text,
 add column reconcile_lease_until timestamptz,
 add column reconcile_fence bigint not null default 0,
 add column reconcile_attempts integer not null default 0,
 add column reconcile_error text;
alter table ss.care_catalog_paid_periods add column provider_checked_at timestamptz not null default clock_timestamp();
create index care_catalog_reconcile_due on ss.care_catalog_agreements(reconcile_after,id);

-- Immutable commercial bindings cannot be rewritten through a mutable state row.
create function ss.guard_care_catalog_binding() returns trigger language plpgsql set search_path=pg_catalog,ss as $$
begin
 if tg_table_name='care_catalog_agreements' then
 if (new.id,new.organization_id,new.project_id,new.offer_id,new.acceptance_id,new.customer_user_id,new.binding,new.created_at)
  is distinct from (old.id,old.organization_id,old.project_id,old.offer_id,old.acceptance_id,old.customer_user_id,old.binding,old.created_at)
 then raise exception 'Care agreement binding is immutable' using errcode='55000'; end if;
 elsif tg_table_name='care_catalog_paid_periods' then
 if
  (new.id,new.agreement_id,new.organization_id,new.invoice_id,new.payment_intent_id,new.charge_id,new.starts_at,new.ends_at,new.amount_minor,new.currency,new.settled_at)
  is distinct from (old.id,old.agreement_id,old.organization_id,old.invoice_id,old.payment_intent_id,old.charge_id,old.starts_at,old.ends_at,old.amount_minor,old.currency,old.settled_at)
 then raise exception 'Care paid period binding is immutable' using errcode='55000'; end if;
 end if;
 return new;
end $$;
create trigger care_catalog_agreement_binding before update on ss.care_catalog_agreements for each row execute function ss.guard_care_catalog_binding();
create trigger care_catalog_period_binding before update on ss.care_catalog_paid_periods for each row execute function ss.guard_care_catalog_binding();
revoke all on function ss.guard_care_catalog_binding() from public,anon,authenticated,service_role;

commit;
