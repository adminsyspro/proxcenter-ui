export const dynamic = "force-dynamic"
import { createUploadedAssetRoute } from '@/lib/branding/serveAsset'

export const GET = createUploadedAssetRoute({
  kind: 'login-bg',
  dirName: 'login-bg',
  mimeTypes: {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
  },
})
