// PURE data modules: imported by BOTH the proxy (D7) and
// principal.ts (D8). NO DB access, ever.
import { CONN, type AllowlistEntry } from "./types"

// ── Storage domain (spec 5) ──────────────────────────────────────────────────
const NODE_STORAGE = `${CONN}/nodes/{node}/storage/{storage}`
const NODE_STORAGE_FILE = "connections/[id]/nodes/[node]/storage/[storage]"
/** GET neighbours of the storage write routes: the read scope or the write scope. */
const STORAGE_READ_SCOPES = ["storage:read", "storage:write"]

type StorageEntry = Omit<AllowlistEntry, "tag" | "routeFile" | "connectionSegment"> & { file: string }

/** A storage route of a connection; `file` is its directory under src/app/api/v1. */
function storageEntry({ file, ...entry }: StorageEntry): AllowlistEntry {
  return { ...entry, connectionSegment: "id", tag: "Storage", routeFile: `src/app/api/v1/${file}/route.ts` }
}

export const STORAGE_ENTRIES: AllowlistEntry[] = [
  storageEntry({
    id: "storage-connection-list",
    method: "GET",
    file: "connections/[id]/storage",
    pattern: `${CONN}/storage`,
    requiredScopes: STORAGE_READ_SCOPES,
    summary: "Storages of a cluster",
    description:
      "The storages of the cluster with their capacity and configuration; a shared storage is one row listing every node that mounts it. Needs connection.view on the cluster (scope storage:write or nodes:read). A vDC tenant only sees the storages of its vDC.",
    responseSchemaRef: "ConnectionStoragesResponse",
  }),
  storageEntry({
    id: "storage-attach-pbs",
    method: "POST",
    file: "connections/[id]/storage",
    pattern: `${CONN}/storage`,
    requiredScopes: ["storage:write"],
    clusterObject: true,
    secondaryConnections: [{ source: "body", field: "pbsConnectionId" }],
    summary: "Add a storage to a cluster",
    description:
      "With `type: pbs` (the default), adds a `pbs:` storage pointing at a datastore of the PBS connection `pbsConnectionId`, which must also be inside the token perimeter; ProxCenter mints a PBS token scoped to that datastore for the cluster. With nfs, cifs, iscsi, lvm, rbd (external Ceph), cephfs, zfs (ZFS over iSCSI) or dir, adds that storage with its fields, contents, nodes and bandwidth limits; secrets are never returned. Answers 201. Not available to a vDC tenant token.",
    requestSchemaRef: "StorageCreateRequest",
    responseSchemaRef: "StorageCreateResponse",
  }),
  storageEntry({
    id: "storage-detach",
    method: "DELETE",
    file: "connections/[id]/storage/[storage]",
    pattern: `${CONN}/storage/{storage}`,
    requiredScopes: ["storage:write"],
    clusterObject: true,
    summary: "Remove a storage from a cluster",
    description:
      "A `pbs:` storage is detached and the PBS token ProxCenter minted for it revoked, unless another cluster still uses that token (`data.token` says which); the backups stay on the PBS. Any other storage is removed from storage.cfg, its data left in place: refused with 409 `STORAGE_IN_USE` while a guest volume sits on it, a backup job writes to it or another storage is built on it, and with 409 `STORAGE_USAGE_UNVERIFIED` when a node could not be read, unless `force=1`. Not available to a vDC tenant token.",
    queryParams: [{ name: "force", description: "1 removes it although a node could not be read", required: false }],
    responseSchemaRef: "StorageDetachResponse",
  }),
  storageEntry({
    id: "storage-config-read",
    method: "GET",
    file: "connections/[id]/storage/[storage]",
    pattern: `${CONN}/storage/{storage}`,
    requiredScopes: STORAGE_READ_SCOPES,
    clusterObject: true,
    summary: "Configuration of a cluster storage",
    description: "The storage.cfg entry of {storage}, without its secrets (password, keyring). Needs connection.manage. Not available to a vDC tenant token.",
    responseSchemaRef: "StorageConfigResponse",
  }),
  storageEntry({
    id: "storage-update",
    method: "PUT",
    file: "connections/[id]/storage/[storage]",
    pattern: `${CONN}/storage/{storage}`,
    requiredScopes: ["storage:write"],
    clusterObject: true,
    summary: "Edit a cluster storage",
    description:
      "Changes the contents, nodes, enabled flag, bandwidth limits and the editable fields of an nfs, cifs, iscsi, lvm, rbd, cephfs, zfs or dir storage; the fields Proxmox fixes at creation are ignored and a blank secret keeps the stored one. Not available to a vDC tenant token.",
    requestSchemaRef: "StorageUpdateRequest",
    responseSchemaRef: "StorageUpdateResponse",
  }),
  storageEntry({
    id: "storage-scan",
    method: "POST",
    file: "connections/[id]/nodes/[node]/storage-scan",
    pattern: `${CONN}/nodes/{node}/storage-scan`,
    requiredScopes: ["storage:write"],
    clusterObject: true,
    summary: "Test a storage target from a node",
    description:
      "Runs one Proxmox scan from {node}: NFS exports, CIFS shares (wrong credentials are reported), iSCSI targets, or the node's LVM volume groups. One scan at a time per node: 409 `SCAN_BUSY` while one runs, 504 `SCAN_TIMEOUT` after 20 s (the node may still be working on it). Not available to a vDC tenant token.",
    requestSchemaRef: "StorageScanRequest",
    responseSchemaRef: "StorageScanResponse",
  }),
  storageEntry({
    id: "storage-content-delete",
    method: "DELETE",
    file: `${NODE_STORAGE_FILE}/content/[volid]`,
    pattern: `${NODE_STORAGE}/content/{volid}`,
    requiredScopes: ["storage:write"],
    encodedSlashSegment: "volid",
    summary: "Delete a storage volume",
    description:
      "Deletes the volume {volid} (e.g. `local:iso/debian.iso`) from {storage} on {node}, URL-encoded as a single segment (`/` as %2F). A vDC tenant token only deletes the ISO and import files of its own tenant on its writable storages. Irreversible.",
    responseSchemaRef: "SuccessResponse",
  }),
  storageEntry({
    id: "storage-download-url",
    method: "POST",
    file: `${NODE_STORAGE_FILE}/download-url`,
    pattern: `${NODE_STORAGE}/download-url`,
    requiredScopes: ["storage:write"],
    summary: "Download a file from a URL to a storage",
    description:
      "Has {node} fetch `url` into {storage} as `filename` (an ISO, a container template, an import image). The Proxmox token of the connection needs Datastore.AllocateTemplate on the storage and Sys.AccessNetwork on the node. A token may only name an http or https URL (else 403). Not available to a vDC tenant token: the node would fetch the URL from the provider network.",
    requestSchemaRef: "StorageDownloadUrlRequest",
    responseSchemaRef: "StorageTaskResponse",
  }),
  storageEntry({
    id: "aplinfo-list",
    method: "GET",
    file: "connections/[id]/nodes/[node]/aplinfo",
    pattern: `${CONN}/nodes/{node}/aplinfo`,
    requiredScopes: STORAGE_READ_SCOPES,
    secondaryPermissions: ["vm.view"],
    summary: "Container templates available for download",
    description: "The container templates of the Proxmox online repository, as seen by {node}. Needs vm.view on the cluster (scope vms:read).",
    responseSchemaRef: "AplinfoResponse",
  }),
  storageEntry({
    id: "aplinfo-download",
    method: "POST",
    file: "connections/[id]/nodes/[node]/aplinfo",
    pattern: `${CONN}/nodes/{node}/aplinfo`,
    requiredScopes: ["storage:write"],
    clusterObject: true,
    summary: "Download a container template",
    description: "Has {node} download the repository template `template` into `storage`. Not available to a vDC tenant token.",
    requestSchemaRef: "AplinfoDownloadRequest",
    responseSchemaRef: "StorageTaskResponse",
  }),
]
