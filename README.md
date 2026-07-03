# stale-modules

**Find `node_modules` folders in projects you haven't touched in a while, and reclaim the disk space** — through a fast, friendly interactive CLI.

Old side-projects quietly hoard gigabytes in `node_modules`. `stale-modules` scans a folder full of projects, finds the ones you haven't worked on in a while, shows you how much space each is wasting, and lets you delete the `node_modules` with a single confirmation. Your source code is never touched — a quick `npm install` brings any project back to life.

---

## Quick start

No install needed:

```bash
npx stale-modules
```

Then just answer the prompts.

---

## Usage

```bash
npx stale-modules                 # asks which folder to scan
npx stale-modules --base ~/code   # scan ~/code directly, skip the folder question
```

### What happens

1. **Which folder?** — point it at the directory that holds your projects (e.g. `~/code`).
2. **How many days of inactivity = "stale"?** — e.g. `30`. Projects untouched for at least that long show up.
3. **Pick what to delete** — a checklist of stale projects, each with its `node_modules` size and how long it's been idle, biggest first.
4. **Confirm** — nothing is deleted until you explicitly say yes.

### Keyboard controls

Every screen shows its controls, but for reference:

| Key | Action |
| --- | --- |
| `↑` / `↓` | Move up / down the list |
| `Space` | Select / deselect the highlighted project |
| `a` | Select / deselect **all** |
| `Enter` | Confirm and continue |
| `Esc` | Cancel and quit (nothing is deleted) |

### Flags

- `--base <path>` — skip the folder prompt and scan this path directly.

---

## How "inactive" is determined

`stale-modules` looks at the **most recent modification time of your actual source files** (ignoring `node_modules`, `.git`, and build output like `dist`, `build`, `.next`, `.cache`, `.turbo`).

It deliberately does **not** use git commit history. Plenty of people work locally for a long time without committing, so a project's real activity is better reflected by when its files were last touched than by when they were last pushed.

---

## Safety

- **Only ever deletes directories literally named `node_modules`.** Every deletion is guarded — any path whose final segment isn't `node_modules` is refused.
- **Nothing is deleted without an explicit confirmation step** (which defaults to *No*).
- **Deleting `node_modules` never touches your source code.** It's fully recoverable — just run `npm install` in the project again.

---

## Local install (for development)

Clone the repo and link it so the `stale-modules` (and short alias `nmclean`) commands work from anywhere:

```bash
git clone https://github.com/danilashk/stale-modules.git
cd stale-modules
npm install
npm link          # creates global `stale-modules` / `nmclean` commands

nmclean --base ~/code   # run from any folder

npm unlink -g stale-modules   # undo when you're done
```

---

## Requirements

- Node.js >= 18

## License

MIT
