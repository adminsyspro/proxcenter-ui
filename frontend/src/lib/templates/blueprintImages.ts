/**
 * Pure helpers for the CreateBlueprintDialog image picker and cloud-init save gate.
 *
 * Mirrors the style of deployIpconfig.ts — no side-effects, no imports that
 * require a browser or server context, fully unit-testable.
 */

import type { CloudImage } from './cloudImages'

/** A CloudImage as returned by GET /api/v1/templates/catalog (each entry has isCustom). */
export type CatalogImage = CloudImage & { isCustom?: boolean; isShared?: boolean }

/**
 * Split the flat catalog image array into built-in and custom groups, excluding
 * ISO-format images (which are boot media, not cloud-init images).
 *
 * Order within each group is preserved from the API response.
 */
export function splitCatalogImages(images: CatalogImage[]): {
  builtIn: CatalogImage[]
  custom: CatalogImage[]
} {
  const builtIn: CatalogImage[] = []
  const custom: CatalogImage[] = []

  for (const img of images) {
    // Exclude ISO install media — blueprints are cloud-init presets only.
    if (String(img.format ?? '').toLowerCase() === 'iso') continue

    if (img.isCustom) {
      custom.push(img)
    } else {
      builtIn.push(img)
    }
  }

  return { builtIn, custom }
}

/** The cloud-init shape stored in Blueprint.cloudInit JSONB. */
export interface BlueprintCloudInit {
  ciuser: string
  sshKeys: string
  ipconfig0: string
  nameserver: string
  searchdomain: string
}

/**
 * Returns true when the cloud-init object has at least one meaningful field
 * that differs from the blank defaults.
 *
 * Rules:
 * - ciuser, sshKeys, nameserver, searchdomain: truthy after trim
 * - ipconfig0: truthy after trim AND not equal to 'ip=dhcp' (the form default)
 *
 * cipassword is intentionally excluded — it is never stored in a blueprint.
 */
export function hasMeaningfulCloudInit(ci: BlueprintCloudInit): boolean {
  if (ci.ciuser.trim()) return true
  if (ci.sshKeys.trim()) return true
  if (ci.nameserver.trim()) return true
  if (ci.searchdomain.trim()) return true
  const ip = ci.ipconfig0.trim()
  if (ip && ip !== 'ip=dhcp') return true
  return false
}
