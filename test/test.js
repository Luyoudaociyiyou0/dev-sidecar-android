// Basic smoke tests for dev-sidecar-android
const path = require('path');
const fs = require('fs');

const projectRoot = path.join(__dirname, '..');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${name}: ${e.message}`);
    failed++;
  }
}

console.log('Running dev-sidecar-android tests...\n');

test('package.json exists and is valid', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  if (!pkg.name || !pkg.version) throw new Error('Missing name or version');
});

test('src/proxy.js exists', () => {
  if (!fs.existsSync(path.join(projectRoot, 'src', 'proxy.js')))
    throw new Error('proxy.js not found');
});

test('src/ca.js exists', () => {
  if (!fs.existsSync(path.join(projectRoot, 'src', 'ca.js')))
    throw new Error('ca.js not found');
});

test('src/doh.js exists', () => {
  if (!fs.existsSync(path.join(projectRoot, 'src', 'doh.js')))
    throw new Error('doh.js not found');
});

test('src/log.js exists', () => {
  if (!fs.existsSync(path.join(projectRoot, 'src', 'log.js')))
    throw new Error('log.js not found');
});

test('bin/dev-sidecar-android.js exists', () => {
  if (!fs.existsSync(path.join(projectRoot, 'bin', 'dev-sidecar-android.js')))
    throw new Error('CLI entry not found');
});

test('ca.js can be required', () => {
  require(path.join(projectRoot, 'src', 'ca.js'));
});

test('doh.js can be required', () => {
  require(path.join(projectRoot, 'src', 'doh.js'));
});

test('log.js can be required', () => {
  require(path.join(projectRoot, 'src', 'log.js'));
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
