'use client'

// MUI Imports
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'

/**
 * Small, consistent header for pages.
 *
 * Usage:
 * <PageHeader title='Clusters' subtitle='Vue multi-clusters...' />
 */
const PageHeader = ({ title, subtitle, right }) => {
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent='space-between' spacing={2}>
      <Box>
        <Typography variant='h4' sx={{ lineHeight: 1.2 }}>
          {title}
        </Typography>
        {subtitle ? (
          <Typography variant='body2' color='text.secondary' sx={{ mt: 1 }}>
            {subtitle}
          </Typography>
        ) : null}
      </Box>
      {right ? <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>{right}</Box> : null}
    </Stack>
  )
}

export default PageHeader
