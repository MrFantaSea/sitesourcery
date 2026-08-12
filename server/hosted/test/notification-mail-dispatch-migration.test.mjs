import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const MIGRATION = new URL(
  "../../data-plane/supabase/migrations/202608110118_hosted_mail_dispatch_claims.sql",
  import.meta.url
);

test("MAIL-ROUTE-DISPATCH-02 migration is additive, leased, digest-only, and forced-RLS", async () => {
  const source = await readFile(MIGRATION, "utf8");
  assert.match(source, /^-- MAIL-ROUTE-DISPATCH-02\nbegin;/u);
  assert.match(source, /commit;\s*$/u);
  assert.match(source, /hosted_runtime_contract_v54\(\)/u);
  assert.match(source, /hosted_support_case_contract_v1\(\)/u);
  assert.match(source, /hosted_commerce_notification_contract_v1\(\)/u);
  assert.match(source, /create table ss\.hosted_mail_dispatch_claims/u);
  assert.match(source, /attempt_number[\s\S]*fence_token/u);
  assert.match(
    source,
    /lease_expires_at >= lease_started_at \+ interval '30 seconds'/u
  );
  assert.match(
    source,
    /lease_expires_at <= lease_started_at \+ interval '5 minutes'/u
  );
  assert.match(source, /old\.lease_expires_at > new\.lease_started_at/u);
  assert.match(source, /new\.fence_token <> old\.fence_token \+ 1/u);
  assert.match(source, /new\.closure_evidence_digest is distinct from coalesce/u);
  assert.match(
    source,
    /alter table ss\.hosted_mail_dispatch_claims force row level security/u
  );
  assert.match(
    source,
    /grant select, insert, update on ss\.hosted_mail_dispatch_claims\s+to service_role/u
  );
  assert.doesNotMatch(
    source,
    /grant (?:delete|all).*hosted_mail_dispatch_claims/iu
  );
  assert.doesNotMatch(
    source,
    /email_address|recipient_email|message_body|subject_text|raw_payload|provider_message_id|api[_-]?key|secret/iu
  );
});
