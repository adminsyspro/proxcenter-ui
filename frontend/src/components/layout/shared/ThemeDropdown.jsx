'use client'

// React Imports
import { useRef, useState } from 'react'
import { useTranslations } from 'next-intl'

// MUI Imports
import Tooltip from '@mui/material/Tooltip'
import IconButton from '@mui/material/IconButton'
import Popper from '@mui/material/Popper'
import Fade from '@mui/material/Fade'
import Paper from '@mui/material/Paper'
import ClickAwayListener from '@mui/material/ClickAwayListener'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Divider from '@mui/material/Divider'

// Config Imports
import primaryColorConfig from '@configs/primaryColorConfig'

// Hook Imports
import { useSettings } from '@core/hooks/useSettings'

// Noms des thèmes pour l'affichage
const themeNames = {
  'primary-1': { name: 'PROXCENTER', icon: 'proxmox-logo' },
  'primary-2': { name: 'Ocean', icon: 'ri-water-flash-fill' },
  'primary-3': { name: 'Cherry', icon: 'ri-heart-fill' },
  'primary-4': { name: 'Sunrise', icon: 'ri-sun-fill' },
  'primary-5': { name: 'Azure', icon: 'ri-cloud-fill' },
  'primary-6': { name: 'Lavender', icon: 'ri-flower-fill' },
  'primary-7': { name: 'Emerald', icon: 'ri-leaf-fill' },
  'primary-8': { name: 'Ruby', icon: 'ri-vip-diamond-fill' },
  'primary-9': { name: 'Cyan', icon: 'ri-drop-fill' },
  'primary-10': { name: 'Amber', icon: 'ri-flashlight-fill' },
  'primary-11': { name: 'Violet', icon: 'ri-magic-fill' },
  'primary-12': { name: 'Mint', icon: 'ri-seedling-fill' },
}

// Composant logo Proxcenter SVG (même style que la sidebar)
const ProxcenterLogo = ({ size = 14, color = '#F29221' }) => {
  const height = (size * 170) / 220

  
return (
    <svg 
      width={size} 
      height={height} 
      viewBox="0 0 220 170" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: 'block' }}
    >
      <path 
        d="M 174.30 158.91 C160.99,140.34 155.81,133.18 151.52,127.42 C149.04,124.08 147.00,120.78 147.00,120.10 C147.00,119.42 148.91,116.47 151.25,113.55 C153.59,110.63 157.44,105.71 159.81,102.62 C162.18,99.53 164.71,97.00 165.44,97.00 C166.58,97.00 182.93,119.09 200.79,144.77 C203.71,148.95 208.32,155.38 211.04,159.06 C213.77,162.74 216.00,166.03 216.00,166.37 C216.00,166.72 207.92,167.00 198.05,167.00 L 180.10 167.00 Z M 164.11 69.62 C161.87,67.24 159.22,63.61 151.44,52.29 L 147.85 47.07 L 153.79 39.29 C157.05,35.00 161.25,29.62 163.11,27.32 C164.98,25.02 169.65,19.08 173.50,14.11 L 180.50 5.08 L 199.25 5.04 C209.56,5.02 218.00,5.23 218.00,5.51 C218.00,5.79 214.51,10.42 210.25,15.81 C205.99,21.19 199.80,29.11 196.50,33.41 C193.20,37.71 189.15,42.92 187.50,44.98 C183.18,50.39 169.32,68.18 167.76,70.30 C166.52,72.01 166.33,71.98 164.11,69.62 Z" 
        fill={color}
      />
      <path 
        d="M 0.03 164.75 C0.05,162.18 2.00,159.04 9.28,149.83 C19.92,136.37 45.56,103.43 54.84,91.32 L 61.17 83.05 L 58.87 79.77 C49.32,66.18 11.10,12.77 8.83,9.86 C7.28,7.85 6.00,5.94 6.00,5.61 C6.00,5.27 14.21,5.01 24.25,5.03 L 42.50 5.06 L 53.50 20.63 C59.55,29.20 65.44,37.40 66.58,38.85 C72.16,45.97 97.33,81.69 97.70,83.02 C98.13,84.59 95.40,88.27 63.50,129.06 C53.05,142.42 42.77,155.64 40.66,158.43 C32.84,168.76 34.77,168.00 16.33,168.00 L 0.00 168.00 L 0.03 164.75 Z M 55.56 167.09 C55.25,166.59 56.95,163.78 59.33,160.84 C61.71,157.90 66.10,152.33 69.08,148.46 C72.06,144.59 81.47,132.50 90.00,121.60 C98.53,110.69 106.38,100.58 107.46,99.13 C108.54,97.69 111.81,93.49 114.72,89.80 L 120.00 83.10 L 115.25 76.47 C112.64,72.82 109.82,68.83 109.00,67.61 C108.18,66.38 105.73,62.93 103.57,59.94 C101.41,56.95 96.88,50.67 93.51,46.00 C77.15,23.36 65.00,6.12 65.00,5.57 C65.00,5.23 73.21,5.08 83.24,5.23 L 101.49 5.50 L 124.77 38.00 C137.58,55.88 150.09,73.37 152.58,76.88 C155.08,80.39 156.91,83.79 156.66,84.44 C156.41,85.09 153.55,88.97 150.30,93.06 C147.06,97.15 137.93,108.82 130.02,119.00 C122.12,129.18 110.29,144.36 103.75,152.75 L 91.85 168.00 L 73.98 168.00 C64.16,168.00 55.87,167.59 55.56,167.09 Z" 
        fill={color}
        opacity="0.5"
      />
    </svg>
  )
}

