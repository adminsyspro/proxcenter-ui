// Cloud-init secrets never leave a blueprint or a deployment record
// (roadmap#265). Blueprints are listed to every tenant they are shared or
// granted with and, since API tokens read them, to scripts too; a password
// saved with a deployment before this rule (saveAsBlueprint kept the whole
// cloud-init object) is dropped on the way out.

/** The row without the cloud-init password; the row given is left untouched. */
export function withoutCloudInitSecrets<T extends { cloudInit?: unknown }>(row: T): T {
  const cloudInit = row.cloudInit
  if (!cloudInit || typeof cloudInit !== 'object' || Array.isArray(cloudInit) || !('cipassword' in cloudInit)) return row
  const { cipassword: _secret, ...rest } = cloudInit as Record<string, unknown>
  return { ...row, cloudInit: rest }
}
