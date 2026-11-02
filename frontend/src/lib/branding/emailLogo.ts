// PNG copy of the white-label logo for the notification emails.
//
// The orchestrator embeds the logo in every email it sends, and email clients
// only display PNG, JPEG and GIF: Gmail and Outlook show nothing for an SVG,
// a WEBP or an ICO, which are formats the branding page accepts (and SVG is
// the one we recommend). So every time the logo changes, a PNG copy sized for
// the email header is stored next to it, in the `logo-email` slot the
// orchestrator reads first. When no copy can be made (an ICO, which sharp
// cannot decode, or a corrupt file), the slot is emptied rather than left
// holding the previous logo, and the emails show the brand name as text.

import sharp from 'sharp'

import { prisma } from '@/lib/db/prisma'

import { deleteAsset, getAsset, putAsset } from './assetStore'

export const LOGO_SLOT = 'logo'
export const EMAIL_LOGO_SLOT = 'logo-email'

// Twice the 40 px header height (sharp on high-density screens), and at most
// twice the 200 px the header allows a wide wordmark.
const EMAIL_LOGO_HEIGHT = 80
const EMAIL_LOGO_MAX_WIDTH = 400

// Rasterises an SVG at a resolution that survives the resize to 80 px.
const SVG_DENSITY = 300

/** Renders `source` as a PNG fitting the email header, or null when it cannot be decoded. */
export async function renderEmailLogo(source: Buffer): Promise<Buffer | null> {
  try {
    return await sharp(source, { density: SVG_DENSITY })
      .resize({ width: EMAIL_LOGO_MAX_WIDTH, height: EMAIL_LOGO_HEIGHT, fit: 'inside' })
      .png({ compressionLevel: 9 })
      .toBuffer()
  } catch {
    return null
  }
}

/**
 * Brings the tenant's email copy in line with its logo: rendered from
 * `source`, or removed when there is no logo or it cannot be rendered.
 * Returns whether a copy is stored.
 */
export async function syncEmailLogo(tenantId: string, source: Buffer | null): Promise<boolean> {
  const png = source ? await renderEmailLogo(source) : null

  if (!png) {
    await deleteAsset(tenantId, 'branding', EMAIL_LOGO_SLOT)

    return false
  }

  await putAsset(tenantId, 'branding', EMAIL_LOGO_SLOT, 'png', 'image/png', png)

  return true
}

/**
 * Startup backfill: gives an email copy to every logo uploaded before the
 * copies existed. Only tenants missing one are rendered, so later boots do
 * nothing. Returns how many copies were created.
 */
export async function backfillEmailLogos(): Promise<number> {
  const rows = await prisma.uploadedAsset.findMany({
    where: { kind: 'branding', slot: { in: [LOGO_SLOT, EMAIL_LOGO_SLOT] } },
    select: { tenantId: true, slot: true },
  })

  const withCopy = new Set(rows.filter(r => r.slot === EMAIL_LOGO_SLOT).map(r => r.tenantId))
  const missing = rows.filter(r => r.slot === LOGO_SLOT && !withCopy.has(r.tenantId)).map(r => r.tenantId)

  let created = 0

  for (const tenantId of missing) {
    const logo = await getAsset(tenantId, 'branding', LOGO_SLOT)

    if (logo && (await syncEmailLogo(tenantId, logo.data))) created++
  }

  return created
}
