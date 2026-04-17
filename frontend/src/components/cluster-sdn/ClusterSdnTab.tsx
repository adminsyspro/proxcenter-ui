'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'

import { Box, Tab, Tabs } from '@mui/material'

import ZonesPanel from './panels/ZonesPanel'
import VNetsPanel from './panels/VNetsPanel'
import OptionsPanel from './panels/OptionsPanel'
import IpamAllocationsPanel from './panels/IpamAllocationsPanel'
import VNetFirewallPanel from './panels/VNetFirewallPanel'
import FabricsPanel from './panels/FabricsPanel'

interface Props {
  connectionId: string
}

/**
 * Cluster SDN tab shell.
 *
 * Six sub-tabs corresponding to the Proxmox SDN areas:
 *   0 Zones, 1 VNets, 2 Options, 3 IPAMs, 4 Firewall, 5 Fabrics.
 *
 * This file is only the scaffolding: all panels are stubs in Task 1.
 * Individual panels will be filled in subsequent tasks (2..7).
 */
export default function ClusterSdnTab({ connectionId }: Props) {
  const t = useTranslations()
  const [subTab, setSubTab] = useState(0)

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <Tabs
        value={subTab}
        onChange={(_e, v) => setSubTab(v)}
        sx={{ borderBottom: 1, borderColor: 'divider', px: 2 }}
        variant="scrollable"
        scrollButtons="auto"
      >
        <Tab
          label={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <i className="ri-global-line" style={{ fontSize: 16 }} />
              {t('sdn.subtab.zones')}
            </Box>
          }
        />
        <Tab
          label={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <i className="ri-node-tree" style={{ fontSize: 16 }} />
              {t('sdn.subtab.vnets')}
            </Box>
          }
        />
        <Tab
          label={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <i className="ri-settings-4-line" style={{ fontSize: 16 }} />
              {t('sdn.subtab.options')}
            </Box>
          }
        />
        <Tab
          label={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <i className="ri-list-ordered" style={{ fontSize: 16 }} />
              {t('sdn.subtab.ipams')}
            </Box>
          }
        />
        <Tab
          label={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <i className="ri-shield-keyhole-line" style={{ fontSize: 16 }} />
              {t('sdn.subtab.firewall')}
            </Box>
          }
        />
        <Tab
          label={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <i className="ri-route-line" style={{ fontSize: 16 }} />
              {t('sdn.subtab.fabrics')}
            </Box>
          }
        />
      </Tabs>

      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {subTab === 0 && <ZonesPanel connectionId={connectionId} />}
        {subTab === 1 && <VNetsPanel connectionId={connectionId} />}
        {subTab === 2 && <OptionsPanel connectionId={connectionId} />}
        {subTab === 3 && <IpamAllocationsPanel connectionId={connectionId} />}
        {subTab === 4 && <VNetFirewallPanel connectionId={connectionId} />}
        {subTab === 5 && <FabricsPanel connectionId={connectionId} />}
      </Box>
    </Box>
  )
}
