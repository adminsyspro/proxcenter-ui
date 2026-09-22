'use client'

// Up / down controls for one row of an SSO group-to-role mapping (issue #992).
// The mapping is read from the top down at login time, so the order has to be
// editable; both the LDAP and the OIDC tab mount this same control.

import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import Box from '@mui/material/Box'

const MappingOrderButtons = ({ index, count, disabled, onMove, upLabel, downLabel }) => (
  <Box sx={{ display: 'flex', flexDirection: 'column' }}>
    <Tooltip title={upLabel}>
      {/* A disabled button swallows the pointer events the tooltip needs. */}
      <span>
        <IconButton
          size='small'
          sx={{ p: 0.25 }}
          aria-label={upLabel}
          disabled={disabled || index === 0}
          onClick={() => onMove(index, -1)}
        >
          <i className='ri-arrow-up-s-line' />
        </IconButton>
      </span>
    </Tooltip>
    <Tooltip title={downLabel}>
      <span>
        <IconButton
          size='small'
          sx={{ p: 0.25 }}
          aria-label={downLabel}
          disabled={disabled || index >= count - 1}
          onClick={() => onMove(index, 1)}
        >
          <i className='ri-arrow-down-s-line' />
        </IconButton>
      </span>
    </Tooltip>
  </Box>
)

export default MappingOrderButtons
