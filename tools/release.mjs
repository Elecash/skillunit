// Works out and makes a release of `skillunit` with Nx Release (see `release` in nx.json and
// RELEASING.md). Run by .github/workflows/release.yml:
//
//   node tools/release.mjs --type stable|rc|beta|alpha [--dry-run]
//
// It prints what it does, and the same goes to the job summary: the current version and the tag
// it comes from, the commits it counts and the ones it ignores, the version it releases and the
// changelog entry. The version lives in the git tag: packages/skillunit/package.json says 0.0.0
// in git, and the script writes the version into it for the build and the publish, in a dry run
// too, without committing it. Nx then writes CHANGELOG.md, commits it, tags `v<version>`, pushes
// and creates the GitHub release; with --dry-run it commits, tags, pushes and releases nothing.
// Publishing to npm is the workflow's next step: this script tells it whether to publish, which
// version, and the npm tag, through $GITHUB_OUTPUT.
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { releaseChangelog, releaseVersion } from 'nx/release';
// The logic `nx affected` uses, which Nx Release also uses to decide which commits count. These
// are Nx's own modules, not its documented API; npm ci installs the version in package-lock.json.
import { createProjectGraphAsync } from 'nx/src/devkit-exports.js';
import { filterAffected } from 'nx/src/project-graph/affected/affected-project-graph.js';
import { calculateFileChanges } from 'nx/src/project-graph/file-utils.js';

const PROJECT = 'skillunit';
const PACKAGE = 'packages/skillunit/package.json';
const TYPES = ['stable', 'rc', 'beta', 'alpha'];

const argv = process.argv.slice(2);
const type = argv[argv.indexOf('--type') + 1];
const dryRun = argv.includes('--dry-run');
if (!argv.includes('--type') || !TYPES.includes(type)) fail(`--type is one of ${TYPES.join(', ')}`);

const summary = [];
const say = (line = '') => {
  console.log(line);
  summary.push(line);
};
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const isPrerelease = (version) => version.includes('-');
const { name } = JSON.parse(readFileSync(PACKAGE, 'utf8'));

say(`## Release of ${name}: ${type}${dryRun ? ', dry run' : ''}`);
say();

const last = git('describe', '--tags', '--abbrev=0', '--match', 'v*');
const current = last.slice(1);
say(`Current version: **${current}**, from the git tag \`${last}\` (${git('rev-parse', '--short', `${last}^{commit}`)}).`);
say();

// A run that pushed its tag and stopped before publishing left a tag with no package. Publish
// that version from its tag: `main` may have moved since.
if (!published(name, current)) {
  say(`${name}@${current} is not on npm: a run tagged \`${last}\` and stopped before publishing.`);
  say(`Nothing to version. ${dryRun ? 'Would publish' : 'Publishing'} ${current} from \`${last}\`, with the npm tag \`${npmTag(current)}\`.`);
  const lockChanged = spawnSync('git', ['diff', '--quiet', 'HEAD', last, '--', 'package-lock.json']).status !== 0;
  git('checkout', '--detach', last);
  if (lockChanged) run('npm', ['ci']);
  writeVersion(current);
  run('npx', ['nx', 'build', PROJECT, '--skip-nx-cache']);
  done({ publish: true, version: current });
}

// The commits since that tag, read the way conventional commits are: `type(scope)!: subject`.
// Below 1.0, Nx makes each bump one step smaller (adjustSemverBumpsForZeroMajorVersion). A
// commit counts only if it changes a file of the package or one it ships (`shipped` in
// packages/skillunit/package.json), as Nx decides it.
const zero = current.startsWith('0.');
const bumps = { feat: zero ? 'patch' : 'minor', fix: 'patch' };
const graph = await createProjectGraphAsync({ exitOnError: true });
const counted = [];
const ignored = [];
for (const entry of git('log', '--format=%h%x1f%s%x1f%b%x1e', `${last}..HEAD`).split('\x1e').filter((e) => e.trim())) {
  const [sha, subject, body] = entry.trim().split('\x1f');
  const m = /^(\w+)(?:\([^)]*\))?(!)?: \S/.exec(subject);
  const breaking = Boolean(m?.[2]) || body.includes('BREAKING CHANGE:');
  const bump = breaking ? (zero ? 'minor' : 'major') : m ? bumps[m[1]] : undefined;
  if (!m) ignored.push(`- \`${sha}\` ${subject}: not a conventional commit`);
  else if (!bump) ignored.push(`- \`${sha}\` ${subject}: \`${m[1]}\` does not change the version`);
  else if (!(await touchesPackage(sha))) ignored.push(`- \`${sha}\` ${subject}: changes neither the package nor a file it ships`);
  else counted.push(`- \`${sha}\` ${subject}: ${bump}${breaking ? ' (breaking)' : ''}`);
}
say(`Commits since \`${last}\` that count (${counted.length}):`);
say(counted.length ? counted.join('\n') : '- none');
say();
say(`Commits it ignores (${ignored.length}):`);
say(ignored.length ? ignored.join('\n') : '- none');
say();

