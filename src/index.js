/**
 * Plugin entry: mount the `ponytail` service.
 *
 * The service owns the configuration and the per-session level, and is what the
 * prompt, skill and command rows inject. It is a separate row from each of them
 * so a configuration reload of one does not take the others — and their state —
 * down with it.
 *
 * `skills` and `commands` are deliberately NOT injected here. The prompt row
 * resolves the skill registry with `ctx.get('skills')` at prompt-assembly time,
 * which is on a different fiber than this plugin's; declaring it here would make
 * the service pend until the registry is ready for a dependency it does not
 * itself use, and a direct `ctx.skills` property read in that closure is the
 * trap recorded in `docs/postmortem/0001-acp-default-export-drops-inject.md` —
 * the property proxy's ancestor-only fiber walk can throw `cannot get property
 * "skills" without inject` through a traceable shadow. `ctx.get` is the
 * topology-independent lookup and returns `undefined` while a service is absent
 * or loading, which is the correct answer for a visibility check.
 *
 * No default export: the loader unwraps a default export in preference to the
 * namespace, which silently drops `inject`, `name` and `Config` and leaves every
 * dependent row pending forever.
 *
 * @module dsh-ponytail-sync
 */

import { ConfigSchema as Config, describeConfig, resolveConfig } from './config.js'
import { PonytailRuntime, SERVICE } from './runtime.js'

/** Plugin identity. */
export const name = 'dsh-ponytail-sync'

/**
 * Required services.
 *
 * Empty on purpose: the service publishes itself and reads no optional seam, so
 * injecting anything here would gate the whole surface on a dependency only one
 * of the three rows needs.
 *
 * @type {string[]}
 */
export const inject = []

/**
 * Plugin configuration, for the Settings UI and the loader.
 *
 * The Standard Schema form, which is what the harness resolves configuration
 * through. Kept as a plain schema rather than a native Schemastery one because
 * this plugin resolves `@deepseek-ai/schemastery` through its peer only inside
 * the harness; a plugin must not import it itself. Both validate identically.
 *
 * @type {{ '~standard': { version: number, vendor: string, validate: Function } }}
 */
export { Config }

/**
 * Mount the runtime.
 *
 * Returns nothing on purpose: Cordis reads whatever a plugin body returns as an
 * effect, and a runtime object is neither a disposer nor a promise.
 *
 * @param {any} ctx - Cordis context.
 * @param {Record<string, any>} [rawConfig] - the validated plugin configuration.
 * @returns {void} nothing.
 */
export function apply (ctx, rawConfig = {}) {
  const config = resolveConfig(rawConfig)
  const logger = typeof ctx.logger === 'function' ? ctx.logger(name) : null
  const log = (message) => {
    // Logging must not be able to fail the load: without a Cordis logger this
    // falls through to `process.stderr.write`, which throws EPIPE once the host
    // has closed the stream, and the rejection that follows takes the harness
    // down over one line of diagnostics.
    try {
      if (logger) logger.info(message)
      else process.stderr.write(`[${name}] ${message}\n`)
    } catch {
      /* the log sink is gone; there is nothing left to report it to */
    }
  }

  ctx.effect(() => ctx.provide(SERVICE, PonytailRuntime({ ctx, config, log })), `ctx.provide(${SERVICE})`)
  log(describeConfig(config))
}

export { PonytailRuntime, SERVICE }
