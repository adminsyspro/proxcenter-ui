import { describe, it, expect, vi, beforeEach } from "vitest"

// The SOAP transport is mocked one level lower (undici's request), as in
// soap.snapshot.test.ts, to read the exact envelope vCenter receives.
const undiciRequest = vi.fn()
vi.mock("undici", () => ({
  request: (...args: any[]) => undiciRequest(...args),
  Agent: class { constructor(_opts?: any) { /* no-op */ } },
}))

import { soapNfcLeaseAbort } from "./soap"

const session = { baseUrl: "https://vcenter", cookie: "vmware_soap_session=abc", insecureTLS: true } as any
const sent = () => String(undiciRequest.mock.calls.at(-1)![1].body)

beforeEach(() => {
  undiciRequest.mockReset().mockResolvedValue({ statusCode: 200, headers: {}, body: { text: async () => "<returnval/>" } })
})

describe("soapNfcLeaseAbort", () => {
  it("sends the reason as a LocalizedMethodFault vCenter accepts, escaped", async () => {
    await soapNfcLeaseAbort(session, "session[52a1]520c", "disk <0> & \"x\"")
    const body = sent()
    expect(body).toContain('<urn:_this type="HttpNfcLease">session[52a1]520c</urn:_this>')
    expect(body).toContain('<urn:fault xsi:type="urn:SystemError" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><urn:reason>disk &lt;0&gt; &amp; &quot;x&quot;</urn:reason></urn:fault>')
    expect(body).toContain("<urn:localizedMessage>disk &lt;0&gt; &amp; &quot;x&quot;</urn:localizedMessage>")
    // The bare element vCenter refused (InvalidRequestFault) is gone.
    expect(body).not.toContain("faultMessage")
  })

  it("aborts without a fault when no reason is given, and never throws", async () => {
    await soapNfcLeaseAbort(session, "lease-1")
    expect(sent()).not.toContain("urn:fault")
    undiciRequest.mockRejectedValue(new Error("socket hang up"))
    await expect(soapNfcLeaseAbort(session, "lease-1", "x")).resolves.toBeUndefined()
  })

  it("keeps a long reason short", async () => {
    await soapNfcLeaseAbort(session, "lease-1", "a".repeat(2000))
    expect(sent()).toContain(`<urn:reason>${"a".repeat(500)}</urn:reason>`)
  })
})
