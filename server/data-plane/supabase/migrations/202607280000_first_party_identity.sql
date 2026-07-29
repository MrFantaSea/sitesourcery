begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists auth;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end
$$;

-- Site Sourcery owns this identity table in the self-hosted production lane.
-- The canonical data-plane foreign keys intentionally target this principal.
-- `if not exists` preserves migration portability when an operator imports
-- into a PostgreSQL cluster that already supplies a compatible auth.users.
create table if not exists auth.users (
  id uuid primary key default extensions.gen_random_uuid(),
  email text not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  disabled_at timestamptz
);

alter table auth.users
  add column if not exists updated_at timestamptz not null
    default clock_timestamp(),
  add column if not exists disabled_at timestamptz;

do $$
begin
  if exists (select 1 from auth.users where email is null) then
    raise exception 'auth.users contains a principal without an email'
      using errcode = '23502';
  end if;
  alter table auth.users alter column email set not null;
end
$$;

create unique index if not exists auth_users_email_canonical
  on auth.users(lower(email));

create function auth.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end
$$;

drop trigger if exists auth_users_updated_at on auth.users;
create trigger auth_users_updated_at
before update on auth.users
for each row execute function auth.set_updated_at();

alter table auth.users enable row level security;
alter table auth.users force row level security;

revoke all on schema auth from public, anon, authenticated;
revoke all on auth.users from public, anon, authenticated;
revoke all on function auth.set_updated_at() from public, anon, authenticated;
grant usage on schema auth to service_role;
grant select, insert, update on auth.users to service_role;

commit;
