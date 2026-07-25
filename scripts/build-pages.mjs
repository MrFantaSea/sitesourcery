import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const excludedTopLevel = Object.freeze([
  ".git",
  ".github",
  ".gitignore",
  ".htmlvalidate.json",
  ".nvmrc",
  "_site",
  "data",
  "node_modules",
  "package-lock.json",
  "package.json",
  "print-collateral",
  "QUALITY.md",
  "scripts",
]);

export function buildPagesArtifact({
  root = process.cwd(),
  output = path.join(root, "_site"),
} = {}) {
  const exclusions = new Set(excludedTopLevel);
  function copyTree(source, destination, relative = "") {
    mkdirSync(destination, { recursive: true });
    for (const entry of readdirSync(source, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      if (!relative && exclusions.has(entry.name)) continue;
      const nextRelative = relative ? `${relative}/${entry.name}` : entry.name;
      const from = path.join(source, entry.name);
      const to = path.join(destination, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`public artifact refuses symbolic link: ${nextRelative}`);
      if (entry.isDirectory()) copyTree(from, to, nextRelative);
      else if (entry.isFile()) {
        if (entry.name.endsWith(".md")) continue;
        copyFileSync(from, to);
      }
    }
  }
  rmSync(output, { recursive: true, force: true });
  copyTree(root, output);
  return output;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildPagesArtifact();
  console.log("Pages artifact built in _site with development, governance, dependency, and print-collateral files excluded.");
}
