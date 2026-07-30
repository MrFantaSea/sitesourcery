import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const MIGRATION_017 = new URL(
  "../../data-plane/supabase/migrations/202607280017_verified_registration.sql",
  import.meta.url
);
const MIGRATION_018 = new URL(
  "../../data-plane/supabase/migrations/202607280018_verified_registration_upgrade.sql",
  import.meta.url
);

test("registration migration stages pending credentials in a service-role-only table", async () => {
  const source = await readFile(
    MIGRATION_017,
    "utf8"
  );
  assert.match(
    source,
    /create table ss\.hosted_registration_requests/u
  );
  assert.match(
    source,
    /state in \(\s*'pending_delivery',\s*'delivered',\s*'delivery_unknown',\s*'activated',\s*'superseded'/u
  );
  assert.match(
    source,
    /force row level security/u
  );
  assert.match(
    source,
    /revoke all on ss\.hosted_registration_requests\s+from public, anon, authenticated/u
  );
  assert.match(
    source,
    /grant all privileges on ss\.hosted_registration_requests\s+to service_role/u
  );
  assert.doesNotMatch(
    source,
    /activation_command_id/u
  );
});

test("registration upgrade binds activation replay and exposes the v18 runtime contract", async () => {
  const source = await readFile(
    MIGRATION_018,
    "utf8"
  );
  assert.match(
    source,
    /add column if not exists activation_command_id text/u
  );
  assert.match(
    source,
    /'legacy-activation-' \|\| id::text/u
  );
  assert.match(
    source,
    /state = 'activated'[\s\S]*activation_command_id is not null/u
  );
  assert.match(
    source,
    /create function ss\.hosted_runtime_contract_v18\(\)/u
  );
});
