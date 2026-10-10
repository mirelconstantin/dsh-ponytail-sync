<p align="center">
  <img src="https://raw.githubusercontent.com/pazalo/.github/main/assets/pazalo-logo.png" width="112" alt="Pazalo">
</p>

<h1 align="center">dsh-ponytail-sync</h1>

<p align="center">
  Ponytail lazy-senior-dev mode as a native DeepSeek Harness skill, system-prompt section and six slash commands.
  Always available, level-switchable, no external process.
</p>

<p align="center">
  <img src="https://img.shields.io/npm/v/dsh-ponytail-sync-FFC24D?style=flat-square&logo=npm&logoColor=black" alt="npm version">
  <img src="https://img.shields.io/npm/dw/dsh-ponytail-sync-F0522C?style=flat-square&logo=npm&logoColor=white" alt="npm downloads">
  <img src="https://img.shields.io/badge/Node-%3E%3D22.19-FFC24D?style=flat-square&logo=node&logoColor=black" alt="Node">
  <img src="https://img.shields.io/badge/Tests-49-FFC24D?style=flat-square" alt="Tests">
  <img src="https://img.shields.io/badge/Licence-MIT-F0522C?style=flat-square" alt="Licence">
</p>

## Install

From the GUI, paste this into **Add plugin**:

```
dsh-ponytail-sync
```

Or from a terminal:

```bash
dsh plugin add dsh-ponytail-sync
```

That is a plain npm install. It needs neither git nor a GitHub account.

No build step is involved, so nothing needs a build allowlist and every entry
point ships as committed source. Restart the profile and four rows appear — the
runtime, the skill, the prompt section and the commands.

<details>
<summary>Other routes</summary>

| Route | Command |
| --- | --- |
| Pinned to a version | `dsh plugin add dsh-ponytail-sync@1.0.0` |
| Pinned to a commit | `dsh plugin add github:mirelconstantin/dsh-ponytail-sync#<sha>` |
| Tarball | `dsh plugin add ./dsh-ponytail-sync-1.0.0.tgz` |
| Local checkout | `dsh plugin add /absolute/path/to/dsh-ponytail-sync` |

The GitHub routes need nothing but git access to this repository. The npm route
needs neither git nor an account, and is what the command above uses.

</details>

---

## What it is

