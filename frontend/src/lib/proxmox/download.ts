import { pveFetch } from './client'

export class PveDownloadPermissionError extends Error {
  readonly statusCode = 403
}

type Permissions = Record<string, Record<string, number>>

/** PVE values indicate propagation, not whether the privilege is granted:
 *  a present privilege with value 0 is granted at this exact path. */
function hasPrivilege(permissions: Permissions, path: string, privilege: string) {
  const value = permissions?.[path]?.[privilege]
  return value === 0 || value === 1
}

/** Shared by template deployment and the storage download dialog. Probe the
 *  authenticated token's effective permissions, never its owner's privileges.
 *  Call only when a download is needed (cached images need no network rights). */
export async function downloadToStorage(
  conn: Parameters<typeof pveFetch>[0],
  node: string,
  storage: string,
  params: URLSearchParams,
): Promise<string> {
  const nodePath = `/nodes/${node}`
  const storagePath = `/storage/${storage}`
  const [rootPermissions, nodePermissions, storagePermissions] = await Promise.all(
    ['/', nodePath, storagePath].map(path =>
      pveFetch<Permissions>(conn, `/access/permissions?${new URLSearchParams({ path })}`),
    ),
  )
  const missing: string[] = []
  if (!hasPrivilege(storagePermissions, storagePath, 'Datastore.AllocateTemplate')) {
    missing.push(`Datastore.AllocateTemplate on ${storagePath}`)
  }
  if (!hasPrivilege(nodePermissions, nodePath, 'Sys.AccessNetwork') &&
      !(hasPrivilege(rootPermissions, '/', 'Sys.Audit') && hasPrivilege(rootPermissions, '/', 'Sys.Modify'))) {
    missing.push(`Sys.AccessNetwork on ${nodePath} (or both Sys.Audit and Sys.Modify on /)`)
  }
  const guidance = 'PVEAdmin alone does not authorize URL downloads. With token privilege separation enabled, check both the user and token ACLs.'
  if (missing.length) {
    throw new PveDownloadPermissionError(`Cannot download to storage '${storage}' on node '${node}': the connection's API token is missing ${missing.join(' and ')}. ${guidance}`)
  }

  try {
    return await pveFetch<string>(conn,
      `/nodes/${encodeURIComponent(node)}/storage/${encodeURIComponent(storage)}/download-url`,
      { method: 'POST', body: params },
    )
  } catch (err: any) {
    // ACLs may change after preflight; retain a useful 403 in that case too.
    if (err?.statusCode !== 403) throw err
    throw new PveDownloadPermissionError(
      `Proxmox refused the download to '${storage}' on '${node}' after the permission check. ` +
      `Recheck Datastore.AllocateTemplate on ${storagePath} and Sys.AccessNetwork on ${nodePath} ` +
      `(or Sys.Audit and Sys.Modify on /). ${guidance} Original error: ${err.message}`,
    )
  }
}
