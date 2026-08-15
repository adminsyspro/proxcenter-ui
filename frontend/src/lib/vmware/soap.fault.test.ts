import { describe, it, expect } from "vitest"

import { describeSoapFault } from "./soap"

/**
 * The incident behind #614 gave us "A general system error occurred: Undeclared
 * fault" and nothing else, because the <detail> block carrying the concrete fault
 * type was discarded. These cases pin the parts we now keep.
 */

const FAULT = (detail: string) => `<?xml version="1.0"?>
<soapenv:Envelope><soapenv:Body><soapenv:Fault>
  <faultcode>ServerFaultCode</faultcode>
  <faultstring>A general system error occurred: Undeclared fault</faultstring>
  <detail>${detail}</detail>
</soapenv:Fault></soapenv:Body></soapenv:Envelope>`

describe("describeSoapFault", () => {
  it("returns null when the payload carries no fault", () => {
    expect(describeSoapFault("<soapenv:Envelope><returnval>ok</returnval></soapenv:Envelope>")).toBeNull()
  })

  it("keeps the faultstring when there is no detail block", () => {
    const xml = "<soapenv:Fault><faultstring>Permission to perform this operation was denied.</faultstring></soapenv:Fault>"
    expect(describeSoapFault(xml)).toBe("Permission to perform this operation was denied.")
  })

  it("names the concrete fault type hiding behind a generic faultstring", () => {
    const out = describeSoapFault(FAULT('<SystemErrorFault xsi:type="SystemError"><reason>x</reason></SystemErrorFault>'))
    expect(out).toContain("A general system error occurred: Undeclared fault")
    expect(out).toContain("fault type: SystemErrorFault")
  })

  it("strips the namespace prefix from the fault type", () => {
    const out = describeSoapFault(FAULT('<vim25:NotSupported xsi:type="NotSupported"/>'))
    expect(out).toContain("fault type: NotSupported")
  })

  it("adds the localized message when vSphere provides one", () => {
    const out = describeSoapFault(FAULT(
      '<ToolsUnavailableFault xsi:type="ToolsUnavailable"/><localizedMessage>Failed to power off the virtual machine</localizedMessage>',
    ))
    expect(out).toContain("fault type: ToolsUnavailableFault")
    expect(out).toContain("Failed to power off the virtual machine")
  })

  it("does not repeat the faultstring when the localized message says the same thing", () => {
    const xml = `<soapenv:Fault><faultstring>Boom</faultstring><detail><X/><localizedMessage>Boom</localizedMessage></detail></soapenv:Fault>`
    expect(describeSoapFault(xml)).toBe("Boom | fault type: X")
  })

  it("ignores a faultCause wrapper rather than reporting it as the type", () => {
    // vSphere nests the real fault under <faultCause> in some replies; naming the
    // wrapper would be worse than naming nothing.
    const out = describeSoapFault(FAULT('<faultCause xsi:type="LocalizedMethodFault"/>'))
    expect(out).not.toContain("fault type")
    expect(out).toContain("A general system error occurred")
  })
})
