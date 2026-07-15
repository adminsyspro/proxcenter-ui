import { liveResponse } from "../liveness"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  return liveResponse()
}
