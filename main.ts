// A token-radar-01 entry (Node 22, standard library only).
//
// The program reads the sealed snapshot from /input/snapshot.json (or --input <file|dir>),
// scores every rankable pre-token protocol with the radar-2 model in lib/model.ts, writes the
// ranked board to /output/board.json, and copies this repository's dashboard/ and screenshots/
// to /output. Last, it writes /output/dossier.json, the summary the judge reads, with the
// vendored make.fun library.
//
// The dashboard is a static page, no framework and no network: dashboard/index.html,
// dashboard/app.css and dashboard/app.js read /output/data.js, which this program writes from
// the same board.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps: the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** One flag's value out of the arguments, in `--name value` or `--name=value` form, or the
 * fallback. A bare `--name` with a value after it wins over a `--name=value` earlier on the
 * line, and a bare `--name` with nothing after it falls through to the equals form. */
function flagValue(name: string, fallback: string): string {
  const key = `--${name}`;
  let equalsValue: string | undefined;
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i]!;
    if (a === key && i + 1 < process.argv.length) return process.argv[i + 1]!;
    if (equalsValue === undefined && a.startsWith(`${key}=`)) equalsValue = a.slice(key.length + 1);
  }
  return equalsValue ?? fallback;
}

/** The dossier options the scorer rebuilds with: one place, so --verify checks the same thing. */
function dossierOptions() {
  return {
    text_max_bytes: TEXT_MAX_BYTES,
    screenshots: SCREENSHOT_CAPS,
    dashboard: { max_files: 400, max_bytes: 4_194_304 },
  };
}

/** --verify re-reads what was written and rebuilds the dossier from it: the entry must be able
 * to prove its own dossier matches, the same comparison the scorer makes, before it is handed
 * in. True when the written dossier matches a rebuild. */
function verifyDossier(out: string): boolean {
  const rebuilt = buildDossier(out, dossierOptions());
  const written = readFileSync(join(out, 'dossier.json'));
  if (!Buffer.from(rebuilt).equals(written)) {
    process.stderr.write('token radar: --verify: dossier.json does not match a rebuild from the output\n');
    return false;
  }
  process.stdout.write(`token radar: --verify: dossier.json matches a rebuild (${written.length} bytes)\n`);
  return true;
}

/** The top five rows as one line each, for the run summary. */
function topLines(board: Array<{ rank: number; slug: string; implied_value_usd: number }>): string {
  return board
    .slice(0, 5)
    .map((r) => `  #${r.rank} ${r.slug} $${r.implied_value_usd.toLocaleString('en-US')}`)
    .join('\n');
}

/** Copy one directory's regular files into `to`, skipping names that start with a dot, and
 * return the names copied. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const inputArg = flagValue('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = flagValue('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
const dossierBytes = buildDossier(out, dossierOptions());
writeFileSync(join(out, 'dossier.json'), dossierBytes);

if (process.argv.includes('--verify') && !verifyDossier(out)) {
  process.exit(1);
}

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: top 5 by implied value:\n${topLines(board)}\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (3 files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
