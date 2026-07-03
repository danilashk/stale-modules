import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, utimes, rm, access, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanForStaleModules } from '../src/scan.js';

const DAY = 24 * 60 * 60 * 1000;

async function makeProject(base, name, idleDays, depFiles) {
  const dir = join(base, name);
  await mkdir(join(dir, 'src'), { recursive: true });
  await mkdir(join(dir, 'node_modules', 'dep'), { recursive: true });
  const srcFile = join(dir, 'src', 'index.js');
  await writeFile(srcFile, `// ${name}\n`);
  const when = new Date(Date.now() - idleDays * DAY);
  await utimes(srcFile, when, when);
  for (let i = 0; i < depFiles; i++) {
    await writeFile(join(dir, 'node_modules', 'dep', `chunk${i}.bin`), 'x'.repeat(50_000));
  }
  return dir;
}

async function withTempDir(fn) {
  const base = await mkdtemp(join(tmpdir(), 'stale-modules-test-'));
  try {
    return await fn(base);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}

test('returns only projects idle past the threshold', async () => {
  await withTempDir(async (base) => {
    await makeProject(base, 'fresh', 2, 5);
    await makeProject(base, 'medium', 45, 5);
    await makeProject(base, 'ancient', 200, 5);

    const results = await scanForStaleModules(base, 30);
    const names = results.map((p) => p.name);

    assert.ok(!names.includes('fresh'), 'fresh project must be excluded');
    assert.ok(names.includes('medium'), 'medium project must be included');
    assert.ok(names.includes('ancient'), 'ancient project must be included');
  });
});

test('sorts results biggest node_modules first', async () => {
  await withTempDir(async (base) => {
    await makeProject(base, 'small', 60, 2);
    await makeProject(base, 'big', 60, 40);

    const results = await scanForStaleModules(base, 30);
    assert.equal(results[0].name, 'big', 'largest node_modules should come first');
  });
});

test('ignores freshly installed node_modules when judging activity', async () => {
  await withTempDir(async (base) => {
    // source is old, but node_modules files are brand new (just created)
    const dir = await makeProject(base, 'old-with-fresh-deps', 100, 30);
    await access(join(dir, 'node_modules'));

    const results = await scanForStaleModules(base, 30);
    assert.equal(results.length, 1);
    assert.ok(results[0].idleDays >= 99, 'idle should reflect source mtime, not node_modules');
  });
});

test('empty base directory yields no results', async () => {
  await withTempDir(async (base) => {
    const results = await scanForStaleModules(base, 30);
    assert.equal(results.length, 0);
  });
});

test('skips hidden/dot directories (global installs, caches, tooling)', async () => {
  await withTempDir(async (base) => {
    // a real project + a node_modules buried in a hidden dir (like ~/.npm-global/lib)
    await makeProject(base, 'real-project', 100, 5);
    await makeProject(base, '.npm-global/lib', 100, 5);

    const results = await scanForStaleModules(base, 30);
    const names = results.map((p) => p.name);

    assert.ok(names.includes('real-project'), 'real project must be found');
    assert.ok(
      !names.some((n) => n.startsWith('.')),
      'nothing under a hidden directory should be found',
    );
  });
});
