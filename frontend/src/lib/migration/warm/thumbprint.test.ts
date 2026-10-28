import { describe, it, expect } from "vitest"
import { buildThumbprintCmd, parseThumbprintProbe } from "./thumbprint"

// Outputs of buildThumbprintCmd captured on a PVE 9 node (OpenSSL 3.5.7), roadmap#175.
const OK = "sha1 Fingerprint=1c:1d:6f:ec:33:cb:fc:16:81:f4:31:6b:9b:b0:5c:dd:24:b1:24:bd\n"
const DNS = [
  "s_client-exit=1",
  "80077082EB750000:error:10080002:BIO routines:BIO_lookup_ex:system lib:../crypto/bio/bio_addr.c:767:Name or service not known",
  "connect:errno=2",
].join("\n")
const REFUSED = [
  "s_client-exit=1",
  "802725A7D5720000:error:8000006F:system library:BIO_connect:Connection refused:../crypto/bio/bio_sock2.c:183:calling connect()",
  "connect:errno=111",
].join("\n")
const FILTERED = "s_client-exit=124\n"
const NOT_TLS = "s_client-exit=1\n8087697AC6780000:error:0A00010B:SSL routines:tls_validate_record_header:wrong version number:../ssl/record/methods/tlsany_meth.c:77:\n"

describe("buildThumbprintCmd", () => {
  it("keeps the OpenSSL diagnostics, bounds the handshake and escapes the target", () => {
    const cmd = buildThumbprintCmd("vcenter.corp.local")
    expect(cmd).toContain("timeout 15 openssl s_client -connect 'vcenter.corp.local:443' 2>&1")
    expect(cmd).toContain("openssl x509 -fingerprint -sha1 -noout")
    expect(cmd).toContain('echo "s_client-exit=$rc"')
  })
  it("brackets an IPv6 address, with or without the URL brackets", () => {
    expect(buildThumbprintCmd("fd00::20")).toContain("-connect '[fd00::20]:443'")
    expect(buildThumbprintCmd("[fd00::20]")).toContain("-connect '[fd00::20]:443'")
  })
  it("refuses an address the shell would interpret", () => {
    expect(() => buildThumbprintCmd("vc; reboot")).toThrow(/Invalid VMware address/)
    expect(() => buildThumbprintCmd("$(id)")).toThrow(/Invalid VMware address/)
  })
})

describe("parseThumbprintProbe", () => {
  it("returns the 20-octet thumbprint, upper-case, whatever the certificate's issuer", () => {
    expect(parseThumbprintProbe(OK, "10.42.0.20", "pve1")).toBe("1C:1D:6F:EC:33:CB:FC:16:81:F4:31:6B:9B:B0:5C:DD:24:B1:24:BD")
    expect(parseThumbprintProbe("SHA1 Fingerprint=00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33", "h", "n")).toBe("00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33")
  })

  it("names an unresolvable vCenter name instead of a parse error", () => {
    expect(() => parseThumbprintProbe(DNS, "vcenter.corp.local", "pve1"))
      .toThrow("Could not read the TLS certificate of vcenter.corp.local:443 from the Proxmox node pve1, which the VDDK needs to connect: the node cannot resolve the name vcenter.corp.local: add it to the node's DNS or /etc/hosts")
  })

  it("tells a refused, a filtered and an unrouted connection apart", () => {
    expect(() => parseThumbprintProbe(REFUSED, "10.42.0.20", "pve1")).toThrow(/10\.42\.0\.20 refused the connection on port 443: open the firewall/)
    expect(() => parseThumbprintProbe(FILTERED, "10.42.0.20", "pve1")).toThrow(/no answer from 10\.42\.0\.20 on port 443 within 15 s/)
    expect(() => parseThumbprintProbe("s_client-exit=1\nconnect: No route to host\n", "10.42.0.20", "pve1")).toThrow(/no route to 10\.42\.0\.20/)
  })

  it("quotes the OpenSSL error of a failed handshake, without its code prefix", () => {
    expect(() => parseThumbprintProbe(NOT_TLS, "10.42.0.20", "pve1")).toThrow(/TLS handshake with 10\.42\.0\.20:443 failed \(SSL routines:tls_validate_record_header:wrong version number/)
  })

  it("refuses an empty, truncated or unexpected output", () => {
    expect(() => parseThumbprintProbe("", "h", "pve1")).toThrow(/h:443 presented no certificate/)
    expect(() => parseThumbprintProbe(undefined, "h", "pve1")).toThrow(/presented no certificate/)
    expect(() => parseThumbprintProbe("SHA1 Fingerprint=46:8C:45:42:83:C3:4A:B6", "h", "pve1")).toThrow(/presented no certificate/)
    expect(() => parseThumbprintProbe("unable to load certificate", "h", "pve1")).toThrow(/Could not read the TLS certificate of h:443/)
  })
})
