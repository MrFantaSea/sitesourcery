import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { HostedError, invariant } from "./errors.mjs";

const require = createRequire(import.meta.url);
const compilerUrl = new URL(
  "../../abracadabra/app/abracadabra-compiler.js",
  import.meta.url
);
const canonicalCompiler = require(fileURLToPath(compilerUrl));

export const SPARK_COMPILER_SCHEMA = "abracadabra.spark/v1";
export const SPARK_COMPILER_REVISION_PREFIX = "sha256:";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function cloneCompilerValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function validateCompiler(api) {
  invariant(
    api &&
      api.SCHEMA === SPARK_COMPILER_SCHEMA &&
      typeof api.compileSite === "function" &&
      typeof api.normalizeFacts === "function" &&
      typeof api.stableStringify === "function",
    "COMPILER_UNAVAILABLE",
    "The reviewed Spark compiler is unavailable.",
    { status: 503 }
  );
  return api;
}

export async function createSparkCompilerPort({
  expectedSourceDigest = null
} = {}) {
  const source = await readFile(compilerUrl);
  const sourceDigest = sha256(source);
  if (expectedSourceDigest !== null) {
    invariant(
      sourceDigest === expectedSourceDigest,
      "COMPILER_REVISION_MISMATCH",
      "The installed Spark compiler does not match the approved revision.",
      { status: 503 }
    );
  }
  const api = validateCompiler(canonicalCompiler);

  return Object.freeze({
    schema: SPARK_COMPILER_SCHEMA,
    revision: `${SPARK_COMPILER_REVISION_PREFIX}${sourceDigest}`,
    sourceDigest,

    compile(rawFacts) {
      let result;
      let normalized;
      try {
        normalized = api.normalizeFacts(cloneCompilerValue(rawFacts));
        result = api.compileSite(cloneCompilerValue(rawFacts));
      } catch (error) {
        if (error?.name === "SparkValidationError") {
          throw new HostedError(
            "SPARK_FACTS_INVALID",
            "The website facts did not pass Spark validation.",
            {
              status: 400,
              details: {
                fields: Array.isArray(error.errors)
                  ? error.errors.map((entry) => String(entry?.field ?? "")).filter(Boolean)
                  : []
              }
            }
          );
        }
        throw error;
      }

      const htmlBytes = Buffer.from(result.html, "utf8");
      invariant(
        htmlBytes.byteLength >= 64 && htmlBytes.byteLength <= 250_000,
        "COMPILER_OUTPUT_INVALID",
        "The Spark compiler produced an artifact outside the allowed size.",
        { status: 500 }
      );
      invariant(
        result.schema === SPARK_COMPILER_SCHEMA &&
          result.artifactDigest === sha256(htmlBytes) &&
          result.contentDigest ===
            sha256(api.stableStringify(result.facts)) &&
          result.normalizedDigest ===
            sha256(api.stableStringify(normalized)),
        "COMPILER_OUTPUT_INVALID",
        "The Spark compiler output failed exact digest verification.",
        { status: 500 }
      );

      return Object.freeze({
        schema: SPARK_COMPILER_SCHEMA,
        compilerRevision: `${SPARK_COMPILER_REVISION_PREFIX}${sourceDigest}`,
        normalizedFacts: cloneCompilerValue(normalized),
        contentFacts: cloneCompilerValue(result.facts),
        offerings: cloneCompilerValue(result.facts.offerings ?? []),
        contentDigest: result.contentDigest,
        normalizedDigest: result.normalizedDigest,
        artifactDigest: result.artifactDigest,
        html: result.html,
        htmlBytes
      });
    }
  });
}
