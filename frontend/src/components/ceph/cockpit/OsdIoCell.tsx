'use client'

import { Box, Tooltip, Typography } from '@mui/material'
import { useFormatter, useTranslations } from 'next-intl'

import { exporterHelp, type ExporterFailure } from '@/lib/ceph/exporterFailure'
import { formatByteRate, formatOps } from '@/lib/ceph/ioFormat'
import type { OsdIoPoint } from '@/lib/ceph/osdIo'

import type { OsdIoNodeState } from './hooks/useOsdIoColumns'
import { SparkLines, TABULAR } from './ui'

/*
   IOPS and throughput cells of the two OSD tables (cockpit OSD tab, CRUSH tree of the inventory Ceph tab):
   the current read and write rates on one line, then a small curve (read solid, write dashed). The width
   is fixed per kind so the columns of every row line up, as the latency column does.
*/

export type OsdIoKind = 'ops' | 'bytes'

const SPARK_WIDTH = 44
const SPARK_HEIGHT = 18
export const OSD_IO_CELL_WIDTH: Record<OsdIoKind, number> = { ops: 116, bytes: 186 }

interface Props {
  kind: OsdIoKind
  /** Latest measured rate of the OSD; undefined until two readings exist. */
  current: OsdIoPoint | undefined
  series: readonly OsdIoPoint[]
  /** State of the exporter of the OSD's node (`pending` before the first reading). */
  state: OsdIoNodeState | 'pending'
  /** The OSD maps to no PVE node: nothing can be read. */
  noNode?: boolean
  /** The OSD is down: with no rate to show, a dash instead of the ellipsis of a measure in progress. */
  up?: boolean
  port: number
  /** The PVE node of the OSD, named in the explanation of a node that is down. */
  node?: string | null
  /** Why the exporter of the node is not read (`down` only); absent: the generic explanation. */
  reason?: ExporterFailure | null
  /** The curve is the session's own (Community) or Live without history. */
  session: boolean
}

export function useIoFormat() {
  const format = useFormatter()

  return { ops: (v: number) => formatOps(format, v), bytes: (v: number) => formatByteRate(format, v) }
}

export default function OsdIoCell({ kind, current, series, state, noNode, up, port, node, reason, session }: Readonly<Props>) {
  const t = useTranslations('cephCockpit')
  const fmt = useIoFormat()
  const width = OSD_IO_CELL_WIDTH[kind]
  const box = { display: 'inline-flex', alignItems: 'center', gap: 1, width, ...TABULAR, fontSize: 12.5 } as const

  const downTitle = () => {
    const help = exporterHelp(reason, !!node)

    return t(`osd.activity.${help.messageKey}`, { port, node: node ?? '' })
  }

  if (state === 'down' || state === 'error' || noNode) {
    const title = noNode ? t('osd.io.noNode') : state === 'down' ? downTitle() : t('osd.io.unavailable')

    return (
      <Tooltip title={title}>
        <Box component='span' data-testid='osd-io-absent' data-kind={kind} tabIndex={0} aria-label={title} sx={{ ...box, color: 'text.disabled' }}>{t('overview.missing')}</Box>
      </Tooltip>
    )
  }

  if (!current && up === false) {
    return <Box component='span' data-testid='osd-io-down' data-kind={kind} sx={{ ...box, color: 'text.disabled' }}>{t('overview.missing')}</Box>
  }

  if (!current) {
    return <Box component='span' data-testid='osd-io-measuring' data-kind={kind} aria-label={t('osd.io.measuring')} sx={{ ...box, color: 'text.disabled' }}>…</Box>
  }

  const pick = (p: OsdIoPoint) => (kind === 'ops' ? [p.readOps, p.writeOps] : [p.readBytes, p.writeBytes])
  const [read, write] = pick(current)
  const f = kind === 'ops' ? fmt.ops : fmt.bytes
  const label = t(session ? 'osd.io.tooltipSession' : 'osd.io.tooltip', { read: f(read), write: f(write) })

  return (
    <Tooltip title={label}>
      <Box component='span' data-testid='osd-io-cell' data-kind={kind} role='img' aria-label={label} sx={box}>
        <Box component='span' sx={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap' }}>
          <Typography component='span' sx={{ fontSize: 'inherit', color: 'text.secondary' }}>{t('osd.io.readShort')}</Typography>
          {` ${f(read)} `}
          <Typography component='span' sx={{ fontSize: 'inherit', color: 'text.secondary' }}>{t('osd.io.writeShort')}</Typography>
          {` ${f(write)}`}
        </Box>
        <Box component='span' sx={{ display: 'inline-block', width: SPARK_WIDTH, height: SPARK_HEIGHT, flexShrink: 0 }}>
          {series.length >= 2 && (
            <SparkLines
              height={SPARK_HEIGHT}
              series={[
                { data: series.map(p => pick(p)[0]), tone: 'read' },
                { data: series.map(p => pick(p)[1]), tone: 'write', dashed: true },
              ]}
            />
          )}
        </Box>
      </Box>
    </Tooltip>
  )
}
