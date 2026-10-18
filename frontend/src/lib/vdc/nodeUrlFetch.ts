import { getTenantInfrastructureScope } from "@/lib/tenant/infraScope"

/**
 * Whether a URL this tenant supplies may be fetched by a Proxmox node: a
 * storage download-url, or a custom image deployed from a URL. The node
 * fetches it itself, follows redirects and resolves the name on its own, so no
 * check made before the fetch keeps it off the provider's private network: a
 * vDC (iaas) tenant may not. Provider and MSP tenants keep it.
 */
export async function isNodeUrlFetchRefused(tenantId: string): Promise<boolean> {
  return (await getTenantInfrastructureScope(tenantId, { ignoreVdcContext: true })).kind === "iaas"
}

export const URL_IMAGE_REFUSED =
  "Images from a URL are not available to a vDC tenant: upload the image to a storage and declare it as a volume"
