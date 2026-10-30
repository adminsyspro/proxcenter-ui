'use client'

import type { ReactNode } from 'react'

import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

import {
  Box,
  Chip,
  Divider,
  Link,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography
} from '@mui/material'
import { alpha } from '@mui/material/styles'

// The models tag findings as "[CRIT] Ceph PVE-DR: HEALTH_ERR" (#459): shown
// as a coloured badge instead of bracketed text.
type SeverityColor = 'error' | 'warning' | 'info' | 'success'

const SEVERITY_TAGS: Record<string, SeverityColor> = {
  CRIT: 'error',
  CRITICAL: 'error',
  ERR: 'error',
  ERROR: 'error',
  WARN: 'warning',
  WARNING: 'warning',
  INFO: 'info',
  OK: 'success'
}

export const severityOf = (children: ReactNode): { label: string; color: SeverityColor } | null => {
  const text = Array.isArray(children) && children.length === 1 ? children[0] : children
  const match = typeof text === 'string' ? /^\[([A-Z]+)\]$/.exec(text.trim()) : null

  return match && SEVERITY_TAGS[match[1]] ? { label: match[1], color: SEVERITY_TAGS[match[1]] } : null
}

const SeverityChip = ({ label, color }: { label: string; color: SeverityColor }) => (
  <Chip
    label={label}
    color={color}
    size='small'
    variant='outlined'
    sx={{ height: 18, fontSize: '0.6875rem', fontWeight: 700, letterSpacing: 0.3, verticalAlign: 'text-bottom' }}
  />
)

const COMPONENTS: Components = {
  h1: ({ children }) => (
    <Typography component='h3' sx={{ fontSize: '1.0625rem', fontWeight: 700, mt: 1, mb: 3 }}>
      {children}
    </Typography>
  ),
  h2: ({ children }) => (
    <Typography
      component='h4'
      sx={{ fontSize: '0.9375rem', fontWeight: 700, mt: 6, mb: 2, pb: 1.5, borderBottom: 1, borderColor: 'divider' }}
    >
      {children}
    </Typography>
  ),
  h3: ({ children }) => (
    <Typography component='h5' sx={{ fontSize: '0.875rem', fontWeight: 600, mt: 4, mb: 1.5 }}>
      {children}
    </Typography>
  ),
  h4: ({ children }) => (
    <Typography component='h6' variant='body2' sx={{ fontWeight: 600, color: 'text.secondary', mt: 3, mb: 1 }}>
      {children}
    </Typography>
  ),
  p: ({ children }) => (
    <Typography component='p' sx={{ fontSize: '0.875rem', my: 2, lineHeight: 1.65 }}>
      {children}
    </Typography>
  ),
  ul: ({ children }) => (
    <Box component='ul' sx={{ pl: 5, my: 2 }}>
      {children}
    </Box>
  ),
  ol: ({ children, start }) => (
    <Box component='ol' start={start} sx={{ pl: 6, my: 2 }}>
      {children}
    </Box>
  ),
  li: ({ children }) => (
    <Typography
      component='li'
      sx={{ fontSize: '0.875rem', lineHeight: 1.65, mb: 1, '&::marker': { color: 'text.secondary' }, '& > p': { my: 0 } }}
    >
      {children}
    </Typography>
  ),
  strong: ({ children }) => {
    const severity = severityOf(children)

    return severity ? <SeverityChip {...severity} /> : <Box component='strong' sx={{ fontWeight: 600 }}>{children}</Box>
  },
  a: ({ href, children }) => (
    <Link href={href} target='_blank' rel='noopener noreferrer' underline='hover'>
      {children}
    </Link>
  ),
  blockquote: ({ children }) => (
    <Box
      component='blockquote'
      sx={{ m: 0, my: 3, pl: 3, borderLeft: 3, borderColor: 'primary.main', color: 'text.secondary' }}
    >
      {children}
    </Box>
  ),
  hr: () => <Divider sx={{ my: 4 }} />,

  // Inline code keeps the body font (a VM name, an ID); only a fenced block,
  // a command or an excerpt of a log, is set in monospace.
  code: ({ children }) => (
    <Box
      component='code'
      sx={theme => ({
        px: 1,
        py: 0.25,
        borderRadius: 0.5,
        fontSize: '0.92em',
        bgcolor: alpha(theme.palette.text.primary, 0.07)
      })}
    >
      {children}
    </Box>
  ),
  pre: ({ children }) => (
    <Box
      component='pre'
      sx={theme => ({
        my: 3,
        p: 3,
        borderRadius: 1,
        overflowX: 'auto',
        fontSize: '0.8125rem',
        lineHeight: 1.5,
        bgcolor: alpha(theme.palette.text.primary, 0.05),
        border: 1,
        borderColor: 'divider',
        '& code': { p: 0, bgcolor: 'transparent', fontFamily: 'monospace', fontSize: 'inherit' }
      })}
    >
      {children}
    </Box>
  ),

  table: ({ children }) => (
    <TableContainer
      sx={{ my: 3, border: 1, borderColor: 'divider', borderRadius: 1, overflowX: 'auto' }}
    >
      <Table
        size='small'
        sx={{
          '& td, & th': { px: 2.5, py: 1.5, fontSize: '0.8125rem', fontVariantNumeric: 'tabular-nums', wordBreak: 'normal' },
          // The first column names the row (a host, a VM): never broken.
          '& td:first-of-type': { whiteSpace: 'nowrap', fontWeight: 500 },
          '& tbody tr:last-of-type td': { borderBottom: 0 }
        }}
      >
        {children}
      </Table>
    </TableContainer>
  ),
  thead: ({ children }) => <TableHead sx={{ bgcolor: 'action.hover' }}>{children}</TableHead>,
  tbody: ({ children }) => <TableBody>{children}</TableBody>,
  tr: ({ children }) => <TableRow hover>{children}</TableRow>,

  // remark-gfm hands the column alignment over as a `text-align` style.
  th: ({ children, style }) => (
    <TableCell style={style} sx={{ fontWeight: 600, whiteSpace: 'nowrap', color: 'text.secondary' }}>
      {children}
    </TableCell>
  ),
  td: ({ children, style }) => <TableCell style={style}>{children}</TableCell>
}

/**
 * An assistant answer rendered from the model's Markdown (#459). Raw HTML in
 * the answer is dropped, never interpreted, and links other than
 * http(s) and mailto are dropped by react-markdown's default URL filter.
 */
export default function AIMarkdown({ children }: { children?: string | null }) {
  return (
    <Box sx={{ wordBreak: 'break-word', '& > :first-of-type': { mt: 0 }, '& > :last-child': { mb: 0 } }}>
      <Markdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {children || ''}
      </Markdown>
    </Box>
  )
}
