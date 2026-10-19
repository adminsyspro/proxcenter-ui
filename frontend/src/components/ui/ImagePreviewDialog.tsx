'use client'

import { Box, Dialog, DialogContent, DialogTitle, Typography } from '@mui/material'

/** One screenshot at full size: a label, an optional capture time on the right, the image. */
export default function ImagePreviewDialog({ open, src, label, capturedAt, onClose }: {
  open: boolean
  src: string
  label: string
  /** Already formatted and translated, shown as is. */
  capturedAt?: string
  onClose: () => void
}) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth='md' fullWidth>
      {open && (
        <>
          <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <i className='ri-computer-line' style={{ fontSize: 18, opacity: 0.7 }} />
            {label}
            {capturedAt && (
              <Typography variant='caption' sx={{ color: 'text.secondary', ml: 'auto' }}>
                {capturedAt}
              </Typography>
            )}
          </DialogTitle>
          <DialogContent>
            <Box
              component='img'
              src={src}
              alt={label}
              sx={{ maxWidth: '100%', display: 'block', borderRadius: 1, mx: 'auto' }}
            />
          </DialogContent>
        </>
      )}
    </Dialog>
  )
}
