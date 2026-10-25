'use client'

import { Fragment } from 'react'

import { useTranslations } from 'next-intl'

import {
  Box,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Tab,
  Tabs,
  useMediaQuery,
  useTheme
} from '@mui/material'

// Display order of the groups in the side navigation. A tab names its group
// with `group`; a group with no visible tab is not rendered.
export const SETTINGS_NAV_GROUPS = ['infrastructure', 'access', 'monitoring', 'features', 'personalization']

/**
 * Buckets the visible tabs by group, in SETTINGS_NAV_GROUPS order, keeping
 * each tab's index in `tabs` so a click still selects by index.
 */
export function groupSettingsTabs(tabs) {
  return SETTINGS_NAV_GROUPS
    .map(key => ({
      key,
      items: tabs.map((tab, index) => ({ tab, index })).filter(({ tab }) => tab.group === key)
    }))
    .filter(group => group.items.length > 0)
}

/**
 * Top-level navigation of /settings: a grouped vertical list from `md` up, the
 * historical scrollable tab row below it where a side column would eat the
 * content. The sub-tabs inside each panel stay horizontal either way.
 */
export default function SettingsNav({ tabs, value, onChange }) {
  const t = useTranslations()
  const theme = useTheme()
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'))

  if (!isDesktop) {
    return (
      <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 2, pt: 1 }}>
        <Tabs
          value={value}
          onChange={(_, v) => onChange(v)}
          variant='scrollable'
          scrollButtons='auto'
          allowScrollButtonsMobile
          aria-label={t('settings.navAriaLabel')}
          sx={{ '& .MuiTab-root': { minHeight: 48, textTransform: 'none' } }}
        >
          {tabs.map(tab => (
            <Tab
              key={tab.name}
              label={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <i className={tab.icon} style={{ fontSize: 18 }} />
                  <span>{tab.label}</span>
                </Box>
              }
            />
          ))}
        </Tabs>
      </Box>
    )
  }

  return (
    <Box
      component='nav'
      aria-label={t('settings.navAriaLabel')}
      sx={{ width: 248, flexShrink: 0, borderRight: 1, borderColor: 'divider', overflowY: 'auto', py: 1 }}
    >
      <List dense disablePadding>
        {groupSettingsTabs(tabs).map(group => (
          <Fragment key={group.key}>
            <ListSubheader
              disableSticky
              sx={{ bgcolor: 'transparent', lineHeight: '32px', mt: 1, fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}
            >
              {t(`settings.navGroups.${group.key}`)}
            </ListSubheader>
            {group.items.map(({ tab, index }) => (
              <ListItemButton
                key={tab.name}
                selected={index === value}
                aria-current={index === value ? 'page' : undefined}
                title={tab.label}
                onClick={() => onChange(index)}
                sx={{ mx: 1, borderRadius: 1, minHeight: 38 }}
              >
                <ListItemIcon sx={{ minWidth: 30, color: index === value ? 'primary.main' : 'inherit' }}>
                  <i className={tab.icon} style={{ fontSize: 18 }} />
                </ListItemIcon>
                <ListItemText
                  primary={tab.label}
                  slotProps={{ primary: { noWrap: true, sx: { fontSize: '0.9rem', fontWeight: index === value ? 600 : 400 } } }}
                />
              </ListItemButton>
            ))}
          </Fragment>
        ))}
      </List>
    </Box>
  )
}
