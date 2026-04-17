'use client'

import { useState } from 'react'

import Box from '@mui/material/Box'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import { useTranslations } from 'next-intl'

import ClusterSdnZonesPanel from './ClusterSdnZonesPanel'
import ClusterSdnVNetsPanel from './ClusterSdnVNetsPanel'
import ClusterSdnOptionsPanel from './ClusterSdnOptionsPanel'
import ClusterSdnIpamPanel from './ClusterSdnIpamPanel'
import ClusterSdnVNetFirewallPanel from './ClusterSdnVNetFirewallPanel'
import ClusterSdnFabricsPanel from './ClusterSdnFabricsPanel'

interface Props {
  connId: string
}

export default function ClusterSdnTab({ connId }: Props) {
  const t = useTranslations()
  const [sdnTab, setSdnTab] = useState(0)

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* Apply button + pending banner strip is added in Task 8 */}

      <Tabs
        value={sdnTab}
        onChange={(_e, v) => setSdnTab(v)}
        sx={{ borderBottom: 1, borderColor: 'divider', px: 2 }}
        variant="scrollable"
        scrollButtons="auto"
      >
        <Tab label={<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <i className="ri-grid-line" style={{ fontSize: 16 }} />
          {t('sdn.subtab.zones')}
        </Box>} />
        <Tab label={<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <i className="ri-share-line" style={{ fontSize: 16 }} />
          {t('sdn.subtab.vnets')}
        </Box>} />
        <Tab label={<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <i className="ri-settings-3-line" style={{ fontSize: 16 }} />
          {t('sdn.subtab.options')}
        </Box>} />
        <Tab label={<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <i className="ri-router-line" style={{ fontSize: 16 }} />
          {t('sdn.subtab.ipam')}
        </Box>} />
        <Tab label={<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <i className="ri-shield-keyhole-line" style={{ fontSize: 16 }} />
          {t('sdn.subtab.vnetFirewall')}
        </Box>} />
        <Tab label={<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <i className="ri-node-tree" style={{ fontSize: 16 }} />
          {t('sdn.subtab.fabrics')}
        </Box>} />
      </Tabs>

      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {sdnTab === 0 && <ClusterSdnZonesPanel connId={connId} />}
        {sdnTab === 1 && <ClusterSdnVNetsPanel connId={connId} />}
        {sdnTab === 2 && <ClusterSdnOptionsPanel connId={connId} />}
        {sdnTab === 3 && <ClusterSdnIpamPanel connId={connId} />}
        {sdnTab === 4 && <ClusterSdnVNetFirewallPanel connId={connId} />}
        {sdnTab === 5 && <ClusterSdnFabricsPanel connId={connId} />}
      </Box>
    </Box>
  )
}
