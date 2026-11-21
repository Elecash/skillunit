# Releasing

SkillUnit is published to npm as `skillunit`, from `packages/skillunit`. A release is a run of
the [`release` workflow](.github/workflows/release.yml), started by hand from the Actions tab
on `main`. [Nx Release](https://nx.dev/docs/guides/nx-release) works out the version from the
commits since the last tag, writes `CHANGELOG.md`, commits it with the new version
(`chore(release): publish <version>`), tags `v<version>`, pushes to `main` and creates the
GitHub release; then npm publishes through
[trusted publishing](https://docs.npmjs.com/trusted-publishers), with no token. Nobody bumps a
version or tags by hand.

The version lives in the git tag. `packages/skillunit/package.json` says `0.0.0` in git, and
the release commit holds only `CHANGELOG.md`. The workflow writes the version into
`package.json` for the build and the publish, and does not commit it. A local build says
`0.0.0` to `skillunit --version`.

## Commits

The version comes from the commit messages, so they follow
[Conventional Commits](https://www.conventionalcommits.org): `type: what changed`, with an
optional scope, `fix(lint): …`. Below 1.0, each bump is one step smaller than in SemVer:

| Commit | Version below 1.0 | From 1.0 on |
| --- | --- | --- |
| `fix: …` | patch, 0.1.0 → 0.1.1 | patch |
| `feat: …` | patch, 0.1.0 → 0.1.1 | minor |
| `feat!: …`, or `BREAKING CHANGE:` in the body | minor, 0.1.0 → 0.2.0 | major |
| `docs`, `chore`, `refactor`, `test`, `ci`, `build`, `perf`, `style`, `revert` | nothing | nothing |
| a plain sentence, such as `Fix parser` | nothing, and left out of the changelog | nothing |

That is Nx's `adjustSemverBumpsForZeroMajorVersion`, on by default. A commit counts only if it
changes a file of the package: something under `packages/skillunit/`, or a file the package
ships from the root, `README.md`, `LICENSE`, `docs/` and `skills/skillunit/` (the `shipped`
inputs in `packages/skillunit/package.json`). A `fix:` that changes only `.github/`, `specs/`,
`tools/` or `apps/` releases nothing, and the run lists it among the commits it ignores, with
that reason. Nx decides this the way `nx affected` does, and the run's list uses the same code;
if the list has commits that count and Nx finds nothing to release, the run stops and says so.

`CHANGELOG.md` is the workspace's, though: its entry lists every conventional commit since the
last release, whatever it changed. A `fix:` that changes only `.github/` or `tools/` gives no
release, and still shows up as a fix in the next one. Type those `ci:` or `chore:`.

### Pull requests

`main` gets one commit per pull request, a squash merge, and only the title box of the merge
dialog reaches it: the commits of the branch do not. So the title of the pull request is the
commit the release reads, and the
[`pr-title` workflow](.github/workflows/pr-title.yml) fails a pull request whose title is not
`type(scope)!: subject` with one of the types above. The repository setting "Default to pull
request title" for squash merges fills the box with that title; it is set on GitHub, under
Settings → General → Pull Requests, not in the repository. A title edited in the dialog
reaches `main` as it is typed.

## A release

1. **Run it with `dry-run` on**, the default. Pick the `release-type`: `stable`, or `rc`,
   `beta` or `alpha` for a prerelease. The job summary, and the log, say the current version
   and the tag it comes from, the commits that count and the ones ignored, the version it
   would release and the npm tag, and the changelog entry. Nothing is committed, pushed,
   released or published. The run still writes the version into `package.json`, builds, and
   runs `npm publish --dry-run`, which shows the tarball and the version it carries.
2. **Run it again with `dry-run` off.** It checks, builds and tests first, then versions,
   commits, tags, pushes, creates the GitHub release and publishes.

A `stable` release goes to the npm tag `latest`. A prerelease, such as `0.1.1-rc.0`, goes to
`next`, and its GitHub release is marked as one; the next `rc` run makes `0.1.1-rc.1`. A
`stable` run after a prerelease releases its version, `0.1.1`, and its changelog entry lists
every commit since the last stable release, the prerelease ones included.

The workflow refuses any branch but `main`. It pushes to `main` with the job's `GITHUB_TOKEN`,
which works while `main` has no rule against direct pushes (it has none today).

## When a run fails

The push and the GitHub release come before `npm publish`, so a run that fails to publish
leaves a tag and a release with no package. Run the workflow again: when the version of the
last `v*` tag is not on npm, it skips the version step, checks that tag out (`main` may have
moved since), writes its version into `package.json`, builds and publishes it.

Only npm's "not found" (`E404`) counts as not on npm. If npm cannot be asked, because the
registry is down or answers with another error, the run stops and prints what npm said.

## The trusted publisher

It was set up on npmjs.com on 2026-11-21 for this repository and `release.yml`. A trusted
publisher that does not publish within two days expires, and has to be deleted and added
again. A mistake in its settings shows on the first real publish: a dry run uploads nothing, and
npm does not document whether it rejects a wrong setting. If that first publish fails, the
commit, the tag and the GitHub release are already there, and `npm publish` by hand from
the tag still works. Set the version for that one publish, and do not commit it; add
`--tag next` to `npm publish` for a prerelease:

```sh
git checkout v0.1.1
npm ci
cd packages/skillunit
npm pkg set version=0.1.1
npm publish
git checkout -- package.json
```

After the first release through the workflow, set the package's publishing access on npmjs.com
to "Require two-factor authentication and disallow tokens". Trusted publishing keeps working,
because it does not use a token.
