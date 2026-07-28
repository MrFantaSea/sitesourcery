import { existsSync, lstatSync, rmSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertContainmentTarget } from './containment-contract.mjs';

function fail(message) {
  throw new Error(message);
}

export function assertExactWorktreeDeletion(porcelain, removePath) {
  if (typeof porcelain !== 'string') {
    fail('Containment status must be text.');
  }
  const normalized = porcelain.replace(/\r\n/gu, '\n');
  const lines = normalized.split('\n');
  if (lines.at(-1) === '') lines.pop();
  if (lines.length !== 1 || lines[0] !== ` D ${removePath}`) {
    fail('Containment preparation changed bytes outside the exact authorized root file.');
  }
  return true;
}

export function prepareContainment(targetRootArg, productionShaArg, removePathArg) {
  const targetRoot = resolve(targetRootArg || '');
  const removePath = String(removePathArg || '').trim();

  if (!targetRootArg) fail('Containment requires an exact production checkout root.');
  assertContainmentTarget(productionShaArg, removePath);

  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: targetRoot, encoding: 'utf8' });
  if (head.status !== 0 || head.stdout.trim() !== productionShaArg) {
    fail('The containment checkout does not match the exact authorized production commit.');
  }

  const target = resolve(targetRoot, removePath);
  const relation = relative(targetRoot, target);
  if (!relation || relation === '..' || relation.startsWith(`..${sep}`)) {
    fail('Containment path escapes the target checkout.');
  }
  if (!existsSync(target)) fail(`Containment target is absent: ${removePath}`);
  const stat = lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    fail('Containment target must be one real root HTML file.');
  }

  const before = spawnSync('git', ['status', '--porcelain'], {
    cwd: targetRoot,
    encoding: 'utf8',
  });
  if (before.status !== 0 || before.stdout !== '') {
    fail('The production-target checkout must be clean before containment.');
  }
  rmSync(target);

  const changed = spawnSync('git', ['status', '--porcelain'], {
    cwd: targetRoot,
    encoding: 'utf8',
  });
  if (changed.status !== 0) fail('Could not inspect the prepared containment artifact.');
  assertExactWorktreeDeletion(changed.stdout, removePath);
  return Object.freeze({ removePath, targetRoot });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [targetRootArg, productionShaArg, removePathArg] = process.argv.slice(2);
    const result = prepareContainment(targetRootArg, productionShaArg, removePathArg);
    console.log(`Prepared containment-only removal for ${result.removePath}.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
