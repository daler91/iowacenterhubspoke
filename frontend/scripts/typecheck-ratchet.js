#!/usr/bin/env node
/**
 * TypeScript error ratchet.
 *
 * `tsconfig.json` sets `strict: true`, but the codebase carries a large
 * pre-existing baseline of strict-mode errors — mostly implicit-any props in
 * older `.tsx` files (TS7031/TS7006) and untyped Radix wrapper returns
 * (TS2339 on `{}`). CI therefore runs `npm run typecheck` with
 * `continue-on-error: true`, which means a *new* type error is indistinguishable
 * from the existing noise.
 *
 * That is not hypothetical. `src/features/coordination/api.ts` called
 * `projectTasksAPI.comments(taskId)` — a method that does not exist, a
 * guaranteed TypeError at runtime. tsc reported it correctly, as one line
 * among 1,073, and it shipped.
 *
 * This script closes that gap without requiring the whole baseline to be paid
 * down first: it records per-file error counts and fails if any file exceeds
 * its recorded count. Fixing errors is always allowed (the baseline is a
 * ceiling, not a target) — run with --update after a cleanup to lower it.
 *
 * Usage:
 *   node scripts/typecheck-ratchet.js           # check against baseline
 *   node scripts/typecheck-ratchet.js --update  # regenerate baseline
 *
 * When the baseline reaches zero everywhere, delete this script and make
 * `npm run typecheck` blocking directly.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const BASELINE_PATH = path.join(__dirname, 'typecheck-baseline.json');

// Resolve the locally-installed compiler by absolute path rather than
// shelling out to `npx`, which would search PATH at run time.
const TSC_BIN = path.join(
  ROOT,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'tsc.cmd' : 'tsc',
);

const ERROR_LINE = /^(\S+?)\((\d+),(\d+)\): error (TS\d+):/;

function collectErrors() {
  if (!fs.existsSync(TSC_BIN)) {
    console.error(`Cannot find ${path.relative(ROOT, TSC_BIN)} — run \`npm ci\` first.`);
    process.exit(2);
  }

  let output = '';
  try {
    output = execFileSync(TSC_BIN, ['--noEmit'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    // tsc exits non-zero when it reports errors; that is the expected path.
    output = `${err.stdout || ''}${err.stderr || ''}`;
    if (!output.trim()) {
      console.error('tsc produced no output but failed — cannot evaluate ratchet.');
      process.exit(2);
    }
  }

  const counts = {};
  for (const line of output.split('\n')) {
    const match = ERROR_LINE.exec(line.trim());
    if (!match) continue;
    const file = match[1].split(path.sep).join('/');
    counts[file] = (counts[file] || 0) + 1;
  }
  return counts;
}

function total(counts) {
  return Object.values(counts).reduce((sum, n) => sum + n, 0);
}

const current = collectErrors();

if (process.argv.includes('--update')) {
  const sorted = Object.fromEntries(
    Object.entries(current).sort(([a], [b]) => a.localeCompare(b)),
  );
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(sorted, null, 2)}\n`);
  console.log(`Wrote baseline: ${total(sorted)} errors across ${Object.keys(sorted).length} files.`);
  process.exit(0);
}

if (!fs.existsSync(BASELINE_PATH)) {
  console.error(`Missing ${path.relative(ROOT, BASELINE_PATH)}. Run with --update to create it.`);
  process.exit(2);
}

const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));

const regressions = [];
for (const [file, count] of Object.entries(current)) {
  const allowed = baseline[file] || 0;
  if (count > allowed) {
    regressions.push(`  ${file}: ${count} errors (baseline ${allowed})`);
  }
}

const improvements = [];
for (const [file, allowed] of Object.entries(baseline)) {
  const count = current[file] || 0;
  if (count < allowed) {
    improvements.push(`  ${file}: ${count} errors (baseline ${allowed})`);
  }
}

if (regressions.length > 0) {
  console.error('TypeScript errors increased:\n');
  console.error(regressions.join('\n'));
  console.error(
    '\nFix the new errors. If they are genuinely pre-existing and you are ' +
    'only moving code, run `node scripts/typecheck-ratchet.js --update` and ' +
    'explain why in the commit message.',
  );
  process.exit(1);
}

console.log(
  `TypeScript ratchet OK — ${total(current)} errors ` +
  `(baseline allows ${total(baseline)}).`,
);
if (improvements.length > 0) {
  console.log(
    `\n${improvements.length} file(s) improved. Run with --update to lock the gains in:\n` +
    improvements.join('\n'),
  );
}
