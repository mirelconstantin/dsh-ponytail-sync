/**
 * The ponytail runtime: the session-scoped level and the text every surface
 * renders.
 *
 * Two facts shape this module.
 *
 * **The level is session state, not global state.** Upstream keeps a mode in a
 * flag file that every session shares, which is right for one agent on one
 * machine and wrong for a harness that runs several sessions at once: a
 * subagent scoped to a narrow tool set would inherit a level the parent chose
 * for itself. The level here lives on the runtime keyed by the agent's session
 * id, so two sessions never see each other's choice.
 *
 * **A level change is model-visible state, so it is injected, not stored
 * silently.** The harness rule is that anything a model request depends on must
 * be reconstructable from the session log. The level is read when the prompt
 * section renders, so the section itself carries it — which is why the text
 * names the active level in the first line and nothing else has to record it.
 *
 * @module dsh-ponytail-sync/runtime
 */

import { fileURLToPath } from 'node:url'

import { LEVELS, normalizeLevel } from './config.js'

/** The service name this runtime publishes. */
export const SERVICE = 'ponytail'

/**
 * Where the vendored skill body lives, relative to this module.
 *
 * The skill row reads this once at registration; the runtime only publishes the
 * path so a diagnostic can name it.
 */
const SKILL_BODY_URL = new URL('../assets/ponytail/SKILL.md', import.meta.url)

/** One line per level, for the prompt section. */
const LEVEL_LINES = Object.freeze({
  off: 'Ponytail is off. Run `/ponytail lite`, `/ponytail full` or `/ponytail ultra` to switch it on.',
  lite: 'Ponytail is at **lite**: build what was asked and name the smaller option in one line for the user to pick.',
  full: 'Ponytail is at **full** (the default): the smallest complete change, with one small check where the logic needs it.',
  ultra: 'Ponytail is at **ultra**: question the request before building, and push back on any part the need does not justify.',
})

/** The two lines every ponytail reply owes the user. */
const CLOSING_RULE = 'End your reply with one or two lines: what you skipped or did not check, and any risk the user must know.'

/**
 * The session-scoped level, resolved lazily per session id.
 *
 * @type {Map<string, string>}
 */
const sessionLevels = new Map()

/**
 * The level a session runs at.
 *
 * Resolution order: a level this session set, then the plugin default, then
 * `full`. The default is read per call rather than captured, so a Settings
 * change applies to the next session rather than only to newly mounted ones.
 *
 * @param {any} runtime - the ponytail runtime.
 * @param {string} [sessionId] - the session whose level to read.
 * @returns {string} a level.
 */
export function levelOf (runtime, sessionId) {
  if (sessionId) {
    const own = sessionLevels.get(sessionId)
    if (own) return own
  }
  return normalizeLevel(runtime?.config?.defaultLevel, 'full')
}

/**
 * Set the level for one session.
 *
 * @param {string} sessionId - the session to change.
 * @param {unknown} value - the requested level.
 * @returns {string} the level now in force.
 */
export function setLevel (sessionId, value) {
  const level = normalizeLevel(value, 'full')
  sessionLevels.set(sessionId, level)
  return level
}

/**
 * Forget one session's level.
 *
 * Called when the harness disposes the plugin row, so a long-running host does
 * not accumulate one entry per session ever started. An omitted id clears every
 * entry, which is the unload path.
 *
 * @param {string} [sessionId] - the session to forget; omitted clears all.
 * @returns {void} nothing.
 */
export function clearLevel (sessionId) {
  if (sessionId) sessionLevels.delete(sessionId)
  else sessionLevels.clear()
}

/**
 * Whether a level applies the rules.
 *
 * @param {string} level - the level to test.
 * @returns {boolean} whether the mode is active.
 */
export function isActive (level) {
  return level !== 'off'
}

/**
 * The prompt section text for one level.
 *
 * Deliberately short: it is repeated on every request of every session, so
 * every line has to earn its tokens. It states the level, the one behavioural
 * difference between levels, and the closing rule. The full ruleset is in the
 * skill body, which the model loads through the `skill` tool.
 *
 * @param {string} level - the level to render.
 * @param {number} [maxChars] - character budget; the text is cut and says so
 *   when it exceeds it, so a deployment that shrinks the budget never gets a
 *   section that silently runs over.
 * @returns {string} the section text, or the empty string when the level is off.
 */
export function renderSection (level, maxChars) {
  if (!isActive(level)) return ''
  const text = [
    LEVEL_LINES[level],
    '',
    CLOSING_RULE,
    '',
    'The full ruleset is the `ponytail` skill: load it with the `skill` tool before the first coding task of this session. `/ponytail-review`, `/ponytail-audit`, `/ponytail-debt`, `/ponytail-gain` and `/ponytail-help` cover the one-shot commands.',
  ].join('\n')
  // The default budget is far above the rendered length, so this only fires for
  // a deployment that set one deliberately small.
  if (Number.isFinite(maxChars) && maxChars > 0 && text.length > maxChars) {
    const notice = `\n\n[ponytail section truncated: showing ${maxChars} of ${text.length} characters]`
    // A budget too small to carry the notice gets a bare slice, so the ceiling
    // holds for every budget rather than only for large ones.
    return notice.length >= maxChars ? text.slice(0, maxChars) : text.slice(0, maxChars - notice.length) + notice
  }
  return text
}

/**
 * The runtime service: the plugin's config, the per-session level, and the
 * text renderers.
 *
 * @param {object} options - the runtime inputs.
 * @param {any} [options.ctx] - the Cordis context, for the log line.
 * @param {Record<string, any>} options.config - resolved configuration.
 * @param {(message: string) => void} [options.log] - log sink.
 * @returns {any} the runtime.
 */
export function PonytailRuntime ({ ctx, config, log = () => {} }) {
  const runtime = {
    ctx,
    config,
    /**
     * The level for one session, resolving through this runtime's config.
     *
     * @param {string} [sessionId] - the session to read.
     * @returns {string} a level.
     */
    levelFor (sessionId) {
      return levelOf(runtime, sessionId)
    },
    /**
     * Set one session's level and return what is now in force.
     *
     * @param {string} sessionId - the session to change.
     * @param {unknown} value - the requested level.
     * @returns {string} the level in force.
     */
    setLevelFor (sessionId, value) {
      const level = setLevel(sessionId, value)
      log(`ponytail level for session ${sessionId ?? '(none)'}: ${level}`)
      return level
    },
    /**
     * Forget one session's level.
     *
     * @param {string} [sessionId] - the session to forget.
     * @returns {void} nothing.
     */
    forget (sessionId) {
      clearLevel(sessionId)
    },
    /**
     * The prompt section text for one session.
     *
     * @param {string} [sessionId] - the session being assembled for.
     * @returns {string} the section text, or the empty string when off.
     */
    section (sessionId) {
      return renderSection(this.levelFor(sessionId), config.maxSectionChars)
    },
    /**
     * The list of levels, for the help command and the Settings form.
     *
     * @returns {readonly string[]} the levels.
     */
    levels () {
      return LEVELS
    },
  }
  return runtime
}

/** The path the skill body would be at, for diagnostics. */
export const skillBodyPath = () => fileURLToPath(SKILL_BODY_URL)
