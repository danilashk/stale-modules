import { readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.cache', '.turbo']);
const CONCURRENCY = 8;

async function findCandidateRoots(baseDir) {
  const roots = [];

  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    const hasNodeModules = entries.some((e) => e.isDirectory() && e.name === 'node_modules');
    if (hasNodeModules) {
      roots.push(dir);
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (SKIP_DIRS.has(entry.name)) continue;
      await walk(join(dir, entry.name));
    }
  }

  await walk(baseDir);
  return roots;
}

async function getDirSizeBytes(dirPath) {
  let total = 0;

  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      // Never follow symlinks: avoids double-counting and infinite loops.
      if (entry.isSymbolicLink()) continue;
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        try {
          const s = await stat(fullPath);
          total += s.size;
        } catch {
          // file may have vanished mid-scan, ignore
        }
      }
    }
  }

  await walk(dirPath);
  return total;
}

async function getLastActivityMs(rootDir) {
  let latest = 0;

  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else {
        try {
          const s = await stat(fullPath);
          if (s.mtimeMs > latest) latest = s.mtimeMs;
        } catch {
          // file may have vanished mid-scan, ignore
        }
      }
    }
  }

  await walk(rootDir);
  return latest;
}

async function runPool(items, worker) {
  const results = new Array(items.length);
  let index = 0;

  async function next() {
    const current = index++;
    if (current >= items.length) return;
    results[current] = await worker(items[current]);
    await next();
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, next));
  return results;
}

export async function scanForStaleModules(baseDir, thresholdDays) {
  const roots = await findCandidateRoots(baseDir);
  const now = Date.now();
  const thresholdMs = thresholdDays * 24 * 60 * 60 * 1000;

  const projects = await runPool(roots, async (rootPath) => {
    const nodeModulesPath = join(rootPath, 'node_modules');
    const [sizeBytes, lastActivityMs] = await Promise.all([
      getDirSizeBytes(nodeModulesPath),
      getLastActivityMs(rootPath),
    ]);

    const idleDays = Math.floor((now - lastActivityMs) / (24 * 60 * 60 * 1000));

    return {
      name: relative(baseDir, rootPath).split(sep).join('/') || rootPath,
      rootPath,
      nodeModulesPath,
      sizeBytes,
      lastActivityMs,
      idleDays,
    };
  });

  return projects
    .filter((p) => now - p.lastActivityMs >= thresholdMs)
    .sort((a, b) => b.sizeBytes - a.sizeBytes);
}
