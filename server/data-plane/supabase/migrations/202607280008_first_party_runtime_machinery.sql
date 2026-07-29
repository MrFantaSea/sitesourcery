begin;

do $$
begin
  if to_regclass('ss.hosted_password_credentials') is null
    or to_regclass('ss.hosted_sessions') is null
  then
    raise exception 'hosted API migration 202607280007 must be applied first'
      using errcode = '55000';
  end if;
end
$$;

alter table ss.hosted_password_credentials
  add column pepper_version text not null default 'unconfigured'
    check (char_length(pepper_version) between 1 and 80),
  add column rotated_at timestamptz;

alter table ss.hosted_sessions
  add column reauthenticated_at timestamptz,
  add column rotation integer not null default 1 check (rotation > 0),
  add constraint hosted_sessions_reauthentication_time check (
    reauthenticated_at is null
    or (
      reauthenticated_at >= created_at
      and reauthenticated_at <= expires_at
    )
  );

create table ss.hosted_auth_rate_limits (
  scope text not null check (
    scope in ('sign_in', 'registration', 'recovery', 'reauthentication')
  ),
  subject_digest ss.sha256_hex not null,
  window_started_at timestamptz not null,
  attempt_count integer not null check (attempt_count between 0 and 1000000),
  blocked_until timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (scope, subject_digest),
  check (
    blocked_until is null
    or blocked_until >= window_started_at
  )
);

create trigger hosted_auth_rate_limits_updated_at
before update on ss.hosted_auth_rate_limits
for each row execute function ss.set_updated_at();

alter table ss.hosted_auth_rate_limits enable row level security;
alter table ss.hosted_auth_rate_limits force row level security;

revoke all on ss.hosted_auth_rate_limits from public, anon, authenticated;
grant all privileges on ss.hosted_auth_rate_limits to service_role;

commit;
