import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { unwrapMigration, assertMigrationDelta, assertRetainedSnapshot } from '../native-release/migration-contract.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test('native adapters accept new release profiles and reject unsafe effects in isolated Python fixtures', () => {
  const script = fileURLToPath(new URL('../native-release/test-contracts.py', import.meta.url));
  const output = execFileSync('python3', ['-I', '-B', script, '-v'], { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(output, '');
});

function migration(name, body) {
  const prefix = '-- retained leading comment\n';
  const bytes = Buffer.from(prefix + 'begin;\n' + body + 'commit;\n');
  const inner = Buffer.from(prefix + body);
  return { bytes, entry: { path: 'server/data-plane/supabase/migrations/' + name + '.sql',
    sha256: hash(bytes), byteCount: bytes.length, beginOffset: Buffer.byteLength(prefix),
    innerSha256: hash(inner), innerByteCount: inner.length } };
}

test('migration contract preserves exact SQL bytes and verifies every appended migration', () => {
  const one = migration('202701010001_fixture', "CREATE TABLE ss.fixture_one (id int);\n");
  const two = migration('202701010002_fixture', "DO $$ BEGIN PERFORM 1; END; $$;\n");
  for (const { entry, bytes } of [one, two]) {
    const body = unwrapMigration(entry, bytes);
    assert(body.startsWith('-- retained leading comment\n'));
    assert(!body.endsWith('commit;\n'));
    assert.throws(() => unwrapMigration({ ...entry, beginOffset: entry.beginOffset + 1 }, bytes));
    assert.throws(() => unwrapMigration(entry, Buffer.concat([bytes, Buffer.from('\n')])));
  }
  const profile = { mode: 'schema-changing', expectedSchema: {
    beforeCount: 1, afterCount: 3, manifestSha256: 'a'.repeat(64), schemaSha256: 'b'.repeat(64) } };
  const input = { migration: { count: 3, sha256: 'a'.repeat(64), files: [
    { path: 'retained.sql', sha256: 'c'.repeat(64), byteCount: 20 }, one.entry, two.entry] },
  delta: [one.entry, two.entry], schemas: { 3: 'b'.repeat(64) } };
  assertMigrationDelta(input, profile);
  assert.throws(() => assertMigrationDelta({ ...input, delta: [one.entry] }, profile));
  assert.throws(() => assertMigrationDelta({ ...input, delta: [two.entry, one.entry] }, profile));
  assert.throws(() => assertMigrationDelta(input, { ...profile, mode: 'presentation-only' }));
});

test('additive migration acceptance rejects changed retained data, financial totals and nonempty new relations', () => {
  const profile = { expectedSchema: { beforeTableCount: 1, afterTableCount: 3 },
    migration: { addedEmptyRelations: ['ss.fixture_one', 'ss.fixture_two'] } };
  const before = { schema: { totalTableCount: 1, rowCounts: [{ relation: 'ss.retained', rowCount: '2' }] },
    content: [{ relation: 'ss.retained', rows: '2', sha256: 'a'.repeat(64) }], financial: [{ charged_minor: '5000' }] };
  const after = { schema: { totalTableCount: 3, rowCounts: [...before.schema.rowCounts,
    ...profile.migration.addedEmptyRelations.map(relation => ({ relation, rowCount: '0' }))] },
  content: [...before.content, ...profile.migration.addedEmptyRelations.map(relation => ({ relation, rows: '0', sha256: hash('') }))],
  financial: structuredClone(before.financial) };
  assertRetainedSnapshot(before, after, profile);
  for (const change of [
    a => { a.content[0].sha256 = 'b'.repeat(64); },
    a => { a.financial[0].charged_minor = '5001'; },
    a => { a.content[1].rows = '1'; },
    a => { a.schema.rowCounts[0].rowCount = '3'; },
  ]) {
    const changed = structuredClone(after); change(changed);
    assert.throws(() => assertRetainedSnapshot(before, changed, profile));
  }
});
