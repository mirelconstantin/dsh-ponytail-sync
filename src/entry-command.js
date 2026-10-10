/**
 * Loader entry that registers the six ponytail slash commands.
 *
 * Kept separate from the runtime row so a configuration reload of the level
 * default does not unregister the commands mid-session.
 *
 * @module dsh-ponytail-sync/entry-command
 */

import { SERVICE } from './runtime.js'
import { registerPonytailCommands } from './commands.js'

/** Loader identity. */
export const name = 'dsh-ponytail-sync-command'

/** Required services: the command registry and our own runtime. */
export const inject = ['commands', SERVICE]

/**
 * Register every ponytail command.
 *
 * @param {any} ctx - Cordis context.
 * @returns {void} nothing.
 */
export function apply (ctx) {
  const runtime = ctx.get(SERVICE)
  registerPonytailCommands(ctx, runtime)
}
