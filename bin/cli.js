#!/usr/bin/env node
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { scanForStaleModules } from '../src/scan.js';
import { formatBytes } from '../src/format.js';

const TEXT_HINT = pc.dim('enter to continue · esc to cancel');
const CONFIRM_HINT = pc.dim('←/→ or y/n · enter to confirm · esc to cancel');

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
  const selected = await p.multiselect({
    message: `Inactive projects (${projects.length}) — ${formatBytes(totalBytes)} reclaimable\n${controlsHint}`,
    options: projects.map((proj) => ({
      value: proj.rootPath,
      label: proj.name,
      hint: `${formatBytes(proj.sizeBytes)} · inactive ${proj.idleDays}d`,
    })),
    required: false,
  });

  if (p.isCancel(selected) || selected.length === 0) {
    p.cancel('Nothing selected.');
    return;
  }

  const toDelete = projects.filter((proj) => selected.includes(proj.rootPath));
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

  for (const proj of toDelete) {
    const itemSpinner = p.spinner();
    itemSpinner.start(`Deleting ${proj.name}`);
    try {
      if (proj.nodeModulesPath.split('/').pop() !== 'node_modules') {
        throw new Error('Refusing to delete a path that is not node_modules');
      }
      await rm(proj.nodeModulesPath, { recursive: true, force: true });
      freedBytes += proj.sizeBytes;
      itemSpinner.stop(`${pc.green('✔')} ${proj.name} — freed ${formatBytes(proj.sizeBytes)}`);
    } catch (err) {
      errors++;
      itemSpinner.stop(`${pc.red('✖')} ${proj.name} — failed: ${err.message}`);
    }
  }

  p.outro(`Done — freed ${formatBytes(freedBytes)} across ${toDelete.length - errors} project(s) · ${errors} error(s)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
