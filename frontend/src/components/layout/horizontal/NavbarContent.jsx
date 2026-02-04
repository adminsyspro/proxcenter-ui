'use client'

import { useEffect, useState } from 'react'

import {
  Box,
  IconButton,
  InputBase,
  Tooltip,
  Chip,
  Dialog,
  DialogContent,
  Typography,
  Menu,
  MenuItem,
  ListItemIcon
} from '@mui/material'

import { useTranslations } from 'next-intl'

import TasksDropdown from '../shared/TasksDropdown'

// i18n
import { useLocale } from '@/contexts/LocaleContext'

const NavbarContent = () => {
  const [open, setOpen] = useState(false)
  const [langAnchor, setLangAnchor] = useState(null)

  // i18n hooks
  const t = useTranslations()
  const { locale, locales, localeNames, localeFlags, changeLocale, isPending } = useLocale()

  // Ctrl/Cmd + K => ouvre la recherche (comme Materio)
  useEffect(() => {
    const onKeyDown = e => {
      const isK = e.key?.toLowerCase() === 'k'

      if ((e.ctrlKey || e.metaKey) && isK) {
        e.preventDefault()
        setOpen(true)
      }

      if (e.key === 'Escape') setOpen(false)
    }

    window.addEventListener('keydown', onKeyDown)
    
return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', width: '100%', gap: 2, px: 2 }}>
        {/* SEARCH */}
        <Box
          onClick={() => setOpen(true)}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: 2,
            py: 0.75,
            borderRadius: 999,
            width: { xs: '100%', sm: 520 },
            cursor: 'pointer',
            backgroundColor: theme => theme.palette.action.hover
          }}
        >
          <i className='ri-search-line' style={{ opacity: 0.7 }} />
          <InputBase
            placeholder=''
            sx={{ flex: 1 }}
            inputProps={{ readOnly: true }}
          />
        </Box>

        {/* RIGHT ICONS */}
        <Box sx={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 1 }}>
          <Tooltip title={t('navbar.language')}>
            <IconButton size='small' onClick={e => setLangAnchor(e.currentTarget)} disabled={isPending}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <span style={{ fontSize: '1.1rem' }}>{localeFlags[locale]}</span>
              </Box>
            </IconButton>
          </Tooltip>

          <Tooltip title={t('navbar.theme')}>
            <IconButton size='small'>
              <i className='ri-sun-line' />
            </IconButton>
          </Tooltip>

          <Tooltip title='Shortcuts'>
            <IconButton size='small'>
              <i className='ri-star-line' />
            </IconButton>
          </Tooltip>

          {/* Tasks Dropdown */}
          <TasksDropdown />

          <Tooltip title={t('navbar.notifications')}>
            <IconButton size='small'>
              <i className='ri-notification-3-line' />
            </IconButton>
          </Tooltip>

          <Tooltip title={t('navbar.profile')}>
            <IconButton size='small'>
              <i className='ri-user-3-line' />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {/* LANGUAGE MENU */}
      <Menu anchorEl={langAnchor} open={Boolean(langAnchor)} onClose={() => setLangAnchor(null)}>
        {locales.map((loc) => (
          <MenuItem
            key={loc}
            onClick={() => {
              changeLocale(loc)
              setLangAnchor(null)
            }}
            selected={locale === loc}
          >
            <ListItemIcon>
              <span style={{ fontSize: '1.2rem' }}>{localeFlags[loc]}</span>
            </ListItemIcon>
            {localeNames[loc]}
          </MenuItem>
        ))}
      </Menu>

      {/* DIALOG SEARCH */}
      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth='sm'>
        <DialogContent>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
            <i className='ri-search-line' style={{ opacity: 0.7 }} />
            <Typography variant='h6' sx={{ fontWeight: 700 }}>
              {t('navbar.search')}
            </Typography>
          </Box>

          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              px: 2,
              py: 1,
              borderRadius: 2,
              backgroundColor: theme => theme.palette.action.hover
            }}
          >
            <InputBase autoFocus placeholder={t('navbar.searchPlaceholder')} sx={{ flex: 1 }} />
            <Chip size='small' label='ESC' variant='outlined' />
          </Box>

          <Typography variant='body2' sx={{ mt: 2, opacity: 0.7 }}>
            {t('navbar.searchTip')}
          </Typography>
        </DialogContent>
      </Dialog>
    </>
  )
}

export default NavbarContent
