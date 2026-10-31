import { shellEscape } from "@/lib/ssh/exec"

export interface VddkOpts {
  /** Unix socket nbdkit listens on (-U). */
  sock: string
  /** Path to the extracted VDDK distribution on the PVE node (libdir=). */
  libdir: string
  /** ESXi/vCenter host the VDDK connects to (server=). */
  server: string
  /** Login user (user=). */
  user: string
  /** File holding the password; nbdkit reads it via `password=+FILE`. */
  passwordFile: string
  /** SHA1 SSL thumbprint of the server certificate (thumbprint=). */
  thumbprint: string
  /** Managed object reference of the source VM (vm=moref=). */
  moref: string
  /** Datastore-relative disk path, e.g. "[datastore] vm/vm.vmdk" (file=). */
  diskPath: string
  /**
   * Optional snapshot moref (snapshot=). REQUIRED to read a snapshot's logical
   * view (base + delta at snapshot time), which is what every CBT delta read
   * needs. Omit only for a static read of the VM's current disk.
   */
  snapshot?: string
}

/**
 * nbdkit's retry filter, as virt-v2v puts it in front of the VDDK plugin: after
 * a failed request it closes the disk, connects and opens it again, then
 * repeats the request, up to `retries` times with a delay that doubles from
 * `retry-delay` seconds (2, 4, 8, 16, 32: about a minute in all).
 *
 * Without it a network blip on port 902 fails the whole copy: the VDDK gives
 * up a read with no reply (60 s in OpenVDDK, roadmap#177), nbdkit returns EIO,
 * dd stops, and a full copy is lost with the job. With it the copy rides out a
 * short outage on either library; a longer one still fails, cleanly.
 * The filter ships in the nbdkit package itself, so it is present wherever
 * nbdkit is.
 */
export const NBDKIT_RETRY_FILTER = ["--filter=retry"] as const
export const NBDKIT_RETRY_PARAMS = ["retries=5", "retry-delay=2"] as const

/**
 * Build the `nbdkit -U <sock> vddk ...` command validated on the lab spike.
 * Every interpolated value is shell-escaped: the disk path carries a space and
 * brackets that would otherwise split into multiple arguments, and the other
 * values originate from DB/SOAP data rather than hard-coded constants. The
 * password is passed by file reference (`password=+FILE`) so it never appears
 * in the process argument list.
 */
export function buildNbdkitVddkCmd(o: VddkOpts): string {
  const parts = [
    // -r (read-only): warm only ever reads the source. Without it nbdkit serves
    // a read-write export, so VDDK opens the disk read-write, which a running VM
    // rejects over NFC (NBD_ERR_GENERIC). Read-only opens the frozen snapshot.
    // -f (foreground): the launch backgrounds nbdkit itself with its stderr in the
    // reader's log. Left to daemonize, nbdkit sends its errors to syslog instead,
    // the log stays empty and every failed open reached the job as "nbdkit log:
    // (empty)" without the VDDK's reason (roadmap#177).
    // Filters go before the plugin name; their parameters ride with the plugin's.
    "nbdkit", "-f", "-r", "-U", shellEscape(o.sock), ...NBDKIT_RETRY_FILTER, "vddk",
    ...NBDKIT_RETRY_PARAMS,
    `libdir=${shellEscape(o.libdir)}`,
    `server=${shellEscape(o.server)}`,
    `user=${shellEscape(o.user)}`,
    `password=+${shellEscape(o.passwordFile)}`,
    `thumbprint=${shellEscape(o.thumbprint)}`,
    `vm=moref=${shellEscape(o.moref)}`,
  ]
  if (o.snapshot) parts.push(`snapshot=${shellEscape(o.snapshot)}`)
  parts.push(`file=${shellEscape(o.diskPath)}`)
  return parts.join(" ")
}
