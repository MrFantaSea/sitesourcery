#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  createJointLegalV7ReviewBundle,
} from "./joint-legal-v7-review.mjs";

function parseArguments(argv) {
  if (argv.length !== 2 || argv[0] !== "--output" || !argv[1]) {
    throw new Error("usage: render-joint-legal-v7-review.mjs --output <new-directory>");
  }
  return argv[1];
}

export async function writeJointLegalV7Review({
  root = process.cwd(),
  output,
} = {}) {
  const absoluteRoot = path.resolve(root);
  const absoluteOutput = path.resolve(output ?? "");
  const relative = path.relative(absoluteRoot, absoluteOutput);
  if (
    !output
    || relative === ""
    || (!relative.startsWith(`..${path.sep}`) && relative !== "..")
  ) {
    throw new Error("joint legal V7 review output must stay outside the repository");
  }
  const bundle = createJointLegalV7ReviewBundle({ root: absoluteRoot });
  await mkdir(absoluteOutput);
  for (const artifact of bundle.artifacts) {
    const destination = path.join(absoluteOutput, ...artifact.file.split("/"));
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, artifact.bytes, "utf8");
  }
  const manifest = {
    schema: bundle.schema,
    state: bundle.state,
    published: bundle.published,
    deployable: bundle.deployable,
    privacyVersion: bundle.privacyVersion,
    websiteTermsVersion: bundle.websiteTermsVersion,
    effectiveAt: bundle.effectiveAt,
    artifacts: bundle.artifacts.map(({ role, file, sha256, byteCount }) => ({
      role,
      file,
      sha256,
      byteCount,
    })),
  };
  await writeFile(
    path.join(absoluteOutput, "joint-legal-v7-review-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  return Object.freeze({ output: absoluteOutput, manifest });
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  writeJointLegalV7Review({ output: parseArguments(process.argv.slice(2)) })
    .then(({ output }) => {
      console.log(`Joint Legal V7 review rendered at ${output}`);
    })
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exitCode = 1;
    });
}
