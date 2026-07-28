import { timingSafeEqual } from "node:crypto"

export function constantTimeStringEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8")
  const bb = Buffer.from(b, "utf8")
  if (ab.length !== bb.length) {
    // timingSafeEqual rejects mismatched length up front, so we
    // compare against an equal-length buffer and still return false.
    timingSafeEqual(ab, Buffer.alloc(ab.length))
    return false
  }
  return timingSafeEqual(ab, bb)
}
