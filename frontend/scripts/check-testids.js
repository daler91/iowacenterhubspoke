#!/usr/bin/env node
/**
 * Testid regression check.
 *
 * Design guidelines say "All interactive elements MUST have data-testid
 * attributes." The project has no ESLint config yet, so until Tier C2
 * lands proper lint rules this script provides a lightweight alternative:
 * it captures a baseline of how many data-testid attributes each tracked
 * source file has, then fails CI if any file's count drops below that
 * baseline. Adding testids is always allowed (the baseline is a floor,
 * not a target).
 *
 * Usage:
 *   node scripts/check-testids.js           # check against baseline
 *   node scripts/check-testids.js --update  # regenerate baseline
 *
 * The baseline lives at scripts/testid-baseline.json and is checked in.
 * Treat it like a snapshot: bumping numbers up via --update is always
 * fine; bumping them down requires a justification in the commit
 * message because it means test coverage regressed.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const BASELINE_PATH = path.join(__dirname, 'testid-baseline.json');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function countTestids(file) {
  const src = fs.readFileSync(file, 'utf8');
  // Match both `data-testid="..."` and `data-testid={\`...\`}` /
  // `data-testid={expr}` forms.
  const matches = src.match(/data-testid\s*=/g);
  return matches ? matches.length : 0;
}

function collect() {
  const counts = {};
  for (const file of walk(SRC)) {
    const rel = path.relative(ROOT, file).replaceAll(path.sep, '/');
    const count = countTestids(file);
    if (count > 0) counts[rel] = count;
  }
  return counts;
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) return {};
  return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
}

function saveBaseline(counts) {
  const ordered = Object.fromEntries(
    Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)),
  );
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(ordered, null, 2) + '\n');
}

const updating = process.argv.includes('--update');
const current = collect();

if (updating) {
  saveBaseline(current);
  const total = Object.values(current).reduce((a, b) => a + b, 0);
  console.log(`Testid baseline updated: ${Object.keys(current).length} files, ${total} testids.`);
  process.exit(0);
}

const baseline = loadBaseline();
const regressions = [];
for (const [file, expected] of Object.entries(baseline)) {
  const actual = current[file] ?? 0;
  if (actual < expected) {
    regressions.push({ file, expected, actual, delta: actual - expected });
  }
}

if (regressions.length > 0) {
  console.error('✗ Testid regression detected:');
  for (const r of regressions) {
    console.error(`  ${r.file}: ${r.expected} → ${r.actual} (${r.delta})`);
  }
  console.error('\nIf the drop is intentional (e.g. file was deleted or merged),');
  console.error('run: node scripts/check-testids.js --update');
  process.exit(1);
}

const totalFiles = Object.keys(current).length;
const totalTestids = Object.values(current).reduce((a, b) => a + b, 0);
console.log(`✓ Testid baseline OK: ${totalFiles} files, ${totalTestids} testids.`);
