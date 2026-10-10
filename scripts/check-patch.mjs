/**
 * Check the bundle patch, exports and icon against what the package ships.
 *
 * The bundle patch is what a profile loads, and nothing in the harness
 * type-checks it against the files it names. A row whose `name` points at a
 * moved module therefore fails only at load time, on someone's machine, as a
 * row that never activates with no error. This is the gate that catches it
 * instead.
 *
 * It verifies, without a YAML parser dependency:
 *   - every relative `name:` in the patch resolves to a file that exists
 *   - every external module the patch names is declared in the manifest
 *   - every module in `package.json` `exports` exists
 *   - every entry in `package.json` `files` exists
 *   - the declared icon is a real, self-contained image that ships
 *
 * @module dsh-ponytail-sync/check-patch
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** The largest icon the panel will render, from the harness package guide. */
const MAX_ICON_BYTES = 262144

/**
 * Every `name:` value in the patch that points at a file inside this package.
 *
 * @param {string} patch - the patch file contents.
 * @returns {string[]} the relative module paths.
 */
export function localModuleNames (patch) {
  return [...patch.matchAll(/^\s*name:\s*'(\.[^']+)'\s*$/gm)].map((match) => match[1])
}

/**
 * Every `name:` value in the patch that names an external harness package.
 *
 * @param {string} patch - the patch file contents.
 * @returns {string[]} the package names.
 */
export function externalModuleNames (patch) {
  return [...patch.matchAll(/^\s*name:\s*'(@[^']+)'\s*$/gm)].map((match) => match[1])
}

/**
 * Check the declared icon against the rules the plugin panel applies.
 *
 * A manifest icon is read without activating the plugin, so a wrong or missing
 * file is not a load failure: the row silently falls back to the panel's default
 * artwork. That is exactly the failure nobody notices, so it is checked here.
 *
 * @param {any} manifest - the parsed package.json.
 * @returns {string[]} one line per problem; empty when the icon is valid.
 */
export function checkIcon (manifest) {
  const problems = []
  const icon = manifest.icon
  if (icon === undefined) return problems

  if (typeof icon !== 'string' || icon === '') {
    problems.push('package.json icon must be a non-empty string')
    return problems
  }
  if (icon.startsWith('/') || /^[a-z]+:/i.test(icon)) {
    problems.push(`package.json icon ${icon} must be relative to the package, not absolute or a URL`)
    return problems
  }

  const extension = icon.slice(icon.lastIndexOf('.')).toLowerCase()
  if (!['.svg', '.png', '.jpg', '.jpeg', '.webp'].includes(extension)) {
    problems.push(`package.json icon ${icon} is not a supported image extension`)
  }

  const target = resolve(ROOT, icon)
  if (!existsSync(target)) {
    problems.push(`package.json icon ${icon} does not exist`)
    return problems
  }
  const bytes = statSync(target).size
  if (bytes > MAX_ICON_BYTES) {
    problems.push(`package.json icon ${icon} is ${bytes} bytes, over the 256 KiB limit`)
  }
  if (!(manifest.files ?? []).includes(icon.replace(/^\.\//, ''))) {
    problems.push(`package.json icon ${icon} is not listed in files, so it is not published`)
  }
  if (extension === '.svg' && !isSelfContainedSvg(target)) {
    problems.push(`package.json icon ${icon} is not self-contained; it must not reference outside resources`)
  }
  return problems
}

/**
 * Whether an SVG pulls in anything from outside its own file.
 *
 * The harness renders an icon as an image rather than as inline HTML, so a
 * `<script>`, a remote `href` or a CSS `url()` would be either stripped or
 * fetched at render time. An icon that depends on any of those is not one file.
 *
 * @param {string} target - the absolute SVG path.
 * @returns {boolean} true when the SVG references nothing external.
 */
function isSelfContainedSvg (target) {
  const source = readFileSync(target, 'utf8')
  if (/<script[\s>]/i.test(source)) return false
  if (/\b(?:xlink:)?href\s*=\s*["']?\s*(?:https?:|\/\/)/i.test(source)) return false
  if (/@import/i.test(source)) return false
  if (/url\(\s*["']?\s*(?:https?:|\/\/)/i.test(source)) return false
  if (/<image[\s>]/i.test(source)) return false
  return true
}

/**
 * Run every check and report the problems found.
 *
 * @returns {string[]} one line per problem; empty when the package is consistent.
 */
export function checkPatch () {
  const problems = []
  const patch = readFileSync(join(ROOT, 'cordis.patch.yml'), 'utf8')
  const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

  for (const name of localModuleNames(patch)) {
    if (!existsSync(resolve(ROOT, name))) {
      problems.push(`cordis.patch.yml inserts ${name}, which does not exist`)
    }
  }
  for (const name of externalModuleNames(patch)) {
    if (!manifest.peerDependencies?.[name] && !manifest.dependencies?.[name]) {
      problems.push(`cordis.patch.yml inserts ${name}, which the manifest does not declare`)
    }
  }
  for (const target of Object.values(manifest.exports ?? {})) {
    if (!existsSync(resolve(ROOT, target))) {
      problems.push(`package.json exports ${target}, which does not exist`)
    }
  }
  for (const entry of manifest.files ?? []) {
    if (!existsSync(resolve(ROOT, entry))) {
      problems.push(`package.json ships ${entry}, which does not exist`)
    }
  }

  // The rows the package exists to contribute. A profile that loads this bundle
  // and gets none of them is a bundle that silently does nothing.
  for (const required of ['entry-skill.js', 'entry-prompt.js', 'entry-command.js']) {
    if (!patch.includes(required)) problems.push(`cordis.patch.yml does not insert ${required}`)
  }

  problems.push(...checkIcon(manifest))
  return problems
}

// Only run when invoked directly, so the module stays importable from tests.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const problems = checkPatch()
  if (problems.length > 0) {
    process.stderr.write('dsh-ponytail-sync: the package is inconsistent\n')
    for (const problem of problems) process.stderr.write(`  ${problem}\n`)
    process.exitCode = 1
  } else {
    process.stdout.write('dsh-ponytail-sync: the bundle patch, exports and icon match the package.\n')
  }
}