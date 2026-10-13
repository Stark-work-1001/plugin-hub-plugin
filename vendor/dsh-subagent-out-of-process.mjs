/* Adapted from DeepSeek Harness out-of-process helpers, MIT. See LICENSE. */

import { accessSync, constants, statSync } from 'node:fs'
import { isAbsolute } from 'node:path'

/** Maximum UTF-8 size of the provider's `SubagentResult.diagnostic`. */
const MAX_SUBAGENT_DIAGNOSTIC_BYTES = 4_096

const DIAGNOSTIC_TRUNCATION_SUFFIX = '\n[diagnostic truncated]'
const utf8Encoder = new TextEncoder()
const utf8Decoder = new TextDecoder()

/**
 * Limit provider-authored failure detail without splitting a UTF-8 sequence.
 * @param {string} diagnostic safe diagnostic text produced by the provider
 * @returns {string} the original text, or a visibly truncated value within the limit
 */
function limitSubagentDiagnostic(diagnostic) {
  const bytes = utf8Encoder.encode(diagnostic)
  if (bytes.byteLength <= MAX_SUBAGENT_DIAGNOSTIC_BYTES) return diagnostic

  const suffixBytes = utf8Encoder.encode(DIAGNOSTIC_TRUNCATION_SUFFIX).byteLength
  let prefixBytes = MAX_SUBAGENT_DIAGNOSTIC_BYTES - suffixBytes
  while (((bytes[prefixBytes] & 0b1100_0000) === 0b1000_0000)) {
    prefixBytes -= 1
  }
  return utf8Decoder.decode(bytes.subarray(0, prefixBytes)) + DIAGNOSTIC_TRUNCATION_SUFFIX
}

/** Enforce the byte limit on a provider-returned diagnostic. */
function normalizeSubagentDiagnostic(result) {
  return result.diagnostic === undefined
    ? result
    : { ...result, diagnostic: limitSubagentDiagnostic(result.diagnostic) }
}

/**
 * The capability advertisement of an out-of-process backend: NONE. A child in
 * another process cannot honor parent-enforced start features, so the service
 * rejects a request needing any of them before `start` runs.
 */
export const NO_START_CAPABILITIES = Object.freeze({
  agentOptions: false,
  outputSchema: false,
  depthLimit: false,
  toolFilter: false,
  persona: false,
})

/**
 * Assert a configured timing bound is a positive finite number (it bounds a
 * teardown or shutdown wait; zero, negative, or NaN would skip or wedge it).
 * @param {string} prefix the consuming plugin's diagnostic prefix
 * @param {string} name the config field name, for the diagnostic
 * @param {number} value the configured value
 */
export function assertPositiveFinite(prefix, name, value) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${prefix}: ${name} must be a positive finite number`)
  }
}

/**
 * Whether `path` names an existing directory the harness can ENTER. The
 * search-permission probe matters: `statSync().isDirectory()` is true for a
 * mode-600 directory, but a subprocess cwd needs `X_OK` or spawn fails EACCES.
 */
function isEnterableDirectory(path) {
  try {
    if (!statSync(path).isDirectory()) return false
    accessSync(path, constants.X_OK)
    return true
  } catch {
    // statSync/accessSync throw only filesystem access errors here
    // (ENOENT/EACCES/ENOTDIR/…), and every one of them means the path cannot
    // serve as the child's cwd.
    return false
  }
}

/**
 * Assert `cwd` can actually host the child: absolute and an existing directory
 * (fail here, before the process boundary, instead of as an ambiguous spawn ENOENT).
 * @param {string} prefix the consuming plugin's diagnostic prefix
 * @param {string} label which source supplied the value, for the diagnostic
 * @param {string} cwd the candidate working directory
 * @returns {string} `cwd`, validated
 */
export function assertUsableCwd(prefix, label, cwd) {
  if (!isAbsolute(cwd)) {
    throw new Error(`${prefix}: ${label} must be an absolute path: ${cwd}`)
  }
  if (!isEnterableDirectory(cwd)) {
    throw new Error(`${prefix}: ${label} is not an accessible directory: ${cwd}`)
  }
  return cwd
}

/** Normalize an unknown thrown value to an Error (the catch binding is `unknown`). */
function toError(value) {
  return value instanceof Error ? value : new Error(String(value))
}

/**
 * Settle an out-of-process run result under the seam contract: `result` never
 * rejects after publication. The abort listener is removed on every path.
 * @param {object} parts the attempt, output snapshot, cancellation state, sink, and signal wiring
 * @returns {Promise<object>} the terminal result (never a rejection)
 */
export async function settleRunResult(parts) {
  try {
    const result = await parts.attempt()
    return parts.cancelled()
      ? { output: parts.collectOutput(), stopReason: 'aborted' }
      : normalizeSubagentDiagnostic(result)
  } catch (error) {
    // Cover a rejection already queued when cancellation arrives.
    if (parts.cancelled()) return { output: parts.collectOutput(), stopReason: 'aborted' }
    // Flatten post-publication transport failures while preserving diagnostics.
    try {
      parts.onError?.(toError(error), 'error')
    } catch {
      // The diagnostic sink cannot reject the run result.
    }
    const collected = parts.collectDiagnostic?.()
    const diagnostic = collected === undefined
      ? undefined
      : limitSubagentDiagnostic(collected)
    return {
      output: parts.collectOutput(),
      ...diagnostic === undefined ? {} : { diagnostic },
      stopReason: 'error',
    }
  } finally {
    parts.signal.removeEventListener('abort', parts.onAbort)
  }
}

/**
 * Publish the seam run handle for an out-of-process child. `dispose()` is
 * idempotent (one memoized teardown).
 * @param {object} parts the run identity, result, cancellation wiring, and teardown
 * @returns {{id: string, result: Promise<object>, dispose(): Promise<void>}} the external run handle
 */
export function subprocessRunHandle(parts) {
  let disposal
  return {
    id: parts.id,
    result: parts.result,
    dispose() {
      if (disposal !== undefined) return disposal
      parts.signal.removeEventListener('abort', parts.onAbort)
      parts.requestCancel()
      disposal = parts.teardown()
      return disposal
    },
  }
}