// A prerelease keeps its line (0.1.1-rc.0, then rc.1). Leaving one for a stable version takes
// an explicit version: Nx keeps a prerelease a prerelease otherwise.
const options = { dryRun, verbose: false, stageChanges: false };
if (type !== 'stable') options.preid = type;
else if (isPrerelease(current)) options.specifier = current.replace(/-.*$/, '');

const { workspaceVersion, projectsVersionData, releaseGraph } = await releaseVersion(options);
if (!workspaceVersion) {
  if (counted.length) fail(`${counted.length} commit(s) above count, and Nx found nothing to release: the two disagree`);
  say('**Nothing to release**: no commit since the last tag changes the version.');
  done({ publish: false });
}
say(`Version it ${dryRun ? 'would release' : 'releases'}: **${workspaceVersion}**, npm tag \`${npmTag(workspaceVersion)}\`.`);
say();

// Nx has written the version into package.json, unstaged, so the release commit carries only
// CHANGELOG.md. A dry run writes nothing: write it here, so the build and `npm publish
// --dry-run` see the version a real run would publish.
writeVersion(workspaceVersion);
run('npx', ['nx', 'build', PROJECT, '--skip-nx-cache']);

const changelog = await releaseChangelog({ version: workspaceVersion, versionData: projectsVersionData, releaseGraph, dryRun, verbose: false });
say(`Changelog entry ${dryRun ? 'it would write' : 'written'} to CHANGELOG.md, and the GitHub release notes:`);
say();
say(changelog.workspaceChangelog?.contents?.trim() || '(empty)');
say();
if (dryRun) say('Dry run: nothing was committed, tagged, pushed or released.');
done({ publish: true, version: workspaceVersion });

/** Writes the summary and the step outputs, and ends the run. */
function done({ publish, version }) {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary.join('\n')}\n`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `publish=${publish}\n${version ? `version=${version}\nnpm-tag=${npmTag(version)}\n` : ''}`);
  }
  process.exit(0);
}

function npmTag(version) {
  return isPrerelease(version) ? 'next' : 'latest';
}

/** Whether the commit changes a file of the package, as `nx affected` sees it. */
async function touchesPackage(sha) {
  const files = git('diff-tree', '--no-commit-id', '--name-only', '-r', '--root', sha).split('\n').filter(Boolean);
  const affected = await filterAffected(graph, calculateFileChanges(files, { base: `${sha}^`, head: sha }), undefined, undefined, false);
  return PROJECT in affected.nodes;
}

/** Whether `pkg@version` is on npm. Only a 404 means it is not; any other failure stops the run. */
function published(pkg, version) {
  const result = spawnSync('npm', ['view', `${pkg}@${version}`, 'version', '--json'], { encoding: 'utf8' });
  let out;
  try {
    out = JSON.parse(result.stdout);
  } catch {
    out = undefined;
  }
  if (result.status === 0 && out === version) return true;
  if (result.status !== 0 && out?.error?.code === 'E404') return false;
  const said = out?.error ? `${out.error.code}: ${out.error.summary}` : (result.stderr || result.stdout).trim().split('\n').slice(0, 5).join('\n');
  fail(`could not ask npm whether ${pkg}@${version} is published (npm view exited ${result.status})\n${said}`);
}

/** Writes the version into the package's package.json, which says 0.0.0 in git. */
function writeVersion(version) {
  const text = readFileSync(PACKAGE, 'utf8');
  const next = text.replace(/("version":\s*")[^"]*(")/, `$1${version}$2`);
  if (next !== text) writeFileSync(PACKAGE, next);
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.status !== 0) fail(`${command} ${args.join(' ')} failed`);
}

function fail(message) {
  console.error(`release: ${message}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${[...summary, '', `**Stopped**: ${message}`].join('\n')}\n`);
  process.exit(1);
}
