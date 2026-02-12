'use client'

import { useState } from 'react'
import {
  Button,
  CircularProgress,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
} from '@mui/material'
import { useTranslations } from 'next-intl'

import type { KpiData, ResourceTrend, TopVm, OverprovisioningData } from '../types'
import { DownloadIcon } from './icons'

async function exportPdf() {
  const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
    import('jspdf'),
    import('html2canvas'),
  ])

  const el = document.getElementById('resource-planner-content')
  if (!el) return

  const canvas = await html2canvas(el, { scale: 1.5, useCORS: true, logging: false })
  const imgData = canvas.toDataURL('image/png')
  const pdf = new jsPDF('p', 'mm', 'a4')

  const pdfWidth = pdf.internal.pageSize.getWidth()
  const pdfHeight = pdf.internal.pageSize.getHeight()
  const imgWidth = pdfWidth - 20
  const imgHeight = (canvas.height * imgWidth) / canvas.width

  let heightLeft = imgHeight
  let position = 10

  pdf.addImage(imgData, 'PNG', 10, position, imgWidth, imgHeight)
  heightLeft -= pdfHeight

  while (heightLeft > 0) {
    position = heightLeft - imgHeight + 10
    pdf.addPage()
    pdf.addImage(imgData, 'PNG', 10, position, imgWidth, imgHeight)
    heightLeft -= pdfHeight
  }

  pdf.save(`resource-planner-${new Date().toISOString().split('T')[0]}.pdf`)
}

function exportExcel(kpis: KpiData | null, trends: ResourceTrend[], topCpuVms: TopVm[], topRamVms: TopVm[], overprovisioning: OverprovisioningData | null) {
  import('xlsx').then(({ utils, writeFile }) => {
    const wb = utils.book_new()

    // KPIs sheet
    if (kpis) {
      const kpiRows = [
        { Metric: 'CPU Used %', Value: kpis.cpu.used },
        { Metric: 'CPU Allocated', Value: kpis.cpu.allocated },
        { Metric: 'CPU Total', Value: kpis.cpu.total },
        { Metric: 'RAM Used %', Value: kpis.ram.used },
        { Metric: 'Storage Used', Value: kpis.storage.used },
        { Metric: 'Storage Total', Value: kpis.storage.total },
        { Metric: 'Total VMs', Value: kpis.vms.total },
        { Metric: 'Running VMs', Value: kpis.vms.running },
        { Metric: 'Stopped VMs', Value: kpis.vms.stopped },
        { Metric: 'Efficiency %', Value: kpis.efficiency },
      ]
      const ws = utils.json_to_sheet(kpiRows)
      utils.book_append_sheet(wb, ws, 'KPIs')
    }

    // Trends sheet
    if (trends.length) {
      const trendRows = trends.map(t => ({
        Date: t.t,
        CPU: t.cpu,
        RAM: t.ram,
        Storage: t.storage ?? '',
        'CPU Projection': t.cpuProjection ?? '',
        'RAM Projection': t.ramProjection ?? '',
        'Storage Projection': t.storageProjection ?? '',
      }))
      const ws = utils.json_to_sheet(trendRows)
      utils.book_append_sheet(wb, ws, 'Trends')
    }

    // Top VMs sheet
    const vmRows = [
      ...topCpuVms.map(vm => ({ List: 'Top CPU', Name: vm.name, Node: vm.node, 'CPU %': vm.cpu, 'RAM %': vm.ram })),
      ...topRamVms.map(vm => ({ List: 'Top RAM', Name: vm.name, Node: vm.node, 'CPU %': vm.cpu, 'RAM %': vm.ram })),
    ]
    if (vmRows.length) {
      const ws = utils.json_to_sheet(vmRows)
      utils.book_append_sheet(wb, ws, 'Top VMs')
    }

    // Overprovisioning sheet
    if (overprovisioning) {
      const opRows = overprovisioning.perNode.map(n => ({
        Node: n.name,
        'CPU Ratio': n.cpuRatio,
        'RAM Ratio': n.ramRatio,
        'CPU Allocated': n.cpuAllocated,
        'CPU Physical': n.cpuPhysical,
        'RAM Allocated GB': n.ramAllocated,
        'RAM Physical GB': n.ramPhysical,
      }))
      const ws = utils.json_to_sheet(opRows)
      utils.book_append_sheet(wb, ws, 'Overprovisioning')
    }

    writeFile(wb, `resource-planner-${new Date().toISOString().split('T')[0]}.xlsx`)
  })
}

export default function ExportMenu({ kpis, trends, topCpuVms, topRamVms, overprovisioning }: {
  kpis: KpiData | null
  trends: ResourceTrend[]
  topCpuVms: TopVm[]
  topRamVms: TopVm[]
  overprovisioning: OverprovisioningData | null
}) {
  const t = useTranslations()
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null)
  const [exporting, setExporting] = useState(false)

  const handlePdf = async () => {
    setExporting(true)
    setAnchorEl(null)
    try { await exportPdf() } finally { setExporting(false) }
  }

  const handleExcel = () => {
    setAnchorEl(null)
    exportExcel(kpis, trends, topCpuVms, topRamVms, overprovisioning)
  }

  return (
    <>
      <Button
        variant="outlined"
        size="small"
        startIcon={exporting ? <CircularProgress size={16} /> : <DownloadIcon />}
        onClick={(e) => setAnchorEl(e.currentTarget)}
        disabled={exporting}
        sx={{ borderRadius: 2, textTransform: 'none' }}
      >
        {t('resources.export')}
      </Button>
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}>
        <MenuItem onClick={handlePdf}>
          <ListItemIcon><i className="ri-file-pdf-line" style={{ fontSize: 18 }} /></ListItemIcon>
          <ListItemText>PDF</ListItemText>
        </MenuItem>
        <MenuItem onClick={handleExcel}>
          <ListItemIcon><i className="ri-file-excel-line" style={{ fontSize: 18 }} /></ListItemIcon>
          <ListItemText>Excel</ListItemText>
        </MenuItem>
      </Menu>
    </>
  )
}
