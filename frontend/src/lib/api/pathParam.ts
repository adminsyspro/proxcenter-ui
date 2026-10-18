import { NextResponse } from "next/server"

/**
 * A dynamic path segment as Next hands it: already decoded once (a malformed
 * escape never reaches the handler, Next answers 400). No ProxCenter id, UPID,
 * CIDR or PBS backup id holds a "%", so one left after that decode is an
 * escape sent twice or garbage: answered 400 here rather than decoded again
 * (a 500 on a malformed one) or passed on to Proxmox.
 */
export function residualEscapeRefusal(value: string, name: string): NextResponse | null {
  return value.includes("%") ? NextResponse.json({ error: `Malformed ${name}` }, { status: 400 }) : null
}
