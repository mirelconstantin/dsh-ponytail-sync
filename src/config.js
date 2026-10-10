/**
 * Plugin configuration: the default level, the shape `cordis.patch.yml` may set,
 * and the one resolution step between "what the user wrote" and "what the
 * runtime reads".
 *
 * One rule shapes this module.
 *
 * **Validation rejects, resolution clamps.** A level outside the closed set is a
 * typo and fails the plugin load, because a silently ignored level would leave
 * the model operating under a mode the user believes they chose. A value that is
 * merely out of range — a section budget below the floor — is a preference, so it
 * is clamped in {@link resolveConfig} rather than refused, and `validate`
 * deliberately returns the raw value.
 *
 * The default level is deliberately a Config field rather than a constant in the
 * source, so a deployment that wants `off` by default sets it in its patch file
 * instead of carrying a local edit to `src/`.
 *
 * @module dsh-ponytail-sync/config
 */

import { clampInt, configValidator as baseValidator, isRecord, standardSchema } from './util.js'

/**
 * The levels a session may run at, in upstream's order.
 *
 * `off` is a level, not a sentinel: it means the mode is not applied, and is how
 * a user disables the section without removing the bundle.
 *
 * @type {readonly string[]}
 */
export const LEVELS = Object.freeze(['off', 'lite', 'full', 'ultra'])

/**
 * The level a session starts at when nothing else has chosen one.
 *
 * Mirrors upstream's `DEFAULT_MODE`.
 *
 * @type {'off' | 'lite' | 'full' | 'ultra'}
 */
export const DEFAULT_LEVEL = 'full'

/** Configuration defaults; the shape below is what `cordis.patch.yml` may set. */
export const CONFIG_DEFAULTS = {
  // The level a new session starts at. `off` leaves the rules out of every
  // prompt until the user runs `/ponytail <level>`.
  defaultLevel: DEFAULT_LEVEL,
  // Whether the system-prompt section is published at all. Turning this off
  // silences the section while leaving the skill and the commands mounted, so a
  // user who wants the rules only on demand keeps `/ponytail`.
  promptEnabled: true,
  // Character budget for the rendered section, including the level table. The
  // section is repeated on every request, so it is bounded like any other
  // prompt text.
  maxSectionChars: 4000,
}

/** Expected primitive type per configuration key. */
export const CONFIG_TYPES = {
  defaultLevel: 'string',
  promptEnabled: 'boolean',
  maxSectionChars: 'number',
}

/**
 * Whether a value is one of the four levels.
 *
 * @param {unknown} value - the candidate.
 * @returns {boolean} whether it is a level.
 */
export function isLevel (value) {
  return typeof value === 'string' && LEVELS.includes(value)
}

/**
 * Normalise a level, falling back to the default for anything else.
 *
 * Used at the configuration boundary and by the command, where a user may type
 * any string. A value that is not a level is not an error at a call site — it
 * falls back — but it IS an error in `cordis.patch.yml`, which is what
 * {@link configValidator} is for.
 *
 * @param {unknown} value - the candidate.
 * @param {string} [fallback] - the level to use when the candidate is not one.
 * @returns {string} a level.
 */
export function normalizeLevel (value, fallback = DEFAULT_LEVEL) {
  if (isLevel(value)) return value
  const text = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return isLevel(text) ? text : fallback
}

/**
 * The strict configuration validator, in the shape Standard Schema expects.
 *
 * @param {Record<string, any>} [defaults] - default value per known key.
 * @param {Record<string, string>} [types] - expected type per key.
 * @returns {(value: unknown) => { value: any } | { issues: Array<{ message: string, path?: string[] }> }} a Standard Schema validate function.
 */
export function configValidator (defaults = CONFIG_DEFAULTS, types = CONFIG_TYPES) {
  const generic = baseValidator(defaults, types)
  return (input) => {
    const result = generic(input)
    if (result.issues) return result

    const issues = []
    const level = result.value.defaultLevel
    if (!isLevel(level)) {
      issues.push({ message: `defaultLevel must be one of ${LEVELS.join(', ')}`, path: ['defaultLevel'] })
    }
    if (issues.length > 0) return { issues }
    return result
  }
}

/**
 * Fill in the bounds a user does not have to configure.
 *
 * @param {Record<string, any>} raw - validated plugin configuration.
 * @returns {Record<string, any>} configuration with resolved values.
 */
export function resolveConfig (raw) {
  const value = { ...CONFIG_DEFAULTS, ...(isRecord(raw) ? raw : {}) }
  value.defaultLevel = normalizeLevel(value.defaultLevel, DEFAULT_LEVEL)
  value.promptEnabled = value.promptEnabled !== false
  // The floor is the shortest section that still carries the level, the closing
  // rule and the pointer to the skill; below it the section would be truncated
  // to the point where the model is told a mode is on but not what it means.
  value.maxSectionChars = clampInt(value.maxSectionChars, CONFIG_DEFAULTS.maxSectionChars, 1000, 20000)
  return value
}

/**
 * One line describing the resolved configuration, for the load log.
 *
 * @param {Record<string, any>} config - resolved configuration.
 * @returns {string} the description.
 */
export function describeConfig (config) {
  return `ponytail: default level ${config.defaultLevel}, prompt ${config.promptEnabled ? 'on' : 'off'}, section budget ${config.maxSectionChars} characters`
}

/**
 * The plugin configuration object.
 *
 * The Standard Schema form, which is what the harness resolves configuration
 * through. A native Schemastery schema would additionally render a live
 * Settings form; that is not available here because this plugin resolves
 * `@deepseek-ai/schemastery` through its peer only inside the harness, and a
 * plugin must not import it itself. The plain form keeps the loader working,
 * and a Settings row then reports `unsupported` rather than failing the load —
 * which is the correct trade: the configuration is a patch file the user edits,
 * not a UI the plugin needs.
 *
 * @type {{ '~standard': { version: number, vendor: string, validate: Function } }}
 */
export const ConfigSchema = standardSchema(configValidator())
