import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { MAIL_PURPOSE_NOTIFICATION_AUTHORITIES } from
  "../mail-purpose-notifications.mjs";

const migrationUrl = new URL(
  "../../data-plane/supabase/migrations/" +
  "202608180140_hosted_mail_purpose_notifications.sql",
  import.meta.url
);

test("migration 140 freezes the exact 14-source purpose outbox and reviewed owner mappings", async () => {
  const source = await readFile(migrationUrl, "utf8");
  assert.equal(Object.keys(MAIL_PURPOSE_NOTIFICATION_AUTHORITIES).length, 14);
  assert.equal([...source.matchAll(/\nunion all\n/gu)].length, 13);
  assert.match(source, /'publication_state_changed'[\s\S]{0,260}command[.]action,[\s\S]{0,100}command[.]project_id::text/u);
  assert.match(source, /'domain_lifecycle_updated'[\s\S]{0,260}'ss[.]domain_provider_lifecycle_states'[\s\S]{0,180}state[.]revision, state[.]state_digest, state[.]lifecycle_status,[\s\S]{0,120}state[.]domain_name::text/u);
  for (const [kind, authority] of Object.entries(
    MAIL_PURPOSE_NOTIFICATION_AUTHORITIES
  )) {
    assert.match(source, new RegExp(`'${kind}'`, "u"));
    assert.match(
      source,
      new RegExp(authority.table.replaceAll(".", "[.]"), "u")
    );
    assert.match(source, new RegExp(`'${authority.templateVersion}'`, "u"));
  }
  assert.match(source, /unique \(organization_id, command_id\)/u);
  assert.match(source, /mail[.]command_id = \('mail-purpose:' \|\| new[.]request_digest\)/u);
  assert.match(source, /mail[.]template_version = new[.]template_version/u);
  assert.match(source, /hosted_mail_exception_projection_message_type_check_v140/u);
  assert.match(source, /hosted_mail_dispatch_claims_source_kind_check_v140/u);
  assert.match(source, /create trigger hosted_mail_purpose_scope_guard/u);
  assert.match(source, /create trigger mail_purpose_notification_guard/u);
  assert.match(source, /enable row level security/u);
  assert.match(source, /force row level security/u);
  assert.equal(
    [...source.matchAll(/\bid uuid primary key\b/gu)].length,
    1
  );
  assert.doesNotMatch(source, /\b(?:recipient_email|message_body|provider_id)\b/u);
});
