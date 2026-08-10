import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const MIGRATION = new URL(
  "../../data-plane/supabase/migrations/202608100111_hosted_identity_delivery_acceptance.sql",
  import.meta.url
);

test("migration 111 binds provider acceptance to token possession without granting delivery", async () => {
  const source = await readFile(MIGRATION, "utf8");
  assert.match(source, /^begin;/u);
  assert.match(source, /commit;\s*$/u);
  assert.match(
    source,
    /delivery_lineage_version = 'provider_accepted_v1'[\s\S]*mail_delivery_id is not null[\s\S]*provider_accepted_at is not null/u
  );
  assert.match(
    source,
    /possession_evidence_digest[\s\S]*possession_proven_at[\s\S]*delivered_at = possession_proven_at/u
  );
  assert.match(
    source,
    /new\.delivery_receipt ->> 'state' <> 'provider_accepted'/u
  );
  assert.match(
    source,
    /new\.state = 'activated'[\s\S]*registration activation lacks possession evidence/u
  );
  assert.match(
    source,
    /recovery\.used_at is null[\s\S]*recovery\.used_at <> new\.possession_proven_at/u
  );
  assert.match(
    source,
    /new\.state = 'delivered'[\s\S]*old\.state = 'provider_accepted'[\s\S]*new\.possession_proven_at is null[\s\S]*provider acceptance cannot claim recovery delivery/u
  );
  assert.doesNotMatch(
    source,
    /state = 'delivered'[\s\S]{0,300}provider_accepted_at =/u
  );
});
