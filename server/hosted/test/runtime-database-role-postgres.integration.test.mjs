import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { createCanonicalPostgresAuthority } from "../repository-postgres.mjs";
import { createPostgresIdentityBridge, hashPasswordWithPepper } from "../identity-postgres.mjs";

const DATABASE_URL = process.env.SITESOURCERY_PG_RUNTIME_ROLE_TEST_URL;
const denied = (error) => error.code === "42501";
const identifier = (value) => {
  assert.match(value, /^[a-z][a-z0-9_]{0,62}$/u);
  return `"${value}"`;
};

test("NOINHERIT runtime login supports explicit application roles without database administration", {
  skip: !DATABASE_URL, timeout: 60_000
}, async (t) => {
  const url = new URL(DATABASE_URL);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
  assert.match(url.pathname, /^\/ss_runtime_role_[a-z0-9_]+$/u);
  const admin = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
  const role = `ss_runtime_${randomUUID().replaceAll("-", "")}`;
  const quotedRole = identifier(role);
  const database = identifier(decodeURIComponent(url.pathname.slice(1)));
  let runtime;
  let created = false;
  try {
    const context = (await admin.query(`select current_user as owner,
      current_setting('server_version_num')::integer as version,
      current_user = pg_get_userbyid(datdba) as owns_database
      from pg_database where datname = current_database()`)).rows[0];
    assert.equal(Math.floor(context.version / 10_000), 16);
    assert.equal(context.owns_database, true);
    assert.equal((await admin.query("select count(*)::integer as count from pg_roles where rolname = $1", [role])).rows[0].count, 0);
    const password = randomBytes(32).toString("base64url");
    // Generated base64url is a SQL-literal-safe ephemeral fixture secret. It
    // remains in memory only and is never logged or exported to a receipt.
    assert.match(password, /^[A-Za-z0-9_-]+$/u);
    await admin.query(`create role ${quotedRole} login noinherit nosuperuser
      nocreatedb nocreaterole noreplication nobypassrls password '${password}'`);
    created = true;
    await admin.query(`grant authenticated, service_role to ${quotedRole} with inherit false`);
    await admin.query(`grant authenticated, service_role to ${quotedRole} with set true`);
    await admin.query(`grant authenticated, service_role to ${quotedRole} with admin false`);
    await admin.query(`grant connect on database ${database} to ${quotedRole}`);
    url.username = role;
    url.password = password;
    runtime = new pg.Pool({ connectionString: url.href, max: 3 });
    const authority = createCanonicalPostgresAuthority({ pool: runtime });

    await t.test("login and membership metadata confer no inherited or administrative authority", async () => {
      const metadata = (await runtime.query(`select current_user as name, rolsuper, rolinherit,
        rolcreaterole, rolcreatedb, rolreplication, rolbypassrls
        from pg_roles where rolname = current_user`)).rows[0];
      assert.equal(metadata.name, role);
      for (const [key, value] of Object.entries(metadata)) if (key !== "name") assert.equal(value, false, key);
      const grants = (await runtime.query(`select parent.rolname, membership.admin_option,
        membership.inherit_option, membership.set_option
        from pg_auth_members membership join pg_roles parent on parent.oid=membership.roleid
        where membership.member=(select oid from pg_roles where rolname=current_user)
        order by parent.rolname`)).rows;
      assert.deepEqual(grants, ["authenticated", "service_role"].map(rolname => ({ rolname, admin_option: false, inherit_option: false, set_option: true })));
      for (const sql of [
        "select id from auth.users limit 1",
        "select id from ss.legal_documents limit 1",
        `set role ${identifier(context.owner)}`,
        `set session authorization ${identifier(context.owner)}`,
        `alter role ${quotedRole} superuser`,
        `grant service_role to ${quotedRole} with admin true`,
        "select pg_read_file('PG_VERSION')",
        "copy (select 1) to program '/nonexistent/sitesourcery-security-fixture'",
        `create schema ${quotedRole}`
      ]) await assert.rejects(runtime.query(sql), denied, sql.split(" ").slice(0, 3).join(" "));
    });

    await t.test("complete readiness and legal-authority matching need no direct login table grants", async () => {
      const ready = await authority.readiness();
      assert.equal(ready.ready, true, JSON.stringify(ready));
      assert.equal(ready.projectCreationLegal.ready, true, JSON.stringify(ready));
      const ids = ["00000000-0000-4000-8000-000000000048", "00000000-0000-4000-8000-000000000103", "00000000-0000-4000-8000-000000000104"];
      const data = (await admin.query(`select document.*, artifact.artifact_uri,
        artifact.artifact_sha256, artifact.byte_count, artifact.media_type
        from ss.legal_documents document left join ss.legal_document_artifacts artifact
        on artifact.document_id=document.id where document.id=any($1::uuid[])`, [ids])).rows;
      const ordered = ids.map(id => data.find(row => row.id === id));
      const documents = ordered.map(row => ({ kind: row.kind, version: row.version,
        contentDigest: row.content_digest, contentUri: row.content_uri,
        effectiveAt: new Date(row.effective_at).toISOString() }));
      const schema = "sitesourcery.project-legal-authority/v3";
      const authorityDigest = (await admin.query("select ss.project_legal_json_digest($1::jsonb) as digest", [JSON.stringify({ schema, documents })])).rows[0].digest;
      const expected = { schema, documents, authorityDigest, documentBindings: ids.map(id => ({ id })),
        artifactBindings: ordered.map(row => ({ artifactUri: row.artifact_uri,
          artifactSha256: row.artifact_sha256, byteCount: Number(row.byte_count), mediaType: row.media_type })) };
      assert.equal(await authority.projectLegalAuthorityMatches(expected), true);
      assert.equal(await authority.projectLegalAuthorityMatches({ ...expected, authorityDigest: "f".repeat(64) }), false);
      assert.equal((await runtime.query("select current_user as name")).rows[0].name, role);
      await assert.rejects(runtime.query("select id from ss.legal_documents limit 1"), denied);
    });

    const user = randomUUID(), otherUser = randomUUID(), organization = randomUUID(), otherOrganization = randomUUID();
    const email = `runtime-role-${user}@example.test`;
    const pepper = randomBytes(32);
    const credential = await hashPasswordWithPepper("fixture correct password only", { pepper, pepperVersion: "fixture" });
    await admin.query("insert into auth.users(id,email) values($1,$2),($3,$4)", [user,email,otherUser,`other-${otherUser}@example.test`]);
    await admin.query("insert into ss.hosted_account_profiles(user_id,display_name) values($1,'Runtime identity fixture')", [user]);
    await admin.query("insert into ss.hosted_password_credentials(user_id,password_phc,pepper_version) values($1,$2,'fixture')", [user,credential]);
    await admin.query("insert into ss.organizations(id,created_by_user_id,name) values($1,$2,'Visible tenant'),($3,$4,'Hidden tenant')", [organization,user,otherOrganization,otherUser]);
    await admin.query("insert into ss.organization_memberships(organization_id,user_id,role,state,accepted_at) values($1,$2,'owner','active',clock_timestamp())", [organization,user]);

    await t.test("identity and service work use explicit app authority while tenant role remains RLS scoped", async () => {
      const identity = createPostgresIdentityBridge({ pool: runtime, authority, pepper, pepperVersion: "fixture" });
      const signedIn = await identity.signIn({ email, password: "fixture correct password only" }, { clientAddress: "192.0.2.71" });
      assert.equal((await identity.authenticate(signedIn.sessionToken)).userId, user);
      const service = await authority.service({ readOnly: true }, client => client.query("select current_user as name, count(*)::integer as count from ss.organizations"));
      assert.equal(service.rows[0].name, "service_role");
      assert.equal(service.rows[0].count, 2, "service_role intentionally has application-wide access");
      const visible = await authority.tenant({ userId: user, organizationId: organization, readOnly: true }, client => client.query("select id from ss.organizations order by id"));
      assert.deepEqual(visible.rows.map(row => row.id), [organization]);
      const foreign = await authority.tenant({ userId: user, organizationId: otherOrganization, readOnly: true }, client => client.query("select id from ss.organizations"));
      assert.equal(foreign.rowCount, 0);
      await assert.rejects(authority.tenant({ userId: user, organizationId: organization, readOnly: true }, client => client.query("select user_id from ss.hosted_password_credentials")), denied);
      await assert.rejects(authority.service({ readOnly: true }, client => client.query("update ss.hosted_sessions set revoked_at=clock_timestamp() where user_id=$1", [user])), error => error.code === "25006");
      await assert.rejects(authority.service({}, client => client.query("select pg_read_file('PG_VERSION')")), denied);
      await assert.rejects(authority.service({}, client => client.query("copy (select 1) to program '/nonexistent/sitesourcery-security-fixture'")), denied);
      await assert.rejects(authority.service({}, client => client.query(`set role ${identifier(context.owner)}`)), denied);
      assert.equal((await runtime.query("select current_user as name")).rows[0].name, role);
      await assert.rejects(runtime.query("select id from auth.users limit 1"), denied);
    });
  } finally {
    if (runtime) await runtime.end();
    try { if (created) {
      // Exact newly created role only; no DROP OWNED/CASCADE and no shared-role
      // mutations. Refuse cleanup if the fixture unexpectedly owns objects.
      const owners = (await admin.query(`select
        (select count(*) from pg_class where relowner=(select oid from pg_roles where rolname=$1)) +
        (select count(*) from pg_namespace where nspowner=(select oid from pg_roles where rolname=$1)) as count`, [role])).rows[0];
      assert.equal(Number(owners.count), 0);
      await admin.query(`revoke connect on database ${database} from ${quotedRole}`);
      await admin.query(`drop role ${quotedRole}`);
      assert.equal((await admin.query("select count(*)::integer as count from pg_roles where rolname=$1", [role])).rows[0].count, 0);
    } } finally { await admin.end(); }
  }
});
