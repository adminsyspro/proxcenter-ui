'use client'

import { useState, useEffect } from 'react'

import { useTranslations } from 'next-intl'
import { useSession } from 'next-auth/react'

import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  IconButton,
  InputAdornment,
  TextField,
  Typography,
} from '@mui/material'

import { usePageTitle } from '@/contexts/PageTitleContext'
import { useRBAC } from '@/contexts/RBACContext'


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

export default function ProfilePage() {
  const t = useTranslations()
  const { roles: rbacRoles } = useRBAC()
  const { data: session, update: updateSession } = useSession()

  const { setPageInfo } = usePageTitle()

  useEffect(() => {
    setPageInfo(t('profile.title'), t('settings.subtitle'), 'ri-user-line')
    
return () => setPageInfo('', '', '')
  }, [setPageInfo, t])
  const user = session?.user

  const [name, setName] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showNewPassword, setShowNewPassword] = useState(false)
  
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)
  const [profileSuccess, setProfileSuccess] = useState('')
  const [profileError, setProfileError] = useState('')
  const [passwordSuccess, setPasswordSuccess] = useState('')
  const [passwordError, setPasswordError] = useState('')

  const primaryRole = rbacRoles[0]

  useEffect(() => {
    if (user?.name) {
      setName(user.name)
    }
  }, [user?.name])

  const handleSaveProfile = async () => {
    setSavingProfile(true)
    setProfileError('')
    setProfileSuccess('')

    try {
      const res = await fetch(`/api/v1/users/${user?.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })

      const data = await res.json()

      if (!res.ok) {
        setProfileError(data.error || t('settings.saveError'))
        
return
      }

      setProfileSuccess(t('profile.updated'))
      await updateSession({ name })
    } catch (e) {
      setProfileError(t('settings.connectionError'))
    } finally {
      setSavingProfile(false)
    }
  }

  const handleChangePassword = async () => {
    setPasswordError('')
    setPasswordSuccess('')

    if (newPassword !== confirmPassword) {
      setPasswordError(t('profilePage.passwordsDoNotMatch'))

return
    }

    if (newPassword.length < 8) {
      setPasswordError(t('profilePage.passwordMinLength'))

return
    }

    setSavingPassword(true)

    try {
      const res = await fetch(`/api/v1/users/${user?.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: newPassword }),
      })

      const data = await res.json()

      if (!res.ok) {
        setPasswordError(data.error || t('common.error'))
        
return
      }

      setPasswordSuccess(t('common.success'))
      setNewPassword('')
      setConfirmPassword('')
    } catch (e) {
      setPasswordError(t('settings.connectionError'))
    } finally {
      setSavingPassword(false)
    }
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {/* Carte principale avec avatar et infos */}
      <Card variant='outlined'>
        <CardContent sx={{ p: 4 }}>
          <Box sx={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
            {/* Avatar et infos de base */}
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 220 }}>
              <Avatar
                src={user?.avatar || undefined}
                sx={{ 
                  width: 120, 
                  height: 120, 
                  fontSize: '2.5rem', 
                  fontWeight: 700,
                  bgcolor: 'primary.main',
                  mb: 2,
                }}
              >
                {!user?.avatar && getInitials(user?.name, user?.email)}
              </Avatar>
              {primaryRole && (
                <Chip
                  label={primaryRole.name}
                  sx={{ mb: 1, bgcolor: primaryRole.color || undefined, color: '#fff' }}
                />
              )}
              {rbacRoles.length > 1 && (
                <Typography variant='caption' sx={{ opacity: 0.5, textAlign: 'center' }}>
                  +{rbacRoles.length - 1} {t('common.other')}
                </Typography>
              )}
            </Box>

            {/* Détails du compte */}
            <Box sx={{ flex: 1, minWidth: 400 }}>
              <Typography variant='h6' sx={{ fontWeight: 600, mb: 2 }}>
                {t('profile.personalInfo')}
              </Typography>
              
              <Box sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 1.5, mb: 3 }}>
                <Typography variant='body2' sx={{ opacity: 0.6 }}>Email</Typography>
                <Typography variant='body2' sx={{ fontWeight: 500 }}>{user?.email}</Typography>

                <Typography variant='body2' sx={{ opacity: 0.6 }}>{t('common.name')}</Typography>
                <Typography variant='body2' sx={{ fontWeight: 500 }}>{user?.name || '—'}</Typography>

                <Typography variant='body2' sx={{ opacity: 0.6 }}>{t('auth.loginMethod')}</Typography>
                <Typography variant='body2' sx={{ fontWeight: 500 }}>
                  {user?.authProvider === 'ldap' ? t('auth.ldapAd') : t('auth.localAccount')}
                </Typography>

                <Typography variant='body2' sx={{ opacity: 0.6 }}>ID</Typography>
                <Typography variant='body2' sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                  {user?.id}
                </Typography>
              </Box>
            </Box>
          </Box>
        </CardContent>
      </Card>

      {/* Formulaires côte à côte */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 3 }}>
        {/* Informations personnelles */}
        <Card variant='outlined'>
          <CardContent sx={{ p: 3 }}>
            <Typography variant='h6' sx={{ fontWeight: 600, mb: 3 }}>
              {t('common.edit')} {t('profile.title').toLowerCase()}
            </Typography>

            {profileError && <Alert severity='error' sx={{ mb: 2 }}>{profileError}</Alert>}
            {profileSuccess && <Alert severity='success' sx={{ mb: 2 }}>{profileSuccess}</Alert>}

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <TextField
                fullWidth
                label='Email'
                value={user?.email || ''}
                disabled
                size='small'
              />
              <TextField
                fullWidth
                label={t('profilePage.fullName')}
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder={t('profilePage.fullNamePlaceholder')}
                size='small'
              />
              <Button
                variant='contained'
                onClick={handleSaveProfile}
                disabled={savingProfile}
                fullWidth
              >
                {savingProfile ? t('common.saving') : t('settings.saveChanges')}
              </Button>
            </Box>
          </CardContent>
        </Card>

        {/* Changement de mot de passe */}
        {user?.authProvider !== 'ldap' ? (
          <Card variant='outlined'>
            <CardContent sx={{ p: 3 }}>
              <Typography variant='h6' sx={{ fontWeight: 600, mb: 3 }}>
                {t('profile.changePassword')}
              </Typography>

              {passwordError && <Alert severity='error' sx={{ mb: 2 }}>{passwordError}</Alert>}
              {passwordSuccess && <Alert severity='success' sx={{ mb: 2 }}>{passwordSuccess}</Alert>}

              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <TextField
                  fullWidth
                  label={t('profilePage.newPassword')}
                  type={showNewPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  size='small'
                  InputProps={{
                    endAdornment: (
                      <InputAdornment position='end'>
                        <IconButton size='small' onClick={() => setShowNewPassword(!showNewPassword)}>
                          <i className={showNewPassword ? 'ri-eye-off-line' : 'ri-eye-line'} />
                        </IconButton>
                      </InputAdornment>
                    ),
                  }}
                />
                <TextField
                  fullWidth
                  label={t('profilePage.confirmPassword')}
                  type='password'
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  error={!!(confirmPassword && newPassword !== confirmPassword)}
                  helperText={confirmPassword && newPassword !== confirmPassword ? t('profilePage.passwordsDoNotMatch') : t('profilePage.minChars')}
                  size='small'
                />
                <Button
                  variant='contained'
                  color='warning'
                  onClick={handleChangePassword}
                  disabled={savingPassword || !newPassword || !confirmPassword}
                  fullWidth
                >
                  {savingPassword ? t('common.saving') : t('profile.changePassword')}
                </Button>
              </Box>
            </CardContent>
          </Card>
        ) : (
          <Card variant='outlined'>
            <CardContent sx={{ p: 3, display: 'flex', flexDirection: 'column', justifyContent: 'center', height: '100%' }}>
              <Alert severity='info'>
                <Typography variant='body2' dangerouslySetInnerHTML={{ __html: t('profilePage.ldapAccountNotice') }} />
                <Typography variant='body2' sx={{ mt: 1 }}>
                  {t('profilePage.ldapPasswordChangeNotice')}
                </Typography>
              </Alert>
            </CardContent>
          </Card>
        )}
      </Box>
    </Box>
  )
}
