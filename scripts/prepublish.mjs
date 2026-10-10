/**
 * The gate that runs before every publish.
 *
 * A published version is permanent: npm will not let the same name and version
 * be used again even after an unpublish, so a broken or stale artifact is not a
 * thing to fix afterwards. This refuses the publish instead.
 *
 * It checks, in order:
 *   - every gate in CI, so a publish cannot differ from a green build
 *   - that the version in `package.json` is not already on the registry
 *   - that the working tree is committed, so the published artifact is exactly
 *     what the repository says it is
 *   - that the tag is pushed and points at HEAD
 *
 * `npm publish` runs this. `npm run prepublish` runs it without publishing,
 * which is how to check everything on its own.
 *
 * @module dsh-ponytail-sync/prepublish
 */

import { execFile as execFileCallback } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { resolveNpmCli } from './npm-cli.mjs'

const execFile = promisify(execFileCallback)

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const REGISTRY = 'https://registry.npmjs.org'

/**
 * Run a command and return its stdout.
 *
 * @param {string} command - the executable.
 * @param {string[]} args - its arguments.
 * @returns {Promise<string>} the stdout.
 */
async function run (command, args) {
  const { stdout } = await execFile(command, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  return stdout
}

/**
 * Run npm through the Node binary that owns it.
 *
 * @param {string[]} args - the npm arguments.
 * @returns {Promise<string>} the stdout.
 */
function npm (args) {
  return run(process.execPath, [resolveNpmCli(), ...args])
}

/**
 * Report whether a version of this package already exists on the registry.
 *
 * @param {string} name - the unscoped package name.
 * @param {string} version - the exact version.
 * @returns {Promise<boolean>} true when that name and version is taken.
 */
async function alreadyPublished (name, version) {
  try {
    await npm(['view', `${name}@${version}`, 'version', '--registry', REGISTRY])
    return true
  } catch {
    // A 404 is the answer we want: the version is free.
    return false
  }
}

/**
 * The version a failed publish should be bumped to.
 *
 * @param {string} version - the current version.
 * @returns {string} the next patch version.
 */
function nextVersion (version) {
  const [major, minor, patch] = version.split('.').map(Number)
  return `${major}.${minor}.${(patch ?? 0) + 1}`
}

/**
 * The git tag for a release version, or null when that tag does not exist yet.
 *
 * @param {string} version - the release version.
 * @returns {Promise<string | null>} the tag name, or null.
 */
async function tagForVersion (version) {
  const candidate = `v${version}`
  const tags = await run('git', ['tag', '--list', candidate])
  return tags.trim() === '' ? null : candidate
}

/**
 * Run every publish gate and report the first failure.
 *
 * @returns {Promise<string | null>} a human-readable problem, or null when clear.
 */
export async function checkPublishable () {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

  for (const [label, args] of [
    ['the behaviour tests', ['test']],
  ]) {
    try {
      await npm(args)
    } catch (error) {
      return `${label} failed:\n${error.stderr || error.stdout || error.message}`
    }
  }
  try {
    await run(process.execPath, ['scripts/check-patch.mjs'])
  } catch (error) {
    return `the package check failed:\n${error.stderr || error.stdout || error.message}`
  }
  try {
    await run(process.execPath, ['scripts/check-pack.mjs'])
  } catch (error) {
    return `the published file list is incomplete:\n${error.stderr || error.stdout || error.message}`
  }

  if (await alreadyPublished(manifest.name, manifest.version)) {
    return `${manifest.name}@${manifest.version} is already on the registry. A published name and version can never be reused, even after an unpublish, so bump the version instead:\n  npm version ${nextVersion(manifest.version)}`
  }

  const status = (await run('git', ['status', '--porcelain'])).trim()
  if (status !== '') {
    return `the working tree has uncommitted changes:\n${status}\nCommit them, or nothing that is published will match the repository.`
  }

  const head = (await run('git', ['rev-parse', 'HEAD'])).trim()
  const tag = await tagForVersion(manifest.version)
  if (tag !== null) {
    const tagged = (await run('git', ['rev-list', '-n', '1', tag])).trim()
    if (tagged !== head) {
      return `the ${tag} tag points at ${tagged.slice(0, 7)}, not at HEAD (${head.slice(0, 7)}).\nMove it, or the tag and the published version would describe different code:\n  git tag -f ${tag} ${head}\n  git push -f origin ${tag}`
    }
  }
  return null
}

// Only run when invoked directly, so the module stays importable from tests.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const problem = await checkPublishable()
  if (problem !== null) {
    process.stderr.write(`dsh-ponytail-sync cannot be published: ${problem}\n`)
    process.exitCode = 1
  } else {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
    process.stdout.write(`dsh-ponytail-sync ${manifest.version} is ready to publish.\n`)
  }
}