import { describe, it, expect, vi, beforeEach } from "vitest"

// soapGetGuestIdentities calls soapRequest in the same module: the transport is
// mocked one level lower, undici's request(), as in soap.snapshot.test.ts.
const undiciRequest = vi.fn()
vi.mock("undici", () => ({
  request: (...args: any[]) => undiciRequest(...args),
  Agent: class { constructor(_opts?: any) { /* no-op */ } },
}))

import { soapGetGuestIdentities } from "./soap"

const session = { baseUrl: "https://vcenter", cookie: "c", insecureTLS: true, propertyCollector: "propertyCollector" } as any
const reply = (text: string, statusCode = 200) => ({ statusCode, headers: {}, body: { text: async () => text } })
const prop = (name: string, val: string) => `<propSet><name>${name}</name><val xsi:type="xsd:string">${val}</val></propSet>`
const objects = (id: string, props: string) => `<returnval><objects><obj type="VirtualMachine">${id}</obj>${props}</objects></returnval>`
const bodyOf = (n: number) => String(undiciRequest.mock.calls[n][1].body)

beforeEach(() => { undiciRequest.mockReset() })

describe("soapGetGuestIdentities (#1000)", () => {
  it("reads the Tools-reported identity and the detailed data of every VM asked, unescaped", async () => {
    undiciRequest.mockResolvedValueOnce(reply(objects("vm-1", prop("guest.guestId", "almalinux_64Guest") + prop("guest.guestFullName", "AlmaLinux (64-bit)") + prop("guest.guestDetailedData", "distroName=&apos;AlmaLinux&apos; distroVersion=&apos;10.1&apos;"))))
    const out = await soapGetGuestIdentities(session, ["vm-1", "vm-1", "bad id"])
    expect(out.get("vm-1")).toEqual({ guestId: "almalinux_64Guest", guestOS: "AlmaLinux (64-bit)", detailedData: "distroName='AlmaLinux' distroVersion='10.1'" })
    // one object per distinct, well-formed id
    expect(bodyOf(0).match(/<urn:obj type="VirtualMachine">/g)).toHaveLength(1)
    expect(bodyOf(0)).toContain("guest.guestDetailedData")
  })

  it("asks again without the detailed data when an older vSphere refuses the property", async () => {
    undiciRequest
      .mockResolvedValueOnce(reply("<faultstring>InvalidProperty</faultstring>", 500))
      .mockResolvedValueOnce(reply(objects("vm-2", prop("guest.guestId", "rhel10_64Guest"))))
    const out = await soapGetGuestIdentities(session, ["vm-2"])
    expect(bodyOf(1)).not.toContain("guest.guestDetailedData")
    expect(out.get("vm-2")).toEqual({ guestId: "rhel10_64Guest", guestOS: "", detailedData: "" })
  })

  it("asks nothing for no VM and answers empty when every read fails", async () => {
    expect((await soapGetGuestIdentities(session, [])).size).toBe(0)
    expect(undiciRequest).not.toHaveBeenCalled()
    undiciRequest.mockRejectedValue(new Error("down"))
    expect((await soapGetGuestIdentities(session, ["vm-3"])).size).toBe(0)
  })
})

describe("soapGetGuestIdentities: a guest powered off by itself (#1000, lab 19/10)", () => {
  it("falls back to the guestInfo.detailed.data ESXi keeps in the VMX", async () => {
    const extra = `<propSet><name>config.extraConfig</name><val xsi:type="ArrayOfOptionValue"><OptionValue xsi:type="OptionValue"><key>tools.guest.desktop.autolock</key><value xsi:type="xsd:string">FALSE</value></OptionValue><OptionValue xsi:type="OptionValue"><key>guestInfo.detailed.data</key><value xsi:type="xsd:string">distroName=&apos;AlmaLinux&apos; distroVersion=&apos;10.1&apos;</value></OptionValue></val></propSet>`
    undiciRequest.mockResolvedValueOnce(reply(objects("vm-4", extra)))
    const out = await soapGetGuestIdentities(session, ["vm-4"])
    expect(out.get("vm-4")?.detailedData).toBe("distroName='AlmaLinux' distroVersion='10.1'")
    expect(bodyOf(0)).toContain("config.extraConfig")
  })
})
