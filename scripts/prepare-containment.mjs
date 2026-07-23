import { existsSync, lstatSync, rmSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

const [targetRootArg, removePathArg] = process.argv.slice(2);
const targetRoot = resolve(targetRootArg || '');
const removePath = String(removePathArg || '').trim();
const SAFE_PUBLIC_PATH = /^[a-z0-9][a-z0-9-]*$/;
const PROTECTED = new Set(['assets', 'start']);

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!targetRootArg || !SAFE_PUBLIC_PATH.test(removePath)) {
  fail('Containment requires a checkout root and one lowercase top-level public path.');
}
if (PROTECTED.has(removePath)) fail(`${removePath} is a protected core path and cannot use the demo-containment lane.`);

const target = resolve(targetRoot, removePath);
const relation = relative(targetRoot, target);
if (!relation || relation === '..' || relation.startsWith(`..${sep}`)) fail('Containment path escapes the target checkout.');
if (!existsSync(target)) fail(`Containment target is absent: ${removePath}`);
const stat = lstatSync(target);
if (!stat.isDirectory() || stat.isSymbolicLink()) fail('Containment target must be a real top-level directory.');

const before = spawnSync('git', ['status', '--porcelain'], { cwd: targetRoot, encoding: 'utf8' });
if (before.status !== 0 || before.stdout.trim()) fail('The production-target checkout must be clean before containment.');
rmSync(target, { recursive: true });

const changed = spawnSync('git', ['status', '--porcelain'], { cwd: targetRoot, encoding: 'utf8' });
if (changed.status !== 0) fail('Could not inspect the prepared containment artifact.');
const lines = changed.stdout.trim().split('\n').filter(Boolean);
if (!lines.length || lines.some((line) => {
  const path = line.slice(3);
  return path !== removePath && !path.startsWith(`${removePath}/`);
})) {
  fail('Containment preparation changed files outside the authorized top-level path.');
}
console.log(`Prepared containment-only removal for ${removePath}.`);
