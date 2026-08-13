import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = new URL(
  "../supabase/migrations/202608130131_worker_lifecycle_closure.sql",
  import.meta.url
);

test("FIN-004T migration closes project, Domain, and Care workers without lifting effects", async () => {
  const sql = await readFile(migration, "utf8");
  for (const relation of [
    "project_lifecycle_job_receipts",
    "domain_lifecycle_worker_jobs",
    "care_lifecycle_worker_jobs"
  ]) {
    assert.match(sql, new RegExp(`(?:create|alter) table ss\\.${relation}`, "iu"));
  }
  for (const token of [
    "lease_fence", "lease_expires_at", "manual_review", "dead_letter",
    "unpublish_project", "refresh_authoritative", "advance_period"
  ]) {
    assert.match(sql, new RegExp(token, "u"));
  }
  assert.match(sql, /PROJECT_DELETION_APPROVAL_REQUIRED|approval_required/iu);
  assert.doesNotMatch(
    sql,
    /provider_effects_authorized\s*=\s*true|payment_effects_authorized\s*=\s*true|publication_effects_authorized\s*=\s*true/iu
  );
});
