import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  rmSync,
} from "node:fs";
import path from "node:path";

const root = process.cwd();
const output = path.join(root, "_site");
const excludedTopLevel = new Set([
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
  "QUALITY.md",
  "scripts",
]);

function copyTree(source, destination, relative = "") {
  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    if (!relative && excludedTopLevel.has(entry.name)) continue;
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
console.log("Pages artifact built in _site with development, governance, and dependency files excluded.");
