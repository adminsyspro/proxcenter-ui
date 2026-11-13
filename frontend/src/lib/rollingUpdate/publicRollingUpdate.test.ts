import { describe, expect, it } from "vitest"

import { publicRollingUpdate, publicRollingUpdates } from "./publicRollingUpdate"

const CREDS = { sshEnabled: true, sshUser: "root", sshAuthMethod: "key", sshKey: "fake-key", sshPassword: "fake-pw" }
const run = (id: string) => ({
  id,
  connection_id: "c1",
  status: "completed",
  config: { auto_reboot: true, ssh_overrides: { pve1: { address: "10.0.0.1" } }, ssh_credentials: CREDS },
})

describe("publicRollingUpdate", () => {
  it("drops ssh_credentials and keeps the rest of the config, overrides included", () => {
    const out = publicRollingUpdate(run("a"))

    expect(out.config).toEqual({ auto_reboot: true, ssh_overrides: { pve1: { address: "10.0.0.1" } } })
    expect(out.id).toBe("a")
  })

  it("does not modify the object it is given", () => {
    const input = run("a")

    publicRollingUpdate(input)
    expect(input.config.ssh_credentials).toBe(CREDS)
  })

  it.each([null, undefined, "x", 3, { id: "no-config" }, { id: "bad", config: "x" }])("passes %j through", (v) => {
    expect(publicRollingUpdate(v as any)).toEqual(v)
  })
})

describe("publicRollingUpdates", () => {
  it.each([
    ["a list", [run("a"), run("b")]],
    ["a list under data", { data: [run("a"), run("b")] }],
    ["one run under data", { data: run("a") }],
    ["one run", run("a")],
  ])("strips the credentials from %s", (_label, payload) => {
    expect(JSON.stringify(publicRollingUpdates(payload))).not.toMatch(/ssh_credentials|fake-key|fake-pw/)
  })

  it("keeps the other keys of a wrapped payload", () => {
    expect(publicRollingUpdates({ data: [], total: 0 })).toEqual({ data: [], total: 0 })
  })

  it.each([null, undefined, "x"])("passes %j through", (v) => {
    expect(publicRollingUpdates(v as any)).toEqual(v)
  })
})
