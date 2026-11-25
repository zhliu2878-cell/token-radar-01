// token-radar-01 entry: build a ranked token-launch radar from a sealed snapshot.
//
// Reads the protocol snapshot, scores every pre-token protocol with the
// model in lib/model.ts, and writes everything the judge needs into the
// output directory: the ranked board, the dashboard's data, the dashboard
// itself, its three screenshots, and the dossier the judge reads.
//
//   node main.ts [--input <snapshot.json|dir>] [--output <dir>]
//
// Inside the grader the snapshot lives at /input and the output at /output.
// Outside it, pass --input for the snapshot and set MAKEFUN_OUTPUT_DIR (or
// --output) for a scratch directory, e.g.:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input kit/input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

// The scorer's own caps, from the kit's reference/gate.json. The text cap
// shapes how much dashboard source the dossier carries; the rest refuse.
const DOSSIER_TEXT_MAX_BYTES = 65_536;
const DOSSIER_SCREENSHOT_MAX = 4;
const DOSSIER_SCREENSHOT_MAX_BYTES = 524_288;
const DASHBOARD_MAX_FILES = 400;
const DASHBOARD_MAX_BYTES = 4_194_304;
const MIN_SCREENSHOTS = 3;

// Screenshot names: letters, digits and . _ -, 1 to 128 characters, and the
// first character may not be a dot or a dash.
const SHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** Print an error and stop with the given exit code. */
function fail(message: string, code: number): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(code);
}

/** The value of `--name <value>` or `--name=<value>`, or the fallback. */
function flag(name: string, fallback: string): string {
  const argv = process.argv;
  const at = argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < argv.length) return argv[at + 1]!;
  const glued = argv.find((a) => a.startsWith(`--${name}=`));
  return glued === undefined ? fallback : glued.slice(name.length + 3);
}

/** The snapshot file for an --input that is a file or a directory. */
function snapshotPath(input: string): string {
  return input.endsWith('.json') ? input : join(input, 'snapshot.json');
}

/** The dashboard and the screenshots, each into its own output directory. */
function mirror(sourceDir: string, destDir: string): string[] {
  if (!existsSync(sourceDir)) return [];
  mkdirSync(destDir, { recursive: true });
  const names: string[] = [];
  for (const name of readdirSync(sourceDir)) {
    if (name.startsWith('.')) continue;
    const from = join(sourceDir, name);
    if (!statSync(from).isFile()) continue;
    copyFileSync(from, join(destDir, name));
    names.push(name);
  }
  return names;
}

/** Every screenshot name must fit the scorer's rule. */
function checkShotNames(names: string[]): void {
  for (const name of names) {
    if (!SHOT_NAME.test(name)) {
      fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`, 1);
    }
  }
}

function main(): void {
  const input = flag('input', '/input');
  const file = snapshotPath(input);
  if (!existsSync(file)) {
    fail(`no snapshot at ${file}: pass --input <snapshot.json|directory> or mount the sealed /input`, 2);
  }
  const out = flag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

  const snapshot = parseSnapshot(readFileSync(file, 'utf8'));
  const { board, radar } = buildRadar(snapshot);
  const problem = boardIssue(board, snapshot);
  if (problem !== null) {
    fail(`the model wrote a board the gate refuses: ${problem}`, 1);
  }

  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
  writeFileSync(join(out, 'data.js'), dataScript(radar));

  mirror(join(here, 'dashboard'), join(out, 'dashboard'));
  const shots = mirror(join(here, 'screenshots'), join(out, 'screenshots'));
  if (shots.length < MIN_SCREENSHOTS) {
    fail(`screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view`, 1);
  }
  checkShotNames(shots);

  // The dossier is written last: the scorer rebuilds it from this /output
  // and compares bytes, so it must see the finished dashboard and shots.
  writeFileSync(
    join(out, 'dossier.json'),
    buildDossier(out, {
      text_max_bytes: DOSSIER_TEXT_MAX_BYTES,
      screenshots: { max: DOSSIER_SCREENSHOT_MAX, max_bytes: DOSSIER_SCREENSHOT_MAX_BYTES },
      dashboard: { max_files: DASHBOARD_MAX_FILES, max_bytes: DASHBOARD_MAX_BYTES },
    }),
  );

  process.stdout.write(
    `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
      `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (3 files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
  );
}

main();
