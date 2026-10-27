export type AvailabilityErrorKind = 'unavailable' | 'forbidden' | 'generic'

/**
 * What a failed overview request means. The shared fetcher throws
 * `API error: <status>`: 503 is the orchestrator out of reach, 403 an access
 * (or edition) refusal, anything else an unexpected failure.
 */
export function availabilityErrorKind(error: unknown): AvailabilityErrorKind {
  const status = Number(/API error: (\d{3})/.exec(error instanceof Error ? error.message : '')?.[1])

  if (status === 503) return 'unavailable'
  if (status === 403) return 'forbidden'

  return 'generic'
}
