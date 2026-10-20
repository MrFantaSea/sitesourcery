import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export function unwrapMigration(entry, bytes) {
  assert(Number.isSafeInteger(entry.beginOffset) && entry.beginOffset >= 0);
  assert.equal(bytes.length, entry.byteCount);
  assert.equal(hash(bytes), entry.sha256);
  const offset = entry.beginOffset;
  assert(bytes.subarray(offset, offset + 7).equals(Buffer.from('begin;\n')));
  assert(bytes.subarray(-8).equals(Buffer.from('commit;\n')));
  const body = Buffer.concat([bytes.subarray(0, offset), bytes.subarray(offset + 7, bytes.length - 8)]);
  assert.equal(hash(body), entry.innerSha256);
  assert.equal(body.length, entry.innerByteCount);
  return body.toString('utf8');
}

export function assertMigrationDelta(input, profile) {
  const { beforeCount, afterCount } = profile.expectedSchema;
  assert.equal(profile.mode, 'schema-changing');
  assert.equal(input.migration.count, afterCount);
  assert.equal(input.migration.files.length, afterCount);
  assert.equal(input.migration.sha256, profile.expectedSchema.manifestSha256);
  assert.equal(input.schemas[String(afterCount)], profile.expectedSchema.schemaSha256);
  assert.equal(input.delta.length, afterCount - beforeCount);
  const identity = e => ({ path: e.path, sha256: e.sha256, byteCount: e.byteCount });
  assert.deepEqual(input.delta.map(identity), input.migration.files.slice(beforeCount).map(identity));
  for (const e of input.delta) {
    assert.match(e.path, /^server\/data-plane\/supabase\/migrations\/[a-z0-9_]+\.sql$/);
    assert(Number.isSafeInteger(e.beginOffset) && e.beginOffset >= 0);
    assert.match(e.innerSha256, /^[a-f0-9]{64}$/);
    assert(Number.isSafeInteger(e.innerByteCount) && e.innerByteCount > 0);
  }
}

// Deliberately supports additive migrations preserving every existing row/field.
// A migration that changes retained content needs a separately reviewed contract.
export function assertRetainedSnapshot(before, after, profile) {
  const added = profile.migration.addedEmptyRelations;
  assert.equal(before.schema.totalTableCount, profile.expectedSchema.beforeTableCount);
  assert.equal(after.schema.totalTableCount, profile.expectedSchema.afterTableCount);
  assert(!before.content.some(e => added.includes(e.relation)));
  assert.deepEqual(after.content.filter(e => !added.includes(e.relation)), before.content);
  assert.deepEqual(after.schema.rowCounts.filter(e => !added.includes(e.relation)), before.schema.rowCounts);
  const byRelation = rows => [...rows].sort((a, b) => a.relation.localeCompare(b.relation));
  assert.deepEqual(byRelation(after.content.filter(e => added.includes(e.relation))),
    byRelation(added.map(relation => ({ relation, rows: '0', sha256: hash('') }))));
  assert.deepEqual(byRelation(after.schema.rowCounts.filter(e => added.includes(e.relation))),
    byRelation(added.map(relation => ({ relation, rowCount: '0' }))));
  assert.equal(after.content.length, before.content.length + added.length);
  assert.deepEqual(after.financial, before.financial);
}
