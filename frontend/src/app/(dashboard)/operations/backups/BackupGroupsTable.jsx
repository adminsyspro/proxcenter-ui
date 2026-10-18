'use client'

import { Fragment, useMemo, useState } from 'react'
import { Box, Chip, IconButton, LinearProgress, Table, TableBody, TableCell, TableContainer, TableHead, TablePagination, TableRow, TableSortLabel, Typography } from '@mui/material'

import { groupBackupMachines } from '@/lib/backups/machineGroups'

const snapshotFields = new Set(['backupTime', 'sizeFormatted', 'verified', 'protected', 'actions'])

// Pagination counts machines. Expanding one must never consume the remaining
// page slots or let table sorting detach a restore point from its machine.
export default function BackupGroupsTable({ backups, pbsId, columns, loading, totalRows, paginationModel, onPaginationModelChange, onSnapshotClick, t }) {
  const [expanded, setExpanded] = useState(new Set())
  const [sort, setSort] = useState({ field: 'vmName', direction: 'asc' })
  const groups = useMemo(() => {
    const result = groupBackupMachines(backups)
    const column = columns.find(column => column.field === sort.field)
    const value = group => {
      const row = { ...group.latest, vmName: group.vmName }
      return column?.valueGetter ? column.valueGetter(row[sort.field], row) : row[sort.field]
    }
    return result.sort((a, b) => {
      const av = value(a)
      const bv = value(b)
      const comparison = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av ?? '').localeCompare(String(bv ?? ''), undefined, { numeric: true })
      return (sort.direction === 'asc' ? comparison : -comparison) || a.key.localeCompare(b.key)
    })
  }, [backups, columns, sort])
  const toggle = key => setExpanded(previous => {
    const next = new Set(previous)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })
  const renderCell = (column, row) => {
    const value = column.valueGetter ? column.valueGetter(row[column.field], row) : row[column.field]
    return column.renderCell ? column.renderCell({ row, value, field: column.field }) : value
  }

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
      <Box sx={{ height: 3, flexShrink: 0 }}>{loading && <LinearProgress />}</Box>
      <TableContainer sx={{ flex: 1 }} aria-busy={loading}>
        <Table stickyHeader size='small' aria-label={t('backups.title')} sx={{ minWidth: 1050 }}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: 44 }} />
              {columns.map(column => (
                <TableCell key={column.field} align={column.headerAlign} sx={{ minWidth: column.minWidth, width: column.width, whiteSpace: 'nowrap' }}>
                  {column.sortable === false || snapshotFields.has(column.field) ? column.headerName : (
                    <TableSortLabel active={sort.field === column.field} direction={sort.direction}
                      onClick={() => setSort({ field: column.field, direction: sort.field === column.field && sort.direction === 'asc' ? 'desc' : 'asc' })}>
                      {column.headerName}
                    </TableSortLabel>
                  )}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody sx={{ '& .MuiTableCell-root': { py: 0.5, height: 36 } }}>
            {groups.map(group => {
              const key = JSON.stringify([pbsId, group.key])
              const open = expanded.has(key)
              const row = { ...group.latest, vmName: group.vmName }
              const label = group.vmName || `${row.backupType}/${row.backupId}`
              return (
                <Fragment key={key}>
                  <TableRow hover onClick={() => toggle(key)} sx={{ cursor: 'pointer', bgcolor: 'action.hover' }}>
                    <TableCell>
                      <IconButton size='small' aria-label={`${t(open ? 'tasks.collapse' : 'tasks.expand')} ${label}`} aria-expanded={open}
                        onClick={event => { event.stopPropagation(); toggle(key) }}>
                        <i className={open ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} />
                      </IconButton>
                    </TableCell>
                    {columns.map(column => {
                      let content = null
                      if (column.field === 'vmName') content = (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <i className={open ? 'ri-folder-open-line' : 'ri-folder-line'} />
                          <Typography variant='body2' sx={{ fontWeight: 600 }}>{label}</Typography>
                          <Chip size='small' label={group.points.length} aria-label={`${group.points.length} ${t('backups.title')}`} />
                        </Box>
                      )
                      else if (!snapshotFields.has(column.field)) content = renderCell(column, row)
                      return <TableCell key={column.field} align={column.align}>{content}</TableCell>
                    })}
                  </TableRow>
                  {open && group.points.map(point => (
                    <TableRow key={point.id} hover onClick={() => onSnapshotClick(point)} sx={{ cursor: 'pointer' }}>
                      <TableCell />
                      {columns.map(column => (
                        <TableCell key={column.field} align={column.align}
                          onClick={column.field === 'actions' ? event => event.stopPropagation() : undefined}>
                          {renderCell(column, point)}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </Fragment>
              )
            })}
          </TableBody>
        </Table>
      </TableContainer>
      <TablePagination component='div' count={totalRows} page={paginationModel.page} rowsPerPage={paginationModel.pageSize}
        rowsPerPageOptions={[25, 50, 100]} labelRowsPerPage={t('backups.machinesPerPage')}
        onPageChange={(_, page) => onPaginationModelChange({ ...paginationModel, page })}
        onRowsPerPageChange={event => onPaginationModelChange({ page: 0, pageSize: Number(event.target.value) })} />
    </Box>
  )
}