// Fonction pour rendre l'icône (soit Proxcenter logo, soit Remix Icon)
const ThemeIcon = ({ icon, size = 14, color }) => {
  if (icon === 'proxmox-logo') {
    return <ProxcenterLogo size={size} color={color} />
  }

  
return <i className={icon} style={{ fontSize: size, color }} />
}

const ThemeDropdown = () => {
  // States
  const [open, setOpen] = useState(false)
  const [tooltipOpen, setTooltipOpen] = useState(false)

  // Refs
  const anchorRef = useRef(null)

  // Hooks
  const { settings, updateSettings } = useSettings()
  const t = useTranslations('navbar')

  const handleClose = () => {
    setOpen(false)
    setTooltipOpen(false)
  }

  const handleToggle = () => {
    setOpen(prevOpen => !prevOpen)
  }

  const handleModeSwitch = mode => {
    if (settings.mode !== mode) {
      updateSettings({ mode: mode })
    }
  }

  const handleColorSwitch = color => {
    if (settings.primaryColor !== color) {
      updateSettings({ primaryColor: color })
    }
  }

  const getModeIcon = () => {
    if (settings.mode === 'system') {
      return 'ri-computer-line'
    } else if (settings.mode === 'dark') {
      return 'ri-moon-clear-line'
    } else {
      return 'ri-sun-line'
    }
  }

  // Trouver le thème actuel
  const currentTheme = primaryColorConfig.find(c => c.main === settings.primaryColor) || primaryColorConfig[0]

  return (
    <>
      <Tooltip
        title={t('theme')}
        onOpen={() => setTooltipOpen(true)}
        onClose={() => setTooltipOpen(false)}
        open={open ? false : tooltipOpen ? true : false}
      >
        <IconButton ref={anchorRef} onClick={handleToggle} sx={{ color: 'text.primary' }}>
          <i className={getModeIcon()} />
        </IconButton>
      </Tooltip>
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
            style={{ transformOrigin: placement === 'bottom-end' ? 'right top' : 'left top' }}
          >
            <Paper 
              className={settings.skin === 'bordered' ? 'border shadow-none' : 'shadow-lg'}
              sx={{ p: 2 }}
            >
              <ClickAwayListener onClickAway={handleClose}>
                <Box>
                  {/* Section Mode */}
                  <Typography variant="caption" sx={{ fontWeight: 700, opacity: 0.7, textTransform: 'uppercase', letterSpacing: 1 }}>
                    Mode
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 1, mt: 1, mb: 2 }}>
                    <IconButton
                      size="small"
                      onClick={() => handleModeSwitch('light')}
                      sx={{
                        border: '2px solid',
                        borderColor: settings.mode === 'light' ? 'primary.main' : 'divider',
                        bgcolor: settings.mode === 'light' ? 'primary.lightOpacity' : 'transparent',
                        color: settings.mode === 'light' ? 'primary.main' : 'text.primary',
                        '&:hover': { bgcolor: 'action.hover' }
                      }}
                    >
                      <i className='ri-sun-line' />
                    </IconButton>
                    <IconButton
                      size="small"
                      onClick={() => handleModeSwitch('dark')}
                      sx={{
                        border: '2px solid',
                        borderColor: settings.mode === 'dark' ? 'primary.main' : 'divider',
                        bgcolor: settings.mode === 'dark' ? 'primary.lightOpacity' : 'transparent',
                        color: settings.mode === 'dark' ? 'primary.main' : 'text.primary',
                        '&:hover': { bgcolor: 'action.hover' }
                      }}
                    >
                      <i className='ri-moon-clear-line' />
                    </IconButton>
                    <IconButton
                      size="small"
                      onClick={() => handleModeSwitch('system')}
                      sx={{
                        border: '2px solid',
                        borderColor: settings.mode === 'system' ? 'primary.main' : 'divider',
                        bgcolor: settings.mode === 'system' ? 'primary.lightOpacity' : 'transparent',
                        color: settings.mode === 'system' ? 'primary.main' : 'text.primary',
                        '&:hover': { bgcolor: 'action.hover' }
                      }}
                    >
                      <i className='ri-computer-line' />
                    </IconButton>
                  </Box>

                  <Divider sx={{ my: 1.5 }} />

                  {/* Section Couleurs */}
                  <Typography variant="caption" sx={{ fontWeight: 700, opacity: 0.7, textTransform: 'uppercase', letterSpacing: 1 }}>
                    Couleur
                  </Typography>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mt: 1 }}>
                    {primaryColorConfig.map((color) => {
                      const isSelected = settings.primaryColor === color.main
                      const themeInfo = themeNames[color.name] || { name: color.name, icon: 'ri-palette-fill' }
                      const isProxmox = themeInfo.icon === 'proxmox-logo'
                      
                      return (
                        <Box
                          key={color.name}
                          onClick={() => handleColorSwitch(color.main)}
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 1.5,
                            p: 1,
                            borderRadius: 1,
                            cursor: 'pointer',
                            border: '2px solid',
                            borderColor: isSelected ? color.main : 'transparent',
                            bgcolor: isSelected ? `${color.main}18` : 'transparent',
                            '&:hover': {
                              bgcolor: `${color.main}12`,
                            },
                            transition: 'all 0.2s ease'
                          }}
                        >
                          {isProxmox ? (

                            // Logo Proxmox sans fond rond
                            <Box
                              sx={{
                                width: 28,
                                height: 28,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
                            >
                              <ThemeIcon icon={themeInfo.icon} size={24} color={color.main} />
                            </Box>
                          ) : (

                            // Autres thèmes avec fond rond
                            <Box
                              sx={{
                                width: 28,
                                height: 28,
                                borderRadius: '50%',
                                bgcolor: color.main,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: '#fff',
                                fontSize: 14,
                                boxShadow: isSelected ? `0 0 0 3px ${color.main}40` : 'none',
                                transition: 'all 0.2s ease'
                              }}
                            >
                              <ThemeIcon icon={themeInfo.icon} size={14} color="#fff" />
                            </Box>
                          )}
                          <Typography 
                            variant="body2" 
                            sx={{ 
                              fontWeight: isSelected ? 700 : 500,
                              color: isSelected ? color.main : 'text.primary'
                            }}
                          >
                            {themeInfo.name}
                          </Typography>
                          {isSelected && (
                            <i className='ri-check-line' style={{ marginLeft: 'auto', color: color.main }} />
                          )}
                        </Box>
                      )
                    })}
                  </Box>
                </Box>
              </ClickAwayListener>
            </Paper>
          </Fade>
        )}
      </Popper>
    </>
  )
}

export default ThemeDropdown