// src/lib/orchestrator/path.ts
// How a path sent to the orchestrator is built and checked. Kept free of any
// import: the routes and the client both rely on it, tests included.

/**
 * A value refused as an orchestrator path segment. Carries the 400 the
 * proxies answer with: the call is refused here, before anything is sent.
 */
export class OrchestratorPathError extends Error {
  readonly status = 400
  constructor(message: string) {
    super(message)
    this.name = 'OrchestratorPathError'
  }
}

// What an identifier may look like once it sits in an orchestrator path: a
// UUID, a cuid, a number, a slug. Every character here is left as is by
// encodeURIComponent, so the segment reaches the orchestrator exactly as
// validated, and `.` or `..` cannot start the segment.
const PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/

/**
 * One segment of an orchestrator path, validated and encoded. Throws
 * OrchestratorPathError for anything that is not a plain identifier.
 */
export function orchestratorSegment(value: unknown, name = 'id'): string {
  const text = typeof value === 'number' && Number.isFinite(value) ? String(value) : value
  if (typeof text !== 'string' || !PATH_SEGMENT.test(text)) {
    throw new OrchestratorPathError(`Invalid ${name}`)
  }
  return encodeURIComponent(text)
}

/**
 * Tagged template building an orchestrator path: every interpolated value is
 * a path segment and goes through orchestratorSegment(). Query strings are not
 * values of this template; append them with URLSearchParams.
 *
 *   orchestratorPath`/reports/${id}/download`
 */
export function orchestratorPath(strings: TemplateStringsArray, ...values: unknown[]): string {
  let out = ''
  for (let i = 0; i < strings.length; i++) {
    out += strings[i]
    if (i < values.length) out += orchestratorSegment(values[i])
  }
  return out
}

// What the URL parser re-reads as a separator or a dot segment once the
// request is built: a backslash (a slash for http), an encoded dot. A
// fragment has no place in a path sent to the orchestrator.
const REINTERPRETED_IN_PATH = /[\\#]|%2e/i

export interface OrchestratorPathOptions {
  /**
   * The path holds a value whose own slash was encoded (a CIDR as one
   * segment). Only for a value the caller validated against its grammar.
   */
  encodedSlash?: boolean
}

/**
 * Refuses a path whose segments would be re-interpreted on the way: a dot
 * segment, an empty segment, a backslash, an encoded separator or dot, or
 * anything else the URL parser would rewrite. The typed methods below build
 * their paths through orchestratorPath(); this is the net under them.
 */
export function assertOrchestratorPath(path: string, options: OrchestratorPathOptions = {}): void {
  const queryAt = path.indexOf('?')
  const pathname = queryAt === -1 ? path : path.slice(0, queryAt)

  if (!pathname.startsWith('/') || REINTERPRETED_IN_PATH.test(pathname)) throw new OrchestratorPathError('Invalid orchestrator path')
  if (!options.encodedSlash && /%2f/i.test(pathname)) throw new OrchestratorPathError('Invalid orchestrator path')
  for (const segment of pathname.slice(1).split('/')) {
    if (segment === '' || segment === '.' || segment === '..') throw new OrchestratorPathError('Invalid orchestrator path')
  }

  // The request goes to the path the URL parser derives, not to the string
  // built here: the two must be the same, character for character.
  const sent = `/api/v1${pathname}`
  let parsed: string

  try {
    parsed = new URL(`http://orchestrator.invalid${sent}`).pathname
  } catch {
    throw new OrchestratorPathError('Invalid orchestrator path')
  }
  if (parsed !== sent) throw new OrchestratorPathError('Invalid orchestrator path')
}
