import type { ReactNode } from 'react'

import Box from '@mui/material/Box'

import { modelVendor } from '@/lib/ai/modelVendor'

/** A model name led by its vendor's logo, for the AI settings model pickers. */
export default function LlmModelLabel({ model, children }: { model: string; children?: ReactNode }) {
  const { vendor, icon } = modelVendor(model)

  return (
    <Box component='span' sx={{ display: 'inline-flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
      {/* Fixed slot: vendor logos are not square (Meta is 3:2), the names must still line up. */}
      <Box component='span' aria-hidden sx={{ width: 28, display: 'inline-flex', justifyContent: 'center', flexShrink: 0 }}>
        <Box
          component='i'
          className={icon}
          data-vendor={vendor}
          sx={{ fontSize: 18, color: 'text.primary', opacity: vendor === 'generic' ? 0.6 : 1 }}
        />
      </Box>
      <Box component='span' sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {children ?? model}
      </Box>
    </Box>
  )
}
