export const dynamic = "force-dynamic"
import { createUploadedAssetRoute } from '@/lib/branding/serveAsset'

export const GET = createUploadedAssetRoute({
  kind: 'branding',
  dirName: 'branding',
  mimeTypes: {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    svg: 'image/svg+xml',
    webp: 'image/webp',
    ico: 'image/x-icon',
  },
})
