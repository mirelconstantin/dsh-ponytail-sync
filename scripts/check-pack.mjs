/**
 * Check that the tarball npm would publish carries every file the plugin needs.
 *
 * A `files` entry that stops matching its tree is a package that installs and then
 * fails to load, and nothing else in CI would notice: the tests run against the
 * repository, not against the published subset.
 *
 * @module dsh-ponytail-sync/check-pack
 */

import { execFile as execFileCallback } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { resolveNpmCli } from './npm-cli.mjs'

const execFile = promisify(execFileCallback)

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Every file the installed package must contain for the plugin to load.
 *
 * @type {readonly string[]}
 */
export const REQUIRED_FILES = Object.freeze([
  'package.json',
  'cordis.patch.yml',
  'src/index.js',
  'src/entry-skill.js',
  'src/entry-prompt.js',
  'src/entry-command.js',
  'assets/ponytail/SKILL.md',
  'icon.svg',
  'LICENSE',
  'NOTICE',
  'README.md',
])

/**
 * Read the file list npm would publish.
 *
 * Runs npm through the Node binary that owns it: `npm` resolves through the
 * `.cmd` shim on Windows, which a spawned process cannot find by bare name.
 *
 * @returns {Promise<{ entryCount: number, unpackedSize: number, files: string[] }>}
 *   the pack manifest npm reported.
 */
export async function readPackManifest () {
  const npmCli = resolveNpmCli()
  const { stdout } = await execFile(process.execPath, [npmCli, 'pack', '--dry-run', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
  const [pack] = JSON.parse(stdout)
  return {
    entryCount: pack.entryCount,
    unpackedSize: pack.unpackedSize,
    files: pack.files.map((entry) => entry.path),
  }
}

/**
 * Report which required files the tarball is missing.
 *
 * @param {string[]} published - the paths npm would include.
 * @returns {string[]} the missing paths; empty when the tarball is complete.
 */
export function missingFromPack (published) {
  const have = new Set(published)
  return REQUIRED_FILES.filter((entry) => !have.has(entry))
}

// Only run when invoked directly, so the module stays importable from tests.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const pack = await readPackManifest()
  const missing = missingFromPack(pack.files)
  if (missing.length > 0) {
    process.stderr.write('dsh-ponytail-sync: npm would not publish every file the plugin needs:\n')
    for (const entry of missing) process.stderr.write(`  ${entry}\n`)
    process.exitCode = 1
  } else {
    process.stdout.write(`dsh-ponytail-sync: npm would publish ${pack.entryCount} files (${Math.round(pack.unpackedSize / 1024)} kB), every entry point included.\n`)
  }
}