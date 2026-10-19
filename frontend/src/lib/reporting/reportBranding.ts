// src/lib/reporting/reportBranding.ts
//
// Branding of a server-rendered PDF report: colour, logo and white-label
// name of the current tenant, the logo inlined as a data URI because
// WeasyPrint runs with base_url=None. Every failure falls back to the
// ProxCenter defaults: branding never breaks a report.

import fs from 'node:fs'
import path from 'node:path'

import { getAsset, slotFromFilename } from '@/lib/branding/assetStore'
import { getSettingWithSource } from '@/lib/db/settings'
import { getCurrentTenantId } from '@/lib/tenant'

export interface ReportBranding {
  brandColor: string
  logoDataUri: string

  /** White-label application name, empty for ProxCenter. */
  appName: string
}

export async function resolveReportBranding(): Promise<ReportBranding> {
  let brandColor = '#E57000'
  let logoDataUri = ''
  let appName = ''
  try {
    const tenantId = await getCurrentTenantId()
    const resolvedBranding = await getSettingWithSource<any>('branding', tenantId)
    const branding = resolvedBranding?.value
    if (branding?.enabled && branding?.primaryColor) {
      brandColor = String(branding.primaryColor)
    }

    // #681: the colour and the logo were already honoured, the name was not,
    // so a white-labelled report still read "ProxCenter" on its cover.
    if (branding?.enabled && branding?.appName) {
      appName = String(branding.appName)
    }

    const brandingLogoUrl = branding?.enabled ? branding?.logoUrl : ''
    if (brandingLogoUrl) {
      // path.basename strips any traversal in the stored URL, then we map
      // the served filename back to its storage slot (logo/favicon/...).
      const filename = path.basename(String(brandingLogoUrl).split('?')[0])
      const asset = await getAsset(resolvedBranding!.tenantId, 'branding', slotFromFilename(filename))
      if (asset) {
        logoDataUri = `data:${asset.contentType};base64,${Buffer.from(asset.data).toString('base64')}`
      }
    }
    if (!logoDataUri) {
      const def = path.join(process.cwd(), 'public', 'images', 'proxcenter.png')
      if (fs.existsSync(def)) {
        logoDataUri = `data:image/png;base64,${fs.readFileSync(def).toString('base64')}`
      }
    }
  } catch {
    // Branding/logo failures are non-fatal; the report renders with defaults.
  }
  return { brandColor, logoDataUri, appName }
}
