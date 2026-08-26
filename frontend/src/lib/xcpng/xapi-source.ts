/** XcpngSource backed by a direct XAPI session on the pool master. */
import {
  xapiLogin, xapiLogout, xapiHosts, xapiListVms, xapiGetVmRecord, xapiGetVmConfig, xapiVdiExportUrl, xapiKeepAlive,
  type XapiSession, type XcpngVmListItem,
} from "./xapi-client"
import type { XcpngSource, XcpngCredentials, XcpngHostInfo, XcpngDiskDownload } from "./source"
import type { XoDiskInfo, XoVmConfig } from "./client"

export class XapiSource implements XcpngSource {
  readonly kind = "xapi" as const

  private constructor(private readonly c: XcpngCredentials, readonly session: XapiSession) {}

  static async open(c: XcpngCredentials): Promise<XapiSource> {
    return new XapiSource(c, await xapiLogin(c.baseUrl, c.user, c.password, c.insecureTLS))
  }

  get displayUrl() { return this.session.baseUrl }

  listHosts(): Promise<XcpngHostInfo[]> { return xapiHosts(this.session) }

  listVms(): Promise<XcpngVmListItem[]> { return xapiListVms(this.session) }

  getVm(uuid: string) { return xapiGetVmRecord(this.session, uuid) }

  getVmConfig(uuid: string): Promise<XoVmConfig> { return xapiGetVmConfig(this.session, uuid) }

  /** The export URL carries the session reference: no auth header, but the URL itself is a secret. */
  async diskDownload(disk: XoDiskInfo, format: "vhd" | "raw"): Promise<XcpngDiskDownload> {
    if (!disk.vdiRef) throw new Error(`disk ${disk.label} has no XAPI reference`)
    return {
      url: xapiVdiExportUrl(this.session, disk.vdiRef, format),
      curlArgs: `${this.c.insecureTLS ? "-k " : ""}-H "Accept: application/octet-stream"`,
    }
  }

  keepAlive() { return xapiKeepAlive(this.session) }

  close() { return xapiLogout(this.session) }
}
