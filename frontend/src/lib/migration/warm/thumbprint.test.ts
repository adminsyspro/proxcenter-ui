import { describe, it, expect } from "vitest"
import { parseSha1Thumbprint } from "./thumbprint"

describe("parseSha1Thumbprint", () => {
  it("parses the openssl SHA1 fingerprint line", () => {
    expect(parseSha1Thumbprint("SHA1 Fingerprint=46:8C:45:42:83:C3:4A:B6")).toBe("46:8C:45:42:83:C3:4A:B6")
  })

  it("is case-insensitive and trims surrounding whitespace/newlines", () => {
    expect(parseSha1Thumbprint("sha1 Fingerprint=AB:CD\n")).toBe("AB:CD")
  })

  it("finds the fingerprint amid the full openssl x509 output", () => {
    const out = [
      "depth=0 CN = esxi.lab",
      "SHA1 Fingerprint=00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33",
      "-----BEGIN CERTIFICATE-----",
    ].join("\n")
    expect(parseSha1Thumbprint(out)).toBe("00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33")
  })

  it("throws on missing fingerprint", () => {
    expect(() => parseSha1Thumbprint("no fingerprint here")).toThrow()
  })
})
