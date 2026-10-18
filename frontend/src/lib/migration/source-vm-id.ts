/**
 * Grammar of a source VM id (vSphere moref "vm-123", ESXi numeric id, XCP-ng
 * and Nutanix UUIDs, Hyper-V GUIDs). The id is interpolated into SOAP and XAPI
 * requests, so anything else (markup, quotes, spaces) is refused before it
 * gets there.
 */
export const SOURCE_VM_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

export function isValidSourceVmId(id: unknown): id is string {
  return typeof id === "string" && SOURCE_VM_ID_RE.test(id)
}
