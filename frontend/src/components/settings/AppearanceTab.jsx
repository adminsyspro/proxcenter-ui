'use client'

import { useState, useMemo } from 'react'
import { useTranslations } from 'next-intl'

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Collapse,
  Divider,
  FormControl,
  FormControlLabel,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Slider,
  Switch,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  alpha,
  useTheme
} from '@mui/material'

import { useSettings } from '@core/hooks/useSettings'
import globalThemesConfig, { 
  themeCategories, 
  densityConfig, 
  borderRadiusPresets,
  getGlobalTheme 
} from '@configs/globalThemesConfig'
import lightBackgroundConfig from '@configs/lightBackgroundConfig'

/* ==================== Theme Preview Card ==================== */

function ThemePreviewCard({ themeConfig, selected, onSelect, t }) {
  const muiTheme = useTheme()
  const isSelected = selected === themeConfig.id
  const styles = themeConfig.styles

  return (
    <Card
      variant='outlined'
      onClick={() => onSelect(themeConfig.id)}
      sx={{
        cursor: 'pointer',
        position: 'relative',
        transition: 'all 0.25s ease-in-out',
        border: isSelected ? '2px solid' : '1px solid',
        borderColor: isSelected ? 'primary.main' : 'divider',
        backgroundColor: isSelected ? alpha(muiTheme.palette.primary.main, 0.04) : 'background.paper',
        overflow: 'hidden',
        '&:hover': {
          borderColor: 'primary.main',
          transform: 'translateY(-4px)',
          boxShadow: `0 8px 24px ${alpha(muiTheme.palette.primary.main, 0.2)}`
        }
      }}
    >
      {isSelected && (
        <Box sx={{ position: 'absolute', top: 8, right: 8, width: 24, height: 24, borderRadius: '50%', backgroundColor: 'primary.main', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2 }}>
          <i className='ri-check-line' style={{ color: '#fff', fontSize: 14 }} />
        </Box>
      )}

      <Box sx={{ height: 120, background: themeConfig.preview.cardBg, position: 'relative', p: 1.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Box sx={{ flex: 1, borderRadius: `${styles.card.borderRadius}px`, background: styles.card.background === 'var(--mui-palette-background-paper)' ? 'rgba(255,255,255,0.1)' : styles.card.background, backdropFilter: styles.card.backdropFilter !== 'none' ? styles.card.backdropFilter : undefined, border: styles.card.border !== 'none' ? styles.card.border : '1px solid rgba(255,255,255,0.1)', boxShadow: styles.card.boxShadow, p: 1, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: themeConfig.preview.accent }} />
            <Box sx={{ height: 6, flex: 1, backgroundColor: 'rgba(255,255,255,0.3)', borderRadius: 1 }} />
          </Box>
          <Box sx={{ height: 4, width: '80%', backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 1 }} />
          <Box sx={{ height: 4, width: '60%', backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 1 }} />
        </Box>

        <Box sx={{ display: 'flex', gap: 1 }}>
          <Box sx={{ height: 20, px: 1.5, borderRadius: `${styles.button.borderRadius}px`, backgroundColor: themeConfig.preview.accent, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Typography sx={{ fontSize: 8, color: '#fff', fontWeight: styles.button.fontWeight, textTransform: styles.button.textTransform }}>Button</Typography>
          </Box>
          <Box sx={{ height: 20, px: 1.5, borderRadius: `${styles.button.borderRadius}px`, border: `1px solid ${themeConfig.preview.accent}`, display: 'flex', alignItems: 'center' }}>
            <Typography sx={{ fontSize: 8, color: themeConfig.preview.accent, fontWeight: styles.button.fontWeight, textTransform: styles.button.textTransform }}>Outlined</Typography>
          </Box>
        </Box>
      </Box>

      <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box sx={{ width: 40, height: 40, borderRadius: 2, backgroundColor: alpha(themeConfig.preview.accent, 0.15), display: 'flex', alignItems: 'center', justifyContent: 'center', color: themeConfig.preview.accent }}>
            <i className={themeConfig.icon} style={{ fontSize: 20 }} />
          </Box>
          <Box sx={{ flex: 1 }}>
            <Typography variant='subtitle2' fontWeight={600}>{themeConfig.name}</Typography>
            <Typography variant='caption' color='text.secondary'>{t(themeConfig.descriptionKey)}</Typography>
          </Box>
        </Box>

        <Box sx={{ display: 'flex', gap: 0.5, mt: 1.5, flexWrap: 'wrap' }}>
          <Chip size='small' label={`Radius: ${styles.card.borderRadius}px`} sx={{ height: 20, fontSize: 10 }} />
          <Chip size='small' label={t(densityConfig[styles.density]?.labelKey) || styles.density} sx={{ height: 20, fontSize: 10 }} />
          {styles.card.backdropFilter !== 'none' && <Chip size='small' label='Blur' color='info' sx={{ height: 20, fontSize: 10 }} />}
          {themeConfig.tagKeys?.map((tagKey) => (
            <Chip key={tagKey} size='small' label={t(tagKey)} color={tagKey === 'themes.tags.popular' ? 'success' : tagKey === 'themes.tags.wcagAAA' ? 'warning' : 'default'} variant='outlined' sx={{ height: 20, fontSize: 10 }} />
          ))}
        </Box>
      </CardContent>
    </Card>
  )
}

/* ==================== Live Preview Component ==================== */

function LivePreview({ customRadius, t }) {
  return (
    <Card variant='outlined' sx={{ overflow: 'hidden' }}>
      <CardContent sx={{ p: 2 }}>
        <Typography variant='subtitle2' fontWeight={600} sx={{ mb: 2 }}>{t('settings.livePreview')}</Typography>

        <Card variant='outlined' sx={{ mb: 2, ...(customRadius !== null && customRadius !== undefined && { borderRadius: `${customRadius}px` }) }}>
          <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
              <Box sx={{ width: 32, height: 32, borderRadius: 1, backgroundColor: 'primary.main', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <i className='ri-server-line' style={{ color: '#fff', fontSize: 16 }} />
              </Box>
              <Box>
                <Typography variant='body2' fontWeight={600}>Server PVE-01</Typography>
                <Typography variant='caption' color='text.secondary'>192.168.1.10</Typography>
              </Box>
              <Chip size='small' label={t('settings.serverOnline')} color='success' sx={{ ml: 'auto' }} />
            </Box>
            <Divider sx={{ my: 1.5 }} />
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button size='small' variant='contained'>{t('settings.connect')}</Button>
              <Button size='small' variant='outlined'>{t('settings.details')}</Button>
              <Button size='small' variant='text' color='error'>{t('common.delete')}</Button>
            </Box>
          </CardContent>
        </Card>

        <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
          <FormControl size='small' sx={{ minWidth: 120 }}>
            <InputLabel>Region</InputLabel>
            <Select label='Region' value='gra'><MenuItem value='gra'>GRA</MenuItem><MenuItem value='rbx'>RBX</MenuItem></Select>
          </FormControl>
          <Chip label='CPU: 45%' color='warning' />
          <Chip label='RAM: 62%' color='info' />
        </Box>

        <Alert severity='info'>{t('settings.changesAutoSaved')}</Alert>
      </CardContent>
    </Card>
  )
}

/* ==================== Main AppearanceTab Component ==================== */

export default function AppearanceTab() {
  const theme = useTheme()
  const t = useTranslations()
  const { settings, updateSettings, resetSettings } = useSettings()
  const [message, setMessage] = useState(null)
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [showAdvanced, setShowAdvanced] = useState(false)

  // Filter themes by category
  const filteredThemes = useMemo(() => {
    if (selectedCategory === 'all') return globalThemesConfig
    
return globalThemesConfig.filter(t => t.category === selectedCategory)
  }, [selectedCategory])

  // Get current theme config
  const currentThemeConfig = useMemo(() => {
    return getGlobalTheme(settings.globalTheme || 'default')
  }, [settings.globalTheme])

  const showMessage = (type, text) => { setMessage({ type, text }); setTimeout(() => setMessage(null), 3000) }

  // Handlers - all changes are automatically persisted via updateSettings
  const handleModeChange = (e, newMode) => {
    if (newMode !== null) {
      updateSettings({ mode: newMode })
      showMessage('success', t('settings.savedSuccess'))
    }
  }

  const handleGlobalThemeChange = (themeId) => {
    const updates = { globalTheme: themeId }

    if (themeId === 'vcenter') {
      updates.layout = 'horizontal'
    } else if (settings.globalTheme === 'vcenter') {
      updates.layout = 'collapsed'
    }

    updateSettings(updates)
    showMessage('success', t('settings.savedSuccess'))
  }

  const handleLayoutChange = (e, newLayout) => {
    if (newLayout !== null) updateSettings({ layout: newLayout })
  }

  const handleSemiDarkChange = (e) => {
    updateSettings({ semiDark: e.target.checked })
  }

  const handleLightBackgroundChange = (bgId) => {
    updateSettings({ lightBackground: bgId })
    showMessage('success', t('settings.savedSuccess'))
  }

  const handleDensityChange = (e, newDensity) => {
    if (newDensity !== null) {
      updateSettings({ density: newDensity })
      showMessage('success', t('settings.savedSuccess'))
    }
  }

  const handleCustomBorderRadiusChange = (e, newValue) => {
    updateSettings({ customBorderRadius: newValue })
  }

  const handleBlurIntensityChange = (e, newValue) => {
    updateSettings({ blurIntensity: newValue })
  }

  const handleReset = () => {
    resetSettings()
    showMessage('info', t('common.reset'))
  }

  return (
    <Box>
      <Typography variant='body2' sx={{ opacity: 0.7, mb: 3 }}>
        {t('settings.appearanceDesc')}
      </Typography>

      {message && <Alert severity={message.type} sx={{ mb: 3 }} onClose={() => setMessage(null)}>{message.text}</Alert>}

      {/* Section: Mode d'affichage */}
      <Card variant='outlined' sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant='subtitle1' fontWeight={700} sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
            <i className='ri-contrast-2-line' style={{ color: theme.palette.primary.main }} />
            {t('settings.displayMode')}
          </Typography>

          <ToggleButtonGroup value={settings.mode} exclusive onChange={handleModeChange} sx={{ mb: 1 }}>
            <ToggleButton value='light' sx={{ px: 3 }}><Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><i className='ri-sun-line' /><span>{t('settings.light')}</span></Box></ToggleButton>
            <ToggleButton value='dark' sx={{ px: 3 }}><Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><i className='ri-moon-line' /><span>{t('settings.dark')}</span></Box></ToggleButton>
            <ToggleButton value='system' sx={{ px: 3 }}><Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><i className='ri-computer-line' /><span>{t('settings.system')}</span></Box></ToggleButton>
          </ToggleButtonGroup>

          <Typography variant='caption' color='text.secondary'>{t('settings.systemModeDesc')}</Typography>
        </CardContent>
      </Card>

      {/* Section: Teinte du fond */}
      <Card variant='outlined' sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant='subtitle1' fontWeight={700} sx={{ mb: 0.5, display: 'flex', alignItems: 'center', gap: 1 }}>
            <i className='ri-drop-line' style={{ color: theme.palette.primary.main }} />
            {t('settings.backgroundTint')}
            <Chip label={t('settings.lightModeOnly')} size='small' sx={{ ml: 1, height: 20, fontSize: 10 }} />
          </Typography>
          <Typography variant='caption' color='text.secondary' sx={{ display: 'block', mb: 2 }}>{t('settings.backgroundTintDesc')}</Typography>

          <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
            {lightBackgroundConfig.map((bg) => {
              const isSelected = (settings.lightBackground || 'neutral') === bg.id

              
return (
                <Box key={bg.id} onClick={() => handleLightBackgroundChange(bg.id)} sx={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5, p: 1, borderRadius: 2, border: '2px solid', borderColor: isSelected ? 'primary.main' : 'transparent', backgroundColor: isSelected ? alpha(theme.palette.primary.main, 0.04) : 'transparent', transition: 'all 0.2s', '&:hover': { backgroundColor: alpha(theme.palette.primary.main, 0.08) } }}>
                  <Box sx={{ width: 48, height: 48, borderRadius: 2, border: '1px solid', borderColor: 'divider', overflow: 'hidden', position: 'relative', boxShadow: isSelected ? `0 0 0 2px ${theme.palette.primary.main}` : 'none' }}>
                    <Box sx={{ position: 'absolute', inset: 0, backgroundColor: bg.preview.bg }} />
                    <Box sx={{ position: 'absolute', top: 8, left: 6, right: 6, bottom: 4, backgroundColor: bg.preview.card, borderRadius: 0.5, boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }} />
                  </Box>
                  <Typography variant='caption' fontWeight={isSelected ? 600 : 400} color={isSelected ? 'primary.main' : 'text.secondary'} sx={{ fontSize: 11 }}>{t(bg.nameKey)}</Typography>
                </Box>
              )
            })}
          </Box>
        </CardContent>
      </Card>

      {/* Section: Style visuel */}
      <Card variant='outlined' sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 1 }}>
            <Typography variant='subtitle1' fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <i className='ri-palette-line' style={{ color: theme.palette.primary.main }} />
              {t('settings.visualStyle')}
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
              {themeCategories.map((cat) => (
                <Chip key={cat.id} label={t(cat.nameKey)} size='small' variant={selectedCategory === cat.id ? 'filled' : 'outlined'} color={selectedCategory === cat.id ? 'primary' : 'default'} onClick={() => setSelectedCategory(cat.id)} sx={{ cursor: 'pointer' }} />
              ))}
            </Box>
          </Box>

          <Typography variant='caption' color='text.secondary' sx={{ display: 'block', mb: 3 }}>{t('settings.visualStyleDesc')}</Typography>

          <Grid container spacing={2}>
            {filteredThemes.map((themeConf) => (
              <Grid item xs={12} sm={6} md={4} key={themeConf.id}>
                <ThemePreviewCard themeConfig={themeConf} selected={settings.globalTheme || 'default'} onSelect={handleGlobalThemeChange} t={t} />
              </Grid>
            ))}
          </Grid>
        </CardContent>
      </Card>

      {/* Section: Advanced Customization */}
      <Card variant='outlined' sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }} onClick={() => setShowAdvanced(!showAdvanced)}>
            <Typography variant='subtitle1' fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <i className='ri-settings-4-line' style={{ color: theme.palette.primary.main }} />
              {t('settings.advancedCustomization')}
            </Typography>
            <IconButton size='small'><i className={showAdvanced ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} /></IconButton>
          </Box>

          <Collapse in={showAdvanced}>
            <Box sx={{ mt: 3 }}>
              {/* Taille de police */}
              <Box sx={{ mb: 3 }}>
                <Typography variant='body2' fontWeight={500} sx={{ mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <i className='ri-font-size' style={{ fontSize: 16 }} />
                  {t('settings.fontSize')}
                </Typography>
                <Box sx={{ px: 1 }}>
                  <Slider 
                    value={settings.fontSize ?? 14} 
                    onChange={(e, v) => updateSettings({ fontSize: v })} 
                    min={12} 
                    max={18} 
                    step={1} 
                    marks={[
                      { value: 12, label: '12' },
                      { value: 14, label: '14' },
                      { value: 16, label: '16' },
                      { value: 18, label: '18' }
                    ]} 
                    valueLabelDisplay='auto' 
                    valueLabelFormat={(v) => `${v}px`} 
                  />
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1 }}>
                  <Typography variant='caption' color='text.secondary'>{t('settings.fontSizeSmall')}</Typography>
                  <Typography variant='caption' color='text.secondary'>{t('settings.fontSizeLarge')}</Typography>
                </Box>
              </Box>

              <Divider sx={{ my: 2 }} />

              {/* UI Scale */}
              <Box sx={{ mb: 3 }}>
                <Typography variant='body2' fontWeight={500} sx={{ mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <i className='ri-aspect-ratio-line' style={{ fontSize: 16 }} />
                  {t('settings.uiScale')}
                </Typography>
                <Box sx={{ px: 1 }}>
                  <Slider 
                    value={settings.uiScale ?? 100} 
                    onChange={(e, v) => updateSettings({ uiScale: v })} 
                    min={80} 
                    max={120} 
                    step={5} 
                    marks={[
                      { value: 80, label: '80%' },
                      { value: 100, label: '100%' },
                      { value: 120, label: '120%' }
                    ]} 
                    valueLabelDisplay='auto' 
                    valueLabelFormat={(v) => `${v}%`} 
                  />
                </Box>
                <Typography variant='caption' color='text.secondary'>{t('settings.uiScaleDesc')}</Typography>
              </Box>

              <Divider sx={{ my: 2 }} />

              {/* Density */}
              <Box sx={{ mb: 3 }}>
                <Typography variant='body2' fontWeight={500} sx={{ mb: 1.5 }}>{t('settings.interfaceDensity')}</Typography>
                <ToggleButtonGroup value={settings.density || 'comfortable'} exclusive onChange={handleDensityChange} size='small'>
                  {Object.entries(densityConfig).map(([key, config]) => (
                    <ToggleButton key={key} value={key} sx={{ px: 2 }}>
                      <Typography variant='caption' fontWeight={500}>{t(config.labelKey)}</Typography>
                    </ToggleButton>
                  ))}
                </ToggleButtonGroup>
                <Typography variant='caption' color='text.secondary' sx={{ display: 'block', mt: 1 }}>{t(densityConfig[settings.density || 'comfortable']?.descriptionKey)}</Typography>
              </Box>

              <Divider sx={{ my: 2 }} />

              {/* Border radius */}
              <Box sx={{ mb: 3 }}>
                <Typography variant='body2' fontWeight={500} sx={{ mb: 1.5 }}>{t('settings.borderRadiusGlobal')}</Typography>
                <Box sx={{ px: 1 }}>
                  <Slider 
                    value={settings.customBorderRadius ?? currentThemeConfig.styles.card.borderRadius} 
                    onChange={handleCustomBorderRadiusChange} 
                    min={0} 
                    max={24} 
                    step={1} 
                    marks={borderRadiusPresets.map(p => ({ value: p.value, label: p.value === 0 || p.value === 24 ? `${p.value}px` : '' }))} 
                    valueLabelDisplay='auto' 
                    valueLabelFormat={(v) => `${v}px`} 
                  />
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1 }}>
                  <Typography variant='caption' color='text.secondary'>{t('settings.borderRadiusSquare')}</Typography>
                  <Typography variant='caption' color='text.secondary'>{t('settings.borderRadiusRounded')}</Typography>
                </Box>
              </Box>

              {/* Blur intensity (for Glassmorphism) */}
              {(settings.globalTheme === 'glassmorphism') && (
                <>
                  <Divider sx={{ my: 2 }} />
                  <Box sx={{ mb: 3 }}>
                    <Typography variant='body2' fontWeight={500} sx={{ mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
                      {t('settings.blurIntensity')}
                      <Chip label='Glassmorphism' size='small' color='info' sx={{ height: 18, fontSize: 10 }} />
                    </Typography>
                    <Box sx={{ px: 1 }}>
                      <Slider 
                        value={settings.blurIntensity ?? 12} 
                        onChange={handleBlurIntensityChange} 
                        min={0} 
                        max={24} 
                        step={1} 
                        marks={[{ value: 0, label: '0' }, { value: 12, label: '12' }, { value: 24, label: '24' }]} 
                        valueLabelDisplay='auto' 
                        valueLabelFormat={(v) => `${v}px`} 
                      />
                    </Box>
                    <Typography variant='caption' color='text.secondary'>{t('settings.blurIntensityDesc')}</Typography>
                  </Box>
                </>
              )}
            </Box>
          </Collapse>
        </CardContent>
      </Card>

      {/* Section: Disposition */}
      <Card variant='outlined' sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant='subtitle1' fontWeight={700} sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
            <i className='ri-layout-line' style={{ color: theme.palette.primary.main }} />
            {t('settings.layout')}
          </Typography>

          <Box sx={{ mb: 2 }}>
            <Typography variant='body2' sx={{ mb: 1 }}>{t('settings.sidebarMenu')}</Typography>
            <ToggleButtonGroup value={settings.layout} exclusive onChange={handleLayoutChange} size='small'>
              <ToggleButton value='vertical'><Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}><i className='ri-layout-left-line' /><span>{t('settings.expanded')}</span></Box></ToggleButton>
              <ToggleButton value='collapsed'><Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}><i className='ri-layout-left-2-line' /><span>{t('settings.collapsed')}</span></Box></ToggleButton>
              <ToggleButton value='horizontal'><Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}><i className='ri-layout-top-line' /><span>{t('settings.horizontal')}</span></Box></ToggleButton>
            </ToggleButtonGroup>
          </Box>

          <FormControlLabel control={<Switch checked={settings.semiDark || false} onChange={handleSemiDarkChange} />} label={<Box><Typography variant='body2'>{t('settings.semiDarkMenu')}</Typography><Typography variant='caption' color='text.secondary'>{t('settings.semiDarkMenuDesc')}</Typography></Box>} />
        </CardContent>
      </Card>

      {/* Section: Preview */}
      <Box sx={{ mb: 3 }}>
        <Typography variant='subtitle1' fontWeight={700} sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className='ri-eye-line' style={{ color: theme.palette.primary.main }} />
          {t('settings.livePreview')}
        </Typography>
        <LivePreview customRadius={settings.customBorderRadius} t={t} />
      </Box>

      {/* Reset */}
      <Card variant='outlined'>
        <CardContent sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box>
            <Typography variant='body2' fontWeight={500}>{t('settings.resetSettings')}</Typography>
            <Typography variant='caption' color='text.secondary'>{t('settings.resetSettingsDesc')}</Typography>
          </Box>
          <Button variant='outlined' color='error' size='small' startIcon={<i className='ri-refresh-line' />} onClick={handleReset}>{t('common.reset')}</Button>
        </CardContent>
      </Card>
    </Box>
  )
}
