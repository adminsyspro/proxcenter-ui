/** XcpngSource backed by Xen Orchestra's REST API (Basic auth, "user:password"). */
import {
  buildVdiDownloadUrl, xoGetVmConfig, xoFetch, xoListHosts, xoListVms,
  type XoConnectionInfo, type XoDiskInfo, type XoVmConfig,
} from "./client"
import type { XcpngSource, XcpngCredentials, XcpngHostInfo, XcpngDiskDownload } from "./source"
import type { XcpngVmListItem } from "./xapi-client"

export class XoSource implements XcpngSource {
  readonly kind = "xo" as const
  private readonly xo: XoConnectionInfo
  private readonly authB64: string

  constructor(private readonly c: XcpngCredentials) {
    this.authB64 = Buffer.from(`${c.user}:${c.password}`).toString("base64")
    this.xo = { baseUrl: c.baseUrl.replace(/\/$/, ""), authHeader: `Basic ${this.authB64}`, insecureTLS: c.insecureTLS }
  }

  get displayUrl() { return this.xo.baseUrl }

  listHosts(): Promise<XcpngHostInfo[]> { return xoListHosts(this.xo) }

  /**
   * Same rows the /vms route used to derive from the raw XO array: entries without
   * a uuid or a name_label are dropped, missing counters stay 0 so the route's
   * `|| undefined` fallbacks keep producing the exact same JSON.
   */
  async listVms(): Promise<XcpngVmListItem[]> {
    const raw = await xoListVms(this.xo)
    return raw
      .filter(v => v && v.uuid && v.name_label !== undefined)
      .map(v => ({
        uuid: v.uuid,
        name_label: v.name_label,
        power_state: v.power_state || "Halted",
        CPUs: { number: v.CPUs?.number || 0, max: v.CPUs?.max || 0 },
        memory: { size: v.memory?.size || v.memory?.dynamic?.[1] || 0 },
        os_version: v.os_version || {},
      }))
  }

  getVm(uuid: string) { return xoFetch<any>(this.xo, `/vms/${encodeURIComponent(uuid)}`) }

  getVmConfig(uuid: string): Promise<XoVmConfig> { return xoGetVmConfig(this.xo, uuid) }

  async diskDownload(disk: XoDiskInfo, format: "vhd" | "raw"): Promise<XcpngDiskDownload> {
    return {
      url: buildVdiDownloadUrl(this.xo.baseUrl, disk.vdiUuid, format),
      curlArgs: `${this.c.insecureTLS ? "-k " : ""}-H "Authorization: Basic ${this.authB64}" -H "Accept: application/octet-stream"`,
    }
  }

  async keepAlive() {}

  async close() {}
}
