import { beforeEach, describe, expect, it, vi } from "vitest"

const session = vi.hoisted(() => vi.fn())

vi.mock("next-auth", () => ({ getServerSession: () => session() }))
vi.mock("@/lib/auth/config", () => ({ authOptions: {} }))

import { sessionAcknowledger } from "./acknowledgedBy"

beforeEach(() => {
  session.mockResolvedValue({ user: { id: "u1", name: "Ops", email: "ops@corp" } })
})

describe("sessionAcknowledger", () => {
  it("keeps the session's name or e-mail as sent by the page and the bell", async () => {
    expect(await sessionAcknowledger("Ops")).toBe("Ops")
    expect(await sessionAcknowledger("ops@corp")).toBe("ops@corp")
  })

  it("replaces anyone else's name by the session's", async () => {
    expect(await sessionAcknowledger("ceo@corp")).toBe("Ops")
    expect(await sessionAcknowledger(undefined)).toBe("Ops")
    expect(await sessionAcknowledger(42)).toBe("Ops")
  })

  it("falls back to the e-mail, then to unknown", async () => {
    session.mockResolvedValue({ user: { id: "u1", name: null, email: "ops@corp" } })
    expect(await sessionAcknowledger("ceo@corp")).toBe("ops@corp")
    session.mockResolvedValue(null)
    expect(await sessionAcknowledger("ceo@corp")).toBe("unknown")
  })
})
