/**
 * Recognise a task id and the node running it.
 * Shape: `UPID:<node>:<pid>:<pstart>:<starttime>:<type>:<id>:<user>:`
 */
export function parseUpid(value: unknown): { upid: string; node: string } | null {
  if (typeof value !== "string") return null

  const match = /^UPID:([^\s:]+):/.exec(value)

  if (!match) return null

  return { upid: value, node: match[1] }
}
