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
    summary: "Attach a PBS datastore to a cluster",
    description:
      "Adds a `pbs:` storage pointing at a datastore of the PBS connection `pbsConnectionId`, which must also be inside the token perimeter. ProxCenter mints a PBS token scoped to that datastore for the cluster. Answers 201. Not available to a vDC tenant token.",
    requestSchemaRef: "StorageAttachPbsRequest",
    responseSchemaRef: "StorageAttachPbsResponse",
  }),
  storageEntry({
    id: "storage-detach",
    method: "DELETE",
    file: "connections/[id]/storage/[storage]",
    pattern: `${CONN}/storage/{storage}`,
    requiredScopes: ["storage:write"],
    clusterObject: true,
    summary: "Detach a PBS storage from a cluster",
    description:
      "Removes the `pbs:` storage {storage} from the cluster and revokes the PBS token ProxCenter minted for it, unless another cluster still uses that token (`data.token` says which). The backups stay on the PBS. Not available to a vDC tenant token.",
    responseSchemaRef: "StorageDetachResponse",
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
