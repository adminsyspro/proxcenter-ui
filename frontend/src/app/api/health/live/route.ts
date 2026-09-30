import { liveResponse } from "../liveness"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export function GET() {
  return liveResponse()
}
