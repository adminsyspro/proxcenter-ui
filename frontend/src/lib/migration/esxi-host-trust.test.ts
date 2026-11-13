import { beforeEach, describe, expect, it, vi } from "vitest"

const trusted = vi.hoisted(() => ({ value: { lines: [] as string[], keyTypes: [] as string[], sha256Hex: [] as string[] } }))

vi.mock("@/lib/ssh/host-key-store", () => ({
  hostKeyEndpoint: (host: string, port: number) => `${host.toLowerCase()}:${port}`,
  trustedKnownHosts: async () => trusted.value,
}))

import {
  EsxiHostKeyNotTrustedError, esxiHostKeyFailure, esxiHostKeyProbeCommand, esxiSshHost, esxiStrictSshConfigLines, esxiStrictSshfsOptions, esxiStrictSshOptions,
  knownHostsNames, loadEsxiHostTrust, qemuHostKeyCheck, qemuHostKeyCheckOption, stageEsxiKnownHosts,
} from "./esxi-host-trust"

const FILE = "/tmp/proxcenter-mig-job1-esxi.known_hosts"

beforeEach(() => {
  trusted.value = {
    lines: ["esx1 ecdsa-sha2-nistp256 AAAAecdsa", "esx1 ssh-rsa AAAArsa"],
    keyTypes: ["ecdsa-sha2-nistp256", "ssh-rsa"],
    sha256Hex: ["ec00", "rs00"],
  }
})

describe("loadEsxiHostTrust", () => {
  it("returns the confirmed keys of the endpoint", async () => {
    const t = await loadEsxiHostTrust("ESX1", 22, FILE)
    expect(t).toMatchObject({ endpoint: "esx1:22", file: FILE, keyTypes: ["ecdsa-sha2-nistp256", "ssh-rsa"] })
    expect(stageEsxiKnownHosts(t)).toEqual({
      command: `umask 077; cat > '${FILE}'`,
      stdin: "esx1 ecdsa-sha2-nistp256 AAAAecdsa\nesx1 ssh-rsa AAAArsa\n",
    })
  })

  it("stops when no key is confirmed, pointing at the SSH test", async () => {
    trusted.value = { lines: [], keyTypes: [], sha256Hex: [] }
    const err = await loadEsxiHostTrust("esx1", 2222, FILE).catch(e => e)
    expect(err).toBeInstanceOf(EsxiHostKeyNotTrustedError)
    expect(err.endpoint).toBe("esx1:2222")
    expect(err.message).toMatch(/not confirmed.*SSH test.*No credential was sent/)
  })

  it("refuses a path that would need quoting", async () => {
    await expect(loadEsxiHostTrust("esx1", 22, "/tmp/a b")).rejects.toThrow(/unsafe/)
    expect(() => esxiStrictSshOptions("/tmp/x,y")).toThrow(/unsafe/)
    expect(() => esxiStrictSshfsOptions("relative")).toThrow(/unsafe/)
    expect(() => esxiStrictSshConfigLines("/tmp/'x")).toThrow(/unsafe/)
  })
})

describe("client options", () => {
  it("checks the host key strictly against the file, in every client syntax", () => {
    expect(esxiStrictSshOptions(FILE)).toBe(`-o StrictHostKeyChecking=yes -o UserKnownHostsFile=${FILE}`)
    expect(esxiStrictSshfsOptions(FILE)).toBe(`StrictHostKeyChecking=yes,UserKnownHostsFile=${FILE}`)
    expect(esxiStrictSshConfigLines(FILE)).toEqual(["    StrictHostKeyChecking yes", `    UserKnownHostsFile ${FILE}`])
  })

  it("gives QEMU the hash of the key libssh negotiates first", async () => {
    const t = await loadEsxiHostTrust("esx1", 22, FILE)
    expect(qemuHostKeyCheck(t)).toEqual({
      "file.host-key-check.mode": "hash", "file.host-key-check.type": "sha256", "file.host-key-check.hash": "ec00",
    })
    expect(qemuHostKeyCheckOption({ ...t, keyTypes: ["ssh-rsa", "ssh-ed25519"], sha256Hex: ["rs00", "ed00"] }))
      .toBe("file.host-key-check.mode=hash,file.host-key-check.type=sha256,file.host-key-check.hash=ed00")
    expect(qemuHostKeyCheck({ ...t, keyTypes: ["x-unknown", "ssh-rsa"], sha256Hex: ["xx", "rs00"] })["file.host-key-check.hash"]).toBe("rs00")
  })

  it("names the endpoint as known_hosts does", () => {
    expect(knownHostsNames("esx1", 22)).toEqual(["esx1"])
    expect(knownHostsNames("esx1", 2222)).toEqual(["[esx1]:2222"])
  })

  it("reads the SSH host from the connection URL", () => {
    expect(esxiSshHost("https://10.42.0.21")).toBe("10.42.0.21")
    expect(esxiSshHost("https://esx1.lab:443/sdk")).toBe("esx1.lab")
    expect(esxiSshHost("https://[fe80::1]:443")).toBe("fe80::1")
    expect(esxiSshHost("esx1.lab:443/x")).toBe("esx1.lab")
  })
})

describe("esxiHostKeyFailure", () => {
  it.each([
    "Host key verification failed.",
    "@@@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @@@",
    "No ECDSA host key is known for 10.42.0.21 and you have requested strict checking.",
    "nbdkit: ssh[1]: error: host key for server has changed",
  ])("explains a host key refusal: %s", (out) => {
    expect(esxiHostKeyFailure("esx1:22", undefined, out)).toMatch(/esx1:22 presented an SSH host key that is not the one confirmed.*before any credential was sent/)
  })

  it("leaves any other failure alone", () => {
    expect(esxiHostKeyFailure("esx1:22", "Permission denied, please try again.", null, "")).toBeNull()
  })
})

describe("esxiHostKeyProbeCommand", () => {
  it("logs in with no credential and checks the host key strictly", () => {
    const cmd = esxiHostKeyProbeCommand(FILE, "ro'ot", "esx1", 2222)
    expect(cmd.startsWith("ssh -i /dev/null -o IdentitiesOnly=yes -o BatchMode=yes -o PreferredAuthentications=publickey ")).toBe(true)
    expect(cmd).toContain(`-o StrictHostKeyChecking=yes -o UserKnownHostsFile=${FILE}`)
    expect(cmd).toContain(`-p 2222 'ro'\\''ot@esx1' true 2>&1`)
  })
})
