// Largest request body the app reads. next.config.mjs buffers each body in
// memory up to this size before the proxy runs (proxyClientMaxBodySize), and
// past it hands the route a truncated body without any error. The biggest
// body a route needs is a configuration backup import (MAX_BACKUP_BYTES, with
// the logos and backgrounds it carries); uploads to a storage go in 5 MB
// chunks. Same value as client_max_body_size in nginx/proxcenter-*.conf.
export const MAX_REQUEST_BODY_BYTES = 100 * 1024 * 1024

/** True when the request declares a body larger than the app ever reads. */
export function declaresBodyOver(headers: { get(name: string): string | null | undefined }, limit = MAX_REQUEST_BODY_BYTES): boolean {
  const length = Number(headers.get('content-length'))

  return Number.isFinite(length) && length > limit
}
