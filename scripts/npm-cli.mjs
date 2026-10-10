/**
 * Finding npm's own entry point from a Node process.
 *
 * A spawned process cannot run `npm` by bare name on Windows, where it is a
 * `.cmd` shim, so the scripts here run npm as `node <npm-cli.js>` instead. That
 * needs the path of that file, and the layout is not the same on every platform:
 *
 *   - a Node installed from the official installer keeps npm inside its own
 *     prefix, at `<node>/node_modules/npm/bin/npm-cli.js`
 *   - a Node from a version manager (nvm, fnm, volta, asdf) points at a
 *     distribution whose npm is a sibling package, not a child of the binary,
 *     and GitHub Actions' `setup-node` uses that layout
 *
 * So both layouts are searched, and `npm_execpath` is honoured first because it
 * is set by npm itself when the current process was started by npm.
 *
 * @module dsh-ponytail-sync/npm-cli
 */

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Candidate locations for npm's CLI entry point, most reliable first.
 *
 * @returns {string[]} absolute paths to try.
 */
export function npmCliCandidates () {
  const here = dirname(process.execPath)
  const candidates = []
  // Set by npm itself when this process was started by `npm run`.
  if (process.env.npm_execpath) candidates.push(process.env.npm_execpath)
  candidates.push(
    join(here, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(dirname(here), 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  )
  return candidates
}

/**
 * Locate npm's CLI entry point.
 *
 * @returns {string} the absolute path to npm-cli.js.
 * @throws {Error} with the searched paths when none of them exists.
 */
export function resolveNpmCli () {
  const candidates = npmCliCandidates()
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate
  }
  throw new Error(
    `cannot find npm-cli.js; searched:\n${candidates.map((entry) => `  ${entry}`).join('\n')}\nRun this script through npm itself (npm test, npm run …).`,
  )
}

// Only run when invoked directly, so the path can be inspected on its own.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.stdout.write(`${resolveNpmCli()}\n`)
}