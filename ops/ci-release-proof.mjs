#!/usr/bin/env node

import {
  lstat
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { auditArtifactFromSitemap } from
  "../scripts/audit-artifact-from-sitemap.mjs";
import {
  writeImmutableEvidence
} from "./immutable-evidence.mjs";
import {
  CI_RELEASE_BROWSER_VERSION,
  CI_RELEASE_BROWSER_WIDTHS,
  ciReleaseContextFromEnvironment,
  ciReleaseDatabaseName,
  ciReleaseDatabaseNameSha256,
  createCiReleaseStepReceipt
} from "./ci-release-proof-runtime.mjs";
import {
  readCiReleaseSuccessorInput,
  verifyCiLegalV4Artifact,
  verifyCiReleaseCandidate,
  verifyCiReleaseFinal
} from "./ci-release-proof-repository.mjs";

function fail(message) {
  throw new Error(message);
}

function observedAt(environment) {
  return environment.CI_RELEASE_OBSERVED_AT ?? new Date().toISOString();
}

async function requireDirectory(selected, label) {
  const metadata = await lstat(selected);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    fail(`${label} must be a real non-symlink directory.`);
  }
  return path.resolve(selected);
}

function parseArgs(arguments_) {
  const [command, ...rest] = arguments_;
  if (!command || rest.length % 2 !== 0) {
    fail("CI release proof requires one command and exact flag/value pairs.");
  }
  const values = new Map();
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    if (!/^--[a-z][a-z-]*$/u.test(flag) || values.has(flag)) {
      fail("CI release proof contains an invalid or duplicate flag.");
    }
    values.set(flag, rest[index + 1]);
  }
  return { command, values };
}

function exactFlags(values, flags) {
  if (
    JSON.stringify([...values.keys()].sort()) !==
    JSON.stringify([...flags].sort())
  ) {
    fail("CI release proof command contains missing or unexpected flags.");
  }
}

async function loadContext(environment) {
  const successorInput = await readCiReleaseSuccessorInput({
    inputPath: environment.CI_RELEASE_SUCCESSOR_INPUT_PATH,
    expectedSha256: environment.CI_RELEASE_SUCCESSOR_INPUT_FILE_SHA256
  });
  const context = ciReleaseContextFromEnvironment(environment);
  if (
    context.candidateSha !==
      successorInput.originReleaseInput.epoch.source.commitSha ||
    context.successorInputDigest !== successorInput.digest
  ) {
    fail("CI release context drifted from the verified successor input.");
  }
  return { successorInput, context };
}

async function writeStep({
  step,
  details,
  context,
  environment
}) {
  const evidenceRoot = await requireDirectory(
    environment.CI_RELEASE_EVIDENCE_ROOT,
    "CI release evidence root"
  );
  const receipt = createCiReleaseStepReceipt({
    step,
    context,
    observedAt: observedAt(environment),
    details
  });
  await writeImmutableEvidence(
    path.join(evidenceRoot, `${step}.json`),
    receipt
  );
  return receipt;
}

function localAdminUrl(value) {
  let selected;
  try {
    selected = new URL(value);
  } catch {
    fail("CI PostgreSQL admin URL is invalid.");
  }
  if (
    !["postgres:", "postgresql:"].includes(selected.protocol) ||
    !["127.0.0.1", "localhost"].includes(selected.hostname) ||
    selected.password ||
    selected.search ||
    selected.hash ||
    decodeURIComponent(selected.pathname) !== "/postgres"
  ) {
    fail("CI PostgreSQL admin URL must be credential-free local PostgreSQL /postgres.");
  }
  return selected.href;
}

export async function proveDatabaseAbsent({
  adminUrl,
  databaseName,
  PoolImpl
}) {
  if (!PoolImpl) {
    const pg = await import("pg");
    PoolImpl = pg.default.Pool;
  }
  const pool = new PoolImpl({
    connectionString: localAdminUrl(adminUrl),
    max: 1
  });
  try {
    const result = await pool.query(
      `select not exists (
         select 1 from pg_database where datname = $1
       ) as database_absent`,
      [databaseName]
    );
    if (result.rows[0]?.database_absent !== true) {
      fail("CI disposable PostgreSQL database is not absent after cleanup.");
    }
    return true;
  } finally {
    await pool.end();
  }
}

export async function runCiReleaseProofCli({
  arguments_ = process.argv.slice(2),
  environment = process.env,
  writeOutput = (value) => process.stdout.write(value)
} = {}) {
  const { command, values } = parseArgs(arguments_);

  if (command === "input") {
    exactFlags(values, ["--root", "--input", "--input-sha"]);
    const successorInput = await readCiReleaseSuccessorInput({
      inputPath: values.get("--input"),
      expectedSha256: values.get("--input-sha")
    });
    await verifyCiReleaseCandidate({
      projectRoot: values.get("--root"),
      successorInput
    });
    writeOutput(`${successorInput.digest}\n`);
    return successorInput;
  }

  const { successorInput, context } = await loadContext(environment);

  if (command === "record") {
    exactFlags(values, ["--step"]);
    const step = values.get("--step");
    if (!new Set(["full-npm", "ops"]).has(step)) {
      fail("CI record command may record only full-npm or ops.");
    }
    return writeStep({
      step,
      details: {
        command: step === "full-npm" ? "npm test" : "npm run check:ops"
      },
      context,
      environment
    });
  }

  if (command === "legal-v4") {
    exactFlags(values, ["--root", "--artifact-root"]);
    const manifest = await verifyCiLegalV4Artifact({
      projectRoot: values.get("--root"),
      artifactRoot: values.get("--artifact-root"),
      successorInput
    });
    return writeStep({
      step: "legal-v4",
      details: {
        fileCount: manifest.fileCount,
        manifestSha256: manifest.sha256
      },
      context,
      environment
    });
  }

  if (command === "browser") {
    exactFlags(values, ["--root", "--artifact-root"]);
    const manifest = await verifyCiLegalV4Artifact({
      projectRoot: values.get("--root"),
      artifactRoot: values.get("--artifact-root"),
      successorInput
    });
    const result = await auditArtifactFromSitemap(
      values.get("--artifact-root")
    );
    return writeStep({
      step: "browser",
      details: {
        routeCount: result.routes.length,
        viewCount: result.viewCount,
        widths: [...CI_RELEASE_BROWSER_WIDTHS],
        browserVersion: CI_RELEASE_BROWSER_VERSION,
        artifactManifestSha256: manifest.sha256
      },
      context,
      environment
    });
  }

  if (command === "postgres") {
    exactFlags(values, []);
    const expectedDatabase = ciReleaseDatabaseName(context);
    const { runMigrationVerification } = await import(
      "../server/data-plane/tests/verify-empty-postgres-migrations.mjs"
    );
    const proof = await runMigrationVerification({
      environment,
      expectedMigrationNames:
        successorInput.migrationInventory.files.map((entry) => entry.name)
    });
    if (
      proof.ownership !== "caller" ||
      proof.databaseName !== expectedDatabase ||
      proof.postgresMajor !== 16 ||
      proof.migrationsApplied !== successorInput.migrationInventory.count
    ) {
      fail("CI PostgreSQL journey proof drifted from exact successor authority.");
    }
    return writeStep({
      step: "postgres",
      details: {
        databaseNameSha256: ciReleaseDatabaseNameSha256(expectedDatabase),
        postgresMajor: proof.postgresMajor,
        migrationCount: proof.migrationsApplied,
        migrationManifestSha256:
          successorInput.migrationInventory.manifestSha256
      },
      context,
      environment
    });
  }

  if (command === "absence") {
    exactFlags(values, []);
    const databaseName = ciReleaseDatabaseName(context);
    await proveDatabaseAbsent({
      adminUrl: environment.CI_RELEASE_PG_ADMIN_URL,
      databaseName
    });
    return writeStep({
      step: "cleanup",
      details: {
        databaseNameSha256: ciReleaseDatabaseNameSha256(databaseName),
        databaseAbsent: true
      },
      context,
      environment
    });
  }

  if (command === "final") {
    exactFlags(values, ["--root"]);
    const evidenceRoot = await requireDirectory(
      environment.CI_RELEASE_EVIDENCE_ROOT,
      "CI release evidence root"
    );
    const receipt = await verifyCiReleaseFinal({
      projectRoot: values.get("--root"),
      successorInput,
      context,
      evidenceRoot
    });
    await writeImmutableEvidence(
      path.join(evidenceRoot, "final.json"),
      receipt
    );
    writeOutput(`${JSON.stringify(receipt)}\n`);
    return receipt;
  }

  fail("CI release proof command is invalid.");
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  runCiReleaseProofCli().catch((error) => {
    process.stderr.write(`ci-release-proof: ${error.message}\n`);
    process.exitCode = 1;
  });
}