[Ponytail](https://github.com/DietrichGebert/ponytail) by Dietrich Gebert, MIT licensed. It is one instruction
prompt plus a handful of one-shot command prompts; everything else in that repository is plumbing that loads the
prompt into a particular agent. This bundle ships the prompt into DeepSeek Harness as a **skill** and as a
**system-prompt section**, so it is present in every session without anyone installing a plugin.

Upstream is the source of truth for the rules. This bundle vendors **upstream ponytail 5.1.0** with the review,
audit and ledger procedures folded in from the three upstream command skills, and
`scripts/check-plugin.mjs` pins the same ten rule invariants upstream's own `scripts/check-rule-copies.js`
pins — so a silent upstream rule change cannot pass unnoticed.

## Why a skill and not an AGENTS.md file

`dsh-agent-instructions` already loads `~/.dsh/AGENTS.md` into every session, and a compact copy of the rules
there would work. Three things make the skill the better home:

- **It is loadable on demand.** A `user-agents` copy at rank 500 competes with the per-project file; a runtime
  registration at rank 250 lets a project's own `ponytail` skill override it, which is the behaviour a user
  editing one repository expects.
- **It carries a description that routes it.** The catalog shows the description to the model before it loads
  anything, so the model knows when the mode applies instead of seeing an unconditional block of rules.
- **It is inspectable and editable.** `assets/ponytail/SKILL.md` is one file a maintainer can read and edit;
  editing it changes what the next session sees after a plugin reload. (The prompt section is not generated from
  it — the section is deliberately short, and carries the level rather than the rules.)

## What it gives a model

A `ponytail` skill and a `ponytail` system-prompt section. The section states the active level, what the level
changes, and the two lines every reply owes the user. The skill body is the full ruleset with the level tables.

## Levels

| Level | Behaviour |
|---|---|
| `lite` | Build what was asked, name the smaller option in one line |
| `full` | The complete ruleset (default) |
| `ultra` | Also question the request before building |

The default for **new sessions** is `cordis.patch.yml`'s `ponytail-runtime.config.defaultLevel`. A session that
changes level keeps that level for the rest of the session, which is what upstream's session-scoped mode does.
Changing the default for new sessions is a patch-file edit, not a live Settings row: this bundle ships a plain
Standard Schema config, and only a native Schemastery schema renders a Settings form. A plugin must not import
`@deepseek-ai/schemastery` itself, so the row reports `unsupported` rather than failing the load.

## Commands

| Command | What it does |
|---|---|
| `/ponytail [lite\|full\|ultra\|off]` | Set the level for this session, or report it with no argument |
| `/ponytail-review` | Review the current change: bugs, security, load, missing tests, speed, what to cut |
| `/ponytail-audit` | The same review for the whole repository, ranked |
| `/ponytail-debt` | Harvest `shortcut:` comments into a ledger |
| `/ponytail-gain` | The measured-impact scoreboard |
| `/ponytail-help` | Quick reference card |

## Files

```
package.json        the package and its dsh bundle declaration
cordis.patch.yml    the four loader rows
src/index.js        the service entry (provides `ponytail`)
src/config.js       the Config schema, defaults, resolution, level helpers
src/util.js         the config validator and clamping helpers
src/runtime.js      the per-session level and the section text renderer
src/prompt.js       the system-prompt section text and the visibility gate
src/skills.js       the runtime skill registration
src/commands.js     the six slash commands and their one-shot instructions
src/entry-prompt.js the prompt row
src/entry-skill.js  the skill row
src/entry-command.js the command row
assets/ponytail/SKILL.md the vendored ponytail skill body
scripts/check-plugin.mjs  the plugin contract, against a fake context
```

## Enabling it in a profile

The plugin is a bundle: `package.json` declares `dsh.bundle.patch`, and the profile lists it in both
`dependencies` and `dsh.profile.bundles`. `dsh plugin add` does both edits for you.

```jsonc
// profiles/<name>/package.json
"dependencies": { "dsh-ponytail-sync": "1.0.0" },
"dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "dsh-ponytail-sync"] } }
```

A checkout can be linked instead, with the bundle name and the directory left as whatever they are:

```jsonc
"dependencies": { "dsh-ponytail-sync": "link:/absolute/path/to/dsh-ponytail-sync" },
"dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "dsh-ponytail-sync"] } }
```

Then **restart DSH once** before it resolves. Editing `package.json` while DSH is running does not make the bundle
resolvable: `dsh-app-boot`'s `resolveBundleDir` probes the `node_modules` lookup order from the installation
anchor and the profile directory, and a running host holds the profile manifest it read at launch. Until the link
exists, adding the bundle produces exactly:

```
dsh: cannot resolve profile bundle "dsh-ponytail-sync" from the dsh installation or <profileDir>;
run 'dsh plugin --profile <name> install' if its dependency is not installed
```

That install command materialises the link; the restart makes the running host read the new manifest. Do both,
then hard-refresh the browser (`Ctrl + Shift + R`).

To turn the mode off without removing the bundle, set `defaultLevel: off` in the `ponytail-runtime` row's config —
the skill, the section and the commands stay mounted, and the rules become available on demand through the `skill`
tool.

## Verifying it

```sh
npm test                    # the plugin contract: levels, section, skills, commands, packaging
node scripts/check-patch.mjs   # the bundle patch, exports and icon match the package
node scripts/check-pack.mjs    # npm would publish every file the plugin needs
```

The check asserts what a harness does at load time that a hand-mounted test cannot: no default export (the
loader unwraps `.default` in preference to the namespace, which silently drops `inject`, `name` and `Config` and
leaves every dependent row pending), that the registrations are effects, that the section suppresses itself when
the skill registry is absent or a restriction filtered the skill away, that the level is per session and the
budget is actually applied, that all six commands register with a description and a non-empty hint, and that the
load-bearing upstream rules survive verbatim in the vendored skill body.

`check-pack` covers a gap the tests cannot: they run against the repository, while a `files` entry that stops
matching its tree would publish a package that installs and then fails to load.

CI runs the tests and both package checks on **Linux and Windows** on every push and pull request.

## Updating from upstream

Vendor `skills/ponytail/SKILL.md` into `assets/ponytail/SKILL.md`, fold in any new upstream command skill you
want available, then re-run `npm test`. It fails when an upstream rule the check pins has moved, which is the
prompt to re-read the upstream diff rather than to edit the pinned list.

## License

This bundle is MIT — see [LICENSE](LICENSE). Ponytail is MIT, © Dietrich Gebert, and is vendored here as
instruction text with its attribution and upstream reference intact; [NOTICE](NOTICE) carries that attribution.
`icon.svg` is the Pazalo mark.
