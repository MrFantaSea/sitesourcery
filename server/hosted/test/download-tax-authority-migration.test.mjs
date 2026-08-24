import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../data-plane/supabase/migrations/202608240144_download_tax_authority.sql",
  import.meta.url
);

test("migration 144 binds new $20 Download preparation, dispatch, and receipt tax authority", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.ok(
    sql.includes(
      "preparation #> '{purpose,price,amountMinor}' = '2000'::jsonb"
    )
  );
  assert.ok(
    sql.includes(
      "preparation #>> '{purpose,taxMode}' in ("
    )
  );
  assert.match(
    sql,
    /add constraint commerce_v2_download_tax_authority_v144[\s\S]*?not valid/u
  );
  assert.ok(
    sql.includes(
      "validate_commerce_v2_download_dispatch_tax_authority()"
    )
  );
  assert.ok(
    sql.includes(
      "validate_commerce_v2_download_receipt_tax_authority()"
    )
  );
  assert.match(
    sql,
    /prep[.]purpose_digest = new[.]purpose_digest/g
  );
  assert.ok(
    sql.includes(
      "prep.preparation #>> '{purpose,taxMode}' =\n               new.tax_mode"
    )
  );
});
