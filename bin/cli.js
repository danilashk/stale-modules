#!/usr/bin/env node
import { rm } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { scanForStaleModules } from '../src/scan.js';
import { formatBytes } from '../src/format.js';

const TEXT_HINT = pc.dim('enter to continue · esc to cancel');
const CONFIRM_HINT = pc.dim('←/→ or y/n · enter to confirm · esc to cancel');

// clack's multiselect re-renders every selected row on submit, so thousands of
// options freeze the terminal. Above this count we switch to a cheap chooser.
const MAX_INTERACTIVE = 200;

function parseArgs(argv) {
  const args = { base: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--base') args.base = argv[++i];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  p.intro(pc.bgCyan(pc.black(' stale-modules ')));

  const baseDir = args.base
    ? resolve(args.base)
    : resolve(
        await p.text({
          message: `Base folder to scan?\n${TEXT_HINT}`,
          initialValue: process.cwd(),
        })
      );

  if (p.isCancel(baseDir)) {
    p.cancel('Cancelled.');
    process.exit(0);
  }

  const thresholdDays = await p.text({
    message: `Consider a project inactive after how many days?\n${TEXT_HINT}`,
    initialValue: '30',
    validate: (value) => (Number.isFinite(Number(value)) && Number(value) > 0 ? undefined : 'Enter a positive number'),
  });

  if (p.isCancel(thresholdDays)) {
    p.cancel('Cancelled.');
    process.exit(0);
  }

  const spinner = p.spinner();
  spinner.start(`Scanning ${baseDir}`);
  const projects = await scanForStaleModules(baseDir, Number(thresholdDays));
  spinner.stop(`Scanned ${baseDir} — found ${projects.length} inactive project(s)`);

  if (projects.length === 0) {
    p.outro('Nothing to clean up.');
    return;
  }

  const totalBytes = projects.reduce((sum, proj) => sum + proj.sizeBytes, 0);

  const controlsHint = pc.dim('↑/↓ move · space select · a toggle all · enter confirm · esc cancel');
  const toOption = (proj) => ({
    value: proj.rootPath,
    label: proj.name,
    hint: `${formatBytes(proj.sizeBytes)} · inactive ${proj.idleDays}d`,
  });

  // Returns the chosen projects, or null if the user cancelled / picked nothing.
  const pickFromList = async (list) => {
    const selected = await p.multiselect({
      message: `Inactive projects (${list.length}) — ${formatBytes(totalBytes)} reclaimable\n${controlsHint}`,
      options: list.map(toOption),
      required: false,
      maxItems: 12,
    });
    if (p.isCancel(selected) || selected.length === 0) return null;
    const selectedSet = new Set(selected);
    return list.filter((proj) => selectedSet.has(proj.rootPath));
  };

  let toDelete;
  if (projects.length <= MAX_INTERACTIVE) {
    toDelete = await pickFromList(projects);
  } else {
    // Too many to hand-list without freezing clack: offer all-or-largest.
    const strategy = await p.select({
      message: `${projects.length} inactive projects — ${formatBytes(totalBytes)} reclaimable.\n${pc.dim('Too many to list one by one.')}`,
      options: [
        { value: 'all', label: `Delete node_modules from ALL ${projects.length} (${formatBytes(totalBytes)})` },
        { value: 'top', label: `Pick from the ${MAX_INTERACTIVE} largest instead` },
      ],
    });
    if (p.isCancel(strategy)) {
      p.cancel('Cancelled.');
      return;
    }
    toDelete = strategy === 'all' ? projects : await pickFromList(projects.slice(0, MAX_INTERACTIVE));
  }

  if (!toDelete || toDelete.length === 0) {
    p.cancel('Nothing selected.');
    return;
  }

  const freeBytes = toDelete.reduce((sum, proj) => sum + proj.sizeBytes, 0);

  const confirmed = await p.confirm({
    message: `Delete node_modules from ${toDelete.length} project(s), freeing ${formatBytes(freeBytes)}?\n${CONFIRM_HINT}`,
    initialValue: false,
  });

  if (p.isCancel(confirmed) || !confirmed) {
    p.cancel('Cancelled. Nothing was deleted.');
    return;
  }

  let freedBytes = 0;
  let errors = 0;
  const total = toDelete.length;

  // One spinner updated with an [i/N] counter — a line per project would flood
  // the terminal on huge runs, and the counter shows progress isn't stuck.
  const deleteSpinner = p.spinner();
  deleteSpinner.start(`Deleting node_modules (0/${total})`);

  for (let i = 0; i < total; i++) {
    const proj = toDelete[i];
    deleteSpinner.message(`Deleting ${proj.name} (${i + 1}/${total}) — freed ${formatBytes(freedBytes)} so far`);
    try {
      if (basename(proj.nodeModulesPath) !== 'node_modules') {
        throw new Error('Refusing to delete a path that is not node_modules');
      }
      await rm(proj.nodeModulesPath, { recursive: true, force: true });
      freedBytes += proj.sizeBytes;
    } catch {
      errors++;
    }
  }

  deleteSpinner.stop(`Freed ${formatBytes(freedBytes)} — ${total - errors}/${total} done${errors ? ` · ${errors} failed` : ''}`);

  p.outro(`Done — freed ${formatBytes(freedBytes)} across ${toDelete.length - errors} project(s) · ${errors} error(s)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
