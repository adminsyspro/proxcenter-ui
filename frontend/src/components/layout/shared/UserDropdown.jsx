'use client'

// React Imports
import { useRef, useState } from 'react'

// Next Imports
import { useRouter } from 'next/navigation'

import { useSession, signOut } from 'next-auth/react'
import { useTranslations } from 'next-intl'

// MUI Imports
import { styled } from '@mui/material/styles'
import Badge from '@mui/material/Badge'
import Avatar from '@mui/material/Avatar'
import Popper from '@mui/material/Popper'
import Fade from '@mui/material/Fade'
import Paper from '@mui/material/Paper'
import ClickAwayListener from '@mui/material/ClickAwayListener'
import MenuList from '@mui/material/MenuList'
import Typography from '@mui/material/Typography'
import Divider from '@mui/material/Divider'
import MenuItem from '@mui/material/MenuItem'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'

// Hook Imports
import { useSettings } from '@core/hooks/useSettings'

// Styled component for badge content
const BadgeContentSpan = styled('span')({
  width: 8,
  height: 8,
  borderRadius: '50%',
  cursor: 'pointer',
  backgroundColor: 'var(--mui-palette-success-main)',
  boxShadow: '0 0 0 2px var(--mui-palette-background-paper)'
})

// Fonction pour obtenir les initiales
const getInitials = (name, email) => {
  if (name) {
    const parts = name.split(' ')

    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase()
    }

    
return name.substring(0, 2).toUpperCase()
  }

  if (email) {
    return email.substring(0, 2).toUpperCase()
  }

  
return 'U'
}

// Couleur basée sur le rôle
const getRoleColor = (role) => {
  switch (role) {
    case 'admin': return 'error'
    case 'operator': return 'warning'
    case 'viewer': return 'info'
    default: return 'default'
  }
}

const getRoleLabel = (role, t) => {
  switch (role) {
    case 'admin': return t('user.admin')
    case 'operator': return t('user.operator')
    case 'viewer': return t('user.viewer')
    default: return role
  }
}

const UserDropdown = () => {
  // States
  const [open, setOpen] = useState(false)

  // Refs
  const anchorRef = useRef(null)

  // Hooks
  const router = useRouter()
  const { settings } = useSettings()
  const { data: session } = useSession()
  const t = useTranslations()

  const user = session?.user

  const handleDropdownOpen = () => {
    !open ? setOpen(true) : setOpen(false)
  }

  const handleDropdownClose = (event, url) => {
    if (url) {
      router.push(url)
    }

    if (anchorRef.current && anchorRef.current.contains(event?.target)) {
      return
    }

    setOpen(false)
  }

  const handleUserLogout = async () => {
    setOpen(false)
    await signOut({ callbackUrl: '/login' })
  }

  return (
    <>
      <Badge
        ref={anchorRef}
        overlap='circular'
        badgeContent={<BadgeContentSpan onClick={handleDropdownOpen} />}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        className='mis-2'
      >
        <Avatar
          ref={anchorRef}
          alt={user?.name || user?.email || 'User'}
          src={user?.avatar || undefined}
          onClick={handleDropdownOpen}
          className='cursor-pointer bs-[38px] is-[38px]'
          sx={{ bgcolor: 'primary.main', fontSize: '0.875rem', fontWeight: 600 }}
        >
          {!user?.avatar && getInitials(user?.name, user?.email)}
        </Avatar>
      </Badge>
      <Popper
        open={open}
        transition
        disablePortal
        placement='bottom-end'
        anchorEl={anchorRef.current}
        className='min-is-[240px] !mbs-4 z-[1]'
      >
        {({ TransitionProps, placement }) => (
          <Fade
            {...TransitionProps}
            style={{
              transformOrigin: placement === 'bottom-end' ? 'right top' : 'left top'
            }}
          >
            <Paper className={settings.skin === 'bordered' ? 'border shadow-none' : 'shadow-lg'}>
              <ClickAwayListener onClickAway={e => handleDropdownClose(e)}>
                <MenuList>
                  <div className='flex items-center plb-2 pli-4 gap-2' tabIndex={-1}>
                    <Avatar 
                      alt={user?.name || user?.email || 'User'}
                      src={user?.avatar || undefined}
                      sx={{ bgcolor: 'primary.main', fontSize: '0.875rem', fontWeight: 600 }}
                    >
                      {!user?.avatar && getInitials(user?.name, user?.email)}
                    </Avatar>
                    <div className='flex items-start flex-col'>
                      <Typography className='font-medium' color='text.primary'>
                        {user?.name || t('user.defaultName')}
                      </Typography>
                      <Typography variant='caption'>{user?.email}</Typography>
                      {user?.role && (
                        <Chip
                          size='small'
                          label={getRoleLabel(user.role, t)}
                          color={getRoleColor(user.role)}
                          sx={{ mt: 0.5, height: 20, fontSize: '0.7rem' }}
                        />
                      )}
                    </div>
                  </div>
                  <Divider className='mlb-1' />
                  <MenuItem className='gap-3' onClick={e => handleDropdownClose(e, '/profile')}>
                    <i className='ri-user-3-line' />
                    <Typography color='text.primary'>{t('profile.title')}</Typography>
                  </MenuItem>
                  <MenuItem className='gap-3' onClick={e => handleDropdownClose(e, '/settings/general')}>
                    <i className='ri-settings-4-line' />
                    <Typography color='text.primary'>{t('navigation.settings')}</Typography>
                  </MenuItem>
                  {user?.role === 'admin' && (
                    <MenuItem className='gap-3' onClick={e => handleDropdownClose(e, '/security/users')}>
                      <i className='ri-shield-user-line' />
                      <Typography color='text.primary'>{t('navigation.users')}</Typography>
                    </MenuItem>
                  )}
                  <Divider className='mlb-1' />
                  <div className='flex items-center plb-2 pli-4'>
                    <Button
                      fullWidth
                      variant='contained'
                      color='error'
                      size='small'
                      endIcon={<i className='ri-logout-box-r-line' />}
                      onClick={handleUserLogout}
                      sx={{ '& .MuiButton-endIcon': { marginInlineStart: 1.5 } }}
                    >
                      {t('auth.logout')}
                    </Button>
                  </div>
                </MenuList>
              </ClickAwayListener>
            </Paper>
          </Fade>
        )}
      </Popper>
    </>
  )
}

export default UserDropdown
