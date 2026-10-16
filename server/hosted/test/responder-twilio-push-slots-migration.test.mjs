import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("push slot migration preserves exact topology authority while excluding absent lock keys", async () => {
  const previous = await readFile(new URL("../../data-plane/supabase/migrations/202608260146_responder_twilio_isv_provider_topology.sql", import.meta.url), "utf8");
  const next = await readFile(new URL("../../data-plane/supabase/migrations/202610160001_responder_twilio_push_slots.sql", import.meta.url), "utf8");
  const guard = source => source.slice(source.indexOf("function ss.guard_responder_twilio_provider_topology()"), source.indexOf("\n$$;", source.indexOf("function ss.guard_responder_twilio_provider_topology()")) + 4);
  assert.equal(guard(next).replace("       where value is not null\n", ""), guard(previous));
  assert.equal((next.match(/drop not null/gu) ?? []).length, 4);
  assert.match(next, /add constraint responder_twilio_at_least_one_push_slot check/u);
  assert.match(next, /hosted_responder_twilio_isv_topology_contract_v2/u);
  assert.doesNotMatch(next, /drop (?:index|table)|disable row level security|insert into ss\.responder_runtime_controls/u);
});
