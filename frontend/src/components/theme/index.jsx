'use client'

// React Imports
import { useMemo } from 'react'

// MUI Imports
import { deepmerge } from '@mui/utils'
import { ThemeProvider, lighten, darken, createTheme } from '@mui/material/styles'
import { AppRouterCacheProvider } from '@mui/material-nextjs/v14-appRouter'
import CssBaseline from '@mui/material/CssBaseline'
import GlobalStyles from '@mui/material/GlobalStyles'

// Third-party Imports
import { useMedia } from 'react-use'
import stylisRTLPlugin from 'stylis-plugin-rtl'

// Component Imports
import ModeChanger from './ModeChanger'

// Config Imports
import themeConfig from '@configs/themeConfig'
import globalThemesConfig, { getGlobalTheme, densityConfig, transitionConfig } from '@configs/globalThemesConfig'
import lightBackgroundConfig, { getLightBackground } from '@configs/lightBackgroundConfig'

// Hook Imports
import { useSettings } from '@core/hooks/useSettings'

// Core Theme Imports
import defaultCoreTheme from '@core/theme'

// Generate global CSS based on theme
const getGlobalThemeStyles = (globalTheme, mode, customBorderRadius, blurIntensity, fontSize, uiScale) => {
  const themeStyles = globalTheme.styles
  const cssOverrides = globalTheme.cssOverrides?.[mode] || {}
  const densityValue = densityConfig[themeStyles.density]?.multiplier || 1
  const transitions = transitionConfig[themeStyles.transitions] || transitionConfig.normal
  
  // Use custom border radius if provided, otherwise use theme default
  const cardRadius = customBorderRadius !== null && customBorderRadius !== undefined 
    ? customBorderRadius 
    : themeStyles.card.borderRadius

  const buttonRadius = customBorderRadius !== null && customBorderRadius !== undefined
    ? Math.max(customBorderRadius - 2, 0)
    : themeStyles.button.borderRadius

  const inputRadius = customBorderRadius !== null && customBorderRadius !== undefined
    ? Math.max(customBorderRadius - 2, 0)
    : themeStyles.input.borderRadius

  // Use custom blur intensity if provided and theme supports it
  const effectiveBlur = globalTheme.id === 'glassmorphism' && blurIntensity !== null && blurIntensity !== undefined
    ? `blur(${blurIntensity}px) saturate(180%)`
    : themeStyles.card.backdropFilter

  // Font size and UI scale
  const baseFontSize = fontSize || 14
  const scale = (uiScale || 100) / 100

  // En mode light, on n'applique pas les backgrounds custom des thèmes pour éviter les problèmes de contraste
  const isLightMode = mode === 'light'
  const shouldApplyCustomBackground = !isLightMode && themeStyles.card.background !== 'var(--mui-palette-background-paper)'

  // Thèmes avec header/sidebar toujours sombres (même en mode clair)
  const themesWithDarkChrome = ['vcenter', 'proxmoxClassic', 'terminal', 'cyberpunk', 'nord', 'dracula', 'oneDark']
  const hasDarkChrome = themesWithDarkChrome.includes(globalTheme.id)

  // Font families par thème
  const themeFonts = {
    vcenter: '"Clarity City", "Segoe UI", -apple-system, BlinkMacSystemFont, "Roboto", sans-serif',
    proxmoxClassic: '"Lato", "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif',
    terminal: '"JetBrains Mono", "Fira Code", "Consolas", "Monaco", monospace',
    cyberpunk: '"Orbitron", "Rajdhani", "Share Tech", "Segoe UI", sans-serif',
    nord: '"Inter", "Nunito Sans", "Segoe UI", -apple-system, sans-serif',
    dracula: '"Fira Sans", "Source Sans Pro", "Segoe UI", sans-serif',
    oneDark: '"Source Sans Pro", "Segoe UI", -apple-system, sans-serif',
    glassmorphism: '"SF Pro Display", "Inter", "Segoe UI", -apple-system, sans-serif',
    neumorphism: '"Poppins", "Inter", "Segoe UI", sans-serif'
  }

  const themeFont = themeFonts[globalTheme.id]

  return {
    ':root': {
      // Density
      '--proxcenter-density': densityValue,

      // Transitions  
      '--proxcenter-transition-duration': transitions.duration,
      '--proxcenter-transition-easing': transitions.easing,

      // Card styles
      '--proxcenter-card-radius': `${cardRadius}px`,
      '--proxcenter-card-shadow': isLightMode 
        ? '0 2px 8px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06)' 
        : themeStyles.card.boxShadow,
      '--proxcenter-card-backdrop': effectiveBlur,
      '--proxcenter-card-border': themeStyles.card.border,

      // Button styles
      '--proxcenter-button-radius': `${buttonRadius}px`,

      // Input styles
      '--proxcenter-input-radius': `${inputRadius}px`,

      // Typography
      '--proxcenter-font-size': `${baseFontSize}px`,
      '--proxcenter-ui-scale': scale,

      // Theme-specific CSS vars
      ...cssOverrides
    },
    
    // Apply base font size globally
    'html': {
      fontSize: `${baseFontSize}px !important`
    },
    
    // Apply UI scale
    'body': {
      zoom: scale !== 1 ? scale : undefined
    },
    
    // Apply theme font globally
    ...(themeFont && {
      'body, .MuiTypography-root, .MuiButton-root, .MuiInputBase-root, .MuiMenuItem-root': {
        fontFamily: `${themeFont} !important`
      }
    }),
    
    // ============================================================
    // DARK CHROME FIX - For themes with dark header in light mode
    // Forces header icons/text to be white when header is dark
    // ============================================================
    ...(hasDarkChrome && isLightMode && {
      // Force all header elements to have light text
      '.ts-vertical-layout-header, .ts-horizontal-layout-header': {
        '& *': {
          color: '#ffffff !important'
        },
        '& .MuiIconButton-root': {
          color: '#ffffff !important'
        },
        '& .MuiTypography-root': {
          color: '#ffffff !important'
        },
        '& .MuiBadge-badge': {
          color: '#ffffff !important'
        }
      },
      '.ts-vertical-layout-navbar, .ts-horizontal-layout-navbar': {
        '& *': {
          color: '#ffffff !important'
        },
        '& .MuiIconButton-root': {
          color: '#ffffff !important'
        },
        '& i': {
          color: '#ffffff !important'
        }
      }
    }),
    
    // ============================================================
    // TASKBAR FIX - Force proper contrast in light mode
    // ============================================================
    ...(isLightMode && {
      // Barre des tâches en bas - fond blanc/gris clair avec texte très foncé
      '.ts-vertical-layout-footer, [class*="footer"], [class*="taskbar"], [class*="Taskbar"]': {
        backgroundColor: '#f8f9fa !important',
        borderTop: '1px solid #d0d0d0 !important',
        '& *': {
          color: '#1a1a1a !important'
        },
        '& .MuiTypography-root': {
          color: '#1a1a1a !important'
        },
        '& .MuiChip-root': {
          color: '#1a1a1a !important'
        },
        '& span, & p, & div': {
          color: '#1a1a1a !important'
        },
        '& a': {
          color: '#0066cc !important'
        }
      },

      // Zone des tâches/erreurs - fond clair avec texte foncé
      '[class*="task"], [class*="Task"]': {
        backgroundColor: '#ffffff !important',
        '& *': {
          color: '#1a1a1a !important'
        },
        '& .MuiTypography-root': {
          color: '#1a1a1a !important'
        },
        '& span': {
          color: '#1a1a1a !important'
        }
      },

      // Tableau des tâches
      '[class*="task"] table, [class*="Task"] table': {
        backgroundColor: '#ffffff !important',
        '& th': {
          color: '#333333 !important',
          backgroundColor: '#f0f0f0 !important'
        },
        '& td': {
          color: '#1a1a1a !important'
        }
      }
    }),
    
    // Apply card styles globally - mais PAS aux cartes qui ont un style inline ou une classe spécifique
    '.MuiCard-root:not([style*="background"]):not(.no-theme-override)': {
      borderRadius: 'var(--proxcenter-card-radius) !important',
      boxShadow: 'var(--proxcenter-card-shadow) !important',
      backdropFilter: !isLightMode && effectiveBlur !== 'none' 
        ? `${effectiveBlur} !important` 
        : undefined,
      background: shouldApplyCustomBackground 
        ? `${themeStyles.card.background} !important` 
        : undefined,
      border: themeStyles.card.border !== 'none' 
        ? `${themeStyles.card.border} !important` 
        : undefined,
      transition: `all var(--proxcenter-transition-duration) var(--proxcenter-transition-easing) !important`
    },

    // Cartes avec style inline - seulement le radius et transition
    '.MuiCard-root[style*="background"]': {
      borderRadius: 'var(--proxcenter-card-radius) !important',
      transition: `all var(--proxcenter-transition-duration) var(--proxcenter-transition-easing) !important`
    },

    // Apply button styles
    '.MuiButton-root': {
      borderRadius: 'var(--proxcenter-button-radius) !important',
      textTransform: `${themeStyles.button.textTransform} !important`,
      fontWeight: `${themeStyles.button.fontWeight} !important`,
      letterSpacing: themeStyles.button.letterSpacing || 'normal',
      transition: `all var(--proxcenter-transition-duration) var(--proxcenter-transition-easing) !important`,
      ...(themeStyles.button.boxShadow && !isLightMode && {
        boxShadow: themeStyles.button.boxShadow
      })
    },

    // Apply input styles
    '.MuiOutlinedInput-root, .MuiFilledInput-root': {
      borderRadius: 'var(--proxcenter-input-radius) !important',
      transition: `all var(--proxcenter-transition-duration) var(--proxcenter-transition-easing) !important`,
      ...(themeStyles.input.boxShadow && !isLightMode && {
        boxShadow: themeStyles.input.boxShadow
      }),
      ...(themeStyles.input.backdropFilter && !isLightMode && {
        backdropFilter: themeStyles.input.backdropFilter
      })
    },

    // Chip styles
    '.MuiChip-root': {
      borderRadius: `calc(var(--proxcenter-button-radius) * 2) !important`,
      transition: `all var(--proxcenter-transition-duration) var(--proxcenter-transition-easing) !important`
    },

    // Dialog styles
    '.MuiDialog-paper': {
      borderRadius: 'var(--proxcenter-card-radius) !important',
      backdropFilter: !isLightMode && effectiveBlur !== 'none' 
        ? effectiveBlur 
        : undefined,
      background: shouldApplyCustomBackground 
        ? themeStyles.card.background 
        : undefined
    },

    // Menu styles
    '.MuiMenu-paper, .MuiPopover-paper': {
      borderRadius: 'var(--proxcenter-card-radius) !important',
      backdropFilter: !isLightMode && effectiveBlur !== 'none' 
        ? effectiveBlur 
        : undefined,
      boxShadow: 'var(--proxcenter-card-shadow) !important'
    },

    // Tab styles
    '.MuiTab-root': {
      transition: `all var(--proxcenter-transition-duration) var(--proxcenter-transition-easing) !important`
    },

    // Tooltip
    '.MuiTooltip-tooltip': {
      borderRadius: `calc(var(--proxcenter-card-radius) / 2) !important`
    },

    // Alert
    '.MuiAlert-root': {
      borderRadius: 'var(--proxcenter-card-radius) !important'
    },

    // Apply font override for terminal theme
    ...(globalTheme.fontOverride && {
      'body, .MuiTypography-root': {
        fontFamily: `${globalTheme.fontOverride.body} !important`
      },
      'h1, h2, h3, h4, h5, h6, .MuiTypography-h1, .MuiTypography-h2, .MuiTypography-h3, .MuiTypography-h4, .MuiTypography-h5, .MuiTypography-h6': {
        fontFamily: `${globalTheme.fontOverride.heading} !important`
      }
    }),
    
    // ============================================================
    // THEME-SPECIFIC STYLES - Header, Sidebar, and accent colors
    // ============================================================
    
    // vCenter Theme - VMware vSphere Client style (exact reproduction)
    ...(globalTheme.id === 'vcenter' && {
      // Header - VMware dark blue-grey (toujours sombre, même en light mode)
      '.ts-vertical-layout-header, .ts-horizontal-layout-header': {
        backgroundColor: '#1e1e2e !important',
        borderBottom: '1px solid #333348 !important'
      },
      '.ts-vertical-layout-navbar, .ts-horizontal-layout-navbar': {
        backgroundColor: '#1e1e2e !important'
      },
      '.ts-vertical-layout-navbar *, .ts-horizontal-layout-navbar *': {
        color: '#fafafa !important'
      },
      '.ts-vertical-layout-navbar .MuiIconButton-root, .ts-horizontal-layout-navbar .MuiIconButton-root': {
        color: '#fafafa !important'
      },

      // Sidebar - VMware dark (toujours sombre)
      '.ts-vertical-nav-root, .ts-vertical-nav-container, .ts-vertical-nav-bg-color-container': {
        backgroundColor: '#14142a !important'
      },

      // Sidebar text - VMware style
      '.ts-vertical-nav-root .ts-menu-button': {
        color: '#fafafa !important',
        fontFamily: '"Clarity City", "Segoe UI", -apple-system, BlinkMacSystemFont, "Roboto", sans-serif !important',
        fontSize: '13px !important',
        fontWeight: '400 !important'
      },
      '.ts-vertical-nav-root .ts-menu-icon': {
        color: '#49afd9 !important'
      },
      '.ts-vertical-nav-root .ts-menu-section-label': {
        color: '#9a9a9a !important',
        fontFamily: '"Clarity City", "Segoe UI", -apple-system, sans-serif !important',
        fontSize: '11px !important',
        fontWeight: '600 !important',
        textTransform: 'uppercase !important',
        letterSpacing: '0.05em !important'
      },

      // Menu hover - VMware blue highlight
      '.ts-vertical-nav-root .ts-menuitem-root > .ts-menu-button:hover': {
        backgroundColor: '#333348 !important',
        color: '#ffffff !important'
      },
      '.ts-vertical-nav-root .ts-menuitem-root > .ts-menu-button:hover .ts-menu-icon': {
        color: '#49afd9 !important'
      },

      // Menu active - VMware cyan accent
      '.ts-vertical-nav-root .ts-menuitem-root.ts-active > .ts-menu-button': {
        backgroundColor: 'rgba(0, 121, 184, 0.25) !important',
        color: '#49afd9 !important',
        borderLeft: '3px solid #0079b8 !important'
      },
      '.ts-vertical-nav-root .ts-menuitem-root.ts-active > .ts-menu-button .ts-menu-icon': {
        color: '#49afd9 !important'
      },

      // vCenter horizontal header (VCenterHeader component) — colors derived from theme in component
      '.vcenter-header': {
        boxShadow: 'none !important'
      },
      // Hide the standard horizontal navigation bar shadow when vCenter header is active
      '.ts-horizontal-layout-header': {
        boxShadow: 'none !important'
      },

      // Content area background
      'main, .ts-vertical-layout-content, .ts-vertical-layout-content-wrapper, .ts-horizontal-layout-content-wrapper': {
        backgroundColor: `${isLightMode ? '#ffffff' : '#14142a'} !important`
      },
      'body': {
        backgroundColor: `${isLightMode ? '#ffffff' : '#14142a'} !important`
      },

      // Cards VMware style
      '.MuiCard-root, .MuiPaper-root:not(.no-theme-override)': {
        backgroundColor: `${isLightMode ? '#ffffff' : '#1e1e2e'} !important`,
        borderColor: `${isLightMode ? '#e0e0e0' : '#333348'} !important`
      },
      '.MuiCardContent-root, .MuiCardHeader-root': {
        backgroundColor: 'transparent !important'
      },

      // ============================================================
      // TABLES - VMware style - TOUS les tableaux
      // ============================================================
      '.MuiTable-root, .MuiTableContainer-root, table': {
        backgroundColor: `${isLightMode ? '#ffffff' : '#1e1e2e'} !important`
      },
      '.MuiTableHead-root, thead': {
        backgroundColor: `${isLightMode ? '#f4f6f8' : '#14142a'} !important`
      },
      '.MuiTableHead-root .MuiTableCell-root, thead th, thead td': {
        backgroundColor: `${isLightMode ? '#f4f6f8' : '#14142a'} !important`,
        borderBottom: `1px solid ${isLightMode ? '#e0e0e0' : '#333348'} !important`,
        color: `${isLightMode ? '#313131' : '#9a9a9a'} !important`,
        fontWeight: '600 !important',
        fontSize: '11px !important',
        textTransform: 'uppercase !important',
        letterSpacing: '0.03em !important'
      },
      '.MuiTableBody-root, tbody': {
        backgroundColor: `${isLightMode ? '#ffffff' : '#1e1e2e'} !important`
      },
      '.MuiTableBody-root .MuiTableRow-root, tbody tr': {
        backgroundColor: `${isLightMode ? '#ffffff' : '#1e1e2e'} !important`,
        '&:hover': {
          backgroundColor: `${isLightMode ? '#f0f7ff' : '#2a2a42'} !important`
        }
      },
      '.MuiTableBody-root .MuiTableRow-root:nth-of-type(even), tbody tr:nth-of-type(even)': {
        backgroundColor: `${isLightMode ? '#f9fafb' : '#252538'} !important`
      },
      '.MuiTableBody-root .MuiTableCell-root, tbody td': {
        borderBottom: `1px solid ${isLightMode ? '#e8e8e8' : '#333348'} !important`,
        color: `${isLightMode ? '#313131' : '#fafafa'} !important`
      },

      // DataGrid (si utilisé)
      '.MuiDataGrid-root': {
        backgroundColor: `${isLightMode ? '#ffffff' : '#1e1e2e'} !important`,
        borderColor: `${isLightMode ? '#e0e0e0' : '#333348'} !important`
      },
      '.MuiDataGrid-columnHeaders': {
        backgroundColor: `${isLightMode ? '#f4f6f8' : '#14142a'} !important`,
        borderColor: `${isLightMode ? '#e0e0e0' : '#333348'} !important`
      },
      '.MuiDataGrid-row': {
        backgroundColor: `${isLightMode ? '#ffffff' : '#1e1e2e'} !important`,
        '&:hover': {
          backgroundColor: `${isLightMode ? '#f0f7ff' : '#2a2a42'} !important`
        }
      },
      '.MuiDataGrid-row:nth-of-type(even)': {
        backgroundColor: `${isLightMode ? '#f9fafb' : '#252538'} !important`
      },
      '.MuiDataGrid-cell': {
        borderColor: `${isLightMode ? '#e8e8e8' : '#333348'} !important`,
        color: `${isLightMode ? '#313131' : '#fafafa'} !important`
      },

      // Virtualized tables / custom tables (only target actual table components, not MuiGrid)
      '.MuiTableContainer-root table, [class*="VirtualTable"], [class*="virtualTable"]': {
        backgroundColor: `${isLightMode ? '#ffffff' : '#1e1e2e'} !important`
      },

      // ============================================================
      // INPUTS & FORM CONTROLS - VMware style
      // ============================================================
      '.MuiOutlinedInput-root': {
        backgroundColor: `${isLightMode ? '#ffffff' : '#1e1e2e'} !important`,
        '& .MuiOutlinedInput-notchedOutline': {
          borderColor: `${isLightMode ? '#e0e0e0' : '#333348'} !important`
        },
        '&:hover .MuiOutlinedInput-notchedOutline': {
          borderColor: `${isLightMode ? '#0079b8' : '#49afd9'} !important`
        },
        '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
          borderColor: '#0079b8 !important',
          borderWidth: '2px !important'
        }
      },
      '.MuiInputBase-input': {
        color: `${isLightMode ? '#313131' : '#fafafa'} !important`
      },
      '.MuiInputLabel-root': {
        color: `${isLightMode ? '#737373' : '#9a9a9a'} !important`
      },
      '.MuiSelect-select': {
        backgroundColor: `${isLightMode ? '#ffffff' : '#1e1e2e'} !important`
      },

      // ============================================================
      // CHIPS & BADGES - VMware style
      // ============================================================
      '.MuiChip-root': {
        fontWeight: '500 !important',
        fontSize: '11px !important'
      },
      '.MuiChip-colorSuccess': {
        backgroundColor: `${isLightMode ? '#e8f5e9' : 'rgba(98, 164, 32, 0.2)'} !important`,
        color: `${isLightMode ? '#2e7d32' : '#62a420'} !important`
      },
      '.MuiChip-colorError': {
        backgroundColor: `${isLightMode ? '#ffebee' : 'rgba(201, 33, 0, 0.2)'} !important`,
        color: `${isLightMode ? '#c62828' : '#ff6b6b'} !important`
      },
      '.MuiChip-colorWarning': {
        backgroundColor: `${isLightMode ? '#fff3e0' : 'rgba(239, 192, 6, 0.2)'} !important`,
        color: `${isLightMode ? '#e65100' : '#efc006'} !important`
      },
      '.MuiChip-colorInfo': {
        backgroundColor: `${isLightMode ? '#e3f2fd' : 'rgba(0, 121, 184, 0.2)'} !important`,
        color: `${isLightMode ? '#0079b8' : '#49afd9'} !important`
      },

      // ============================================================
      // TABS - VMware style
      // ============================================================
      '.MuiTabs-root': {
        borderBottom: `1px solid ${isLightMode ? '#e0e0e0' : '#333348'} !important`
      },
      '.MuiTab-root': {
        color: `${isLightMode ? '#737373' : '#9a9a9a'} !important`,
        fontWeight: '500 !important',
        textTransform: 'none !important',
        '&.Mui-selected': {
          color: '#0079b8 !important'
        }
      },
      '.MuiTabs-indicator': {
        backgroundColor: '#0079b8 !important'
      },

      // ============================================================
      // BUTTONS - VMware style
      // ============================================================
      '.MuiButton-root': {
        fontFamily: '"Clarity City", "Segoe UI", sans-serif !important',
        textTransform: 'none !important',
        fontWeight: '500 !important'
      },
      '.MuiButton-containedPrimary': {
        backgroundColor: '#0079b8 !important',
        '&:hover': {
          backgroundColor: '#005d91 !important'
        }
      },
      '.MuiButton-outlinedPrimary': {
        borderColor: '#0079b8 !important',
        color: '#0079b8 !important',
        '&:hover': {
          backgroundColor: 'rgba(0, 121, 184, 0.08) !important'
        }
      },
      '.MuiIconButton-root': {
        color: `${isLightMode ? '#737373' : '#9a9a9a'} !important`,
        '&:hover': {
          backgroundColor: `${isLightMode ? 'rgba(0, 121, 184, 0.08)' : 'rgba(73, 175, 217, 0.15)'} !important`,
          color: '#0079b8 !important'
        }
      },

      // ============================================================
      // DIALOGS & MENUS - VMware style
      // ============================================================
      '.MuiDialog-paper, .MuiPopover-paper:not(.no-theme-override), .MuiMenu-paper': {
        backgroundColor: `${isLightMode ? '#ffffff' : '#1e1e2e'} !important`,
        border: `1px solid ${isLightMode ? '#e0e0e0' : '#333348'} !important`
      },
      '.MuiMenuItem-root': {
        '&:hover': {
          backgroundColor: `${isLightMode ? '#f0f7ff' : '#2a2a42'} !important`
        },
        '&.Mui-selected': {
          backgroundColor: `${isLightMode ? '#e3f2fd' : 'rgba(0, 121, 184, 0.2)'} !important`
        }
      },

      // ============================================================
      // DIVIDERS & BORDERS - VMware style
      // ============================================================
      '.MuiDivider-root': {
        borderColor: `${isLightMode ? '#e0e0e0' : '#333348'} !important`
      },

      // ============================================================
      // SCROLLBARS - VMware style
      // ============================================================
      '*::-webkit-scrollbar': {
        width: '8px !important',
        height: '8px !important'
      },
      '*::-webkit-scrollbar-track': {
        backgroundColor: `${isLightMode ? '#f4f6f8' : '#14142a'} !important`
      },
      '*::-webkit-scrollbar-thumb': {
        backgroundColor: `${isLightMode ? '#c4c4c4' : '#333348'} !important`,
        borderRadius: '4px !important',
        '&:hover': {
          backgroundColor: `${isLightMode ? '#a0a0a0' : '#49afd9'} !important`
        }
      },

      // ============================================================
      // TOOLTIPS - VMware style
      // ============================================================
      '.MuiTooltip-tooltip': {
        backgroundColor: `${isLightMode ? '#313131' : '#1e1e2e'} !important`,
        color: '#fafafa !important',
        border: `1px solid ${isLightMode ? '#313131' : '#333348'} !important`,
        fontSize: '12px !important'
      },

      // ============================================================
      // PROGRESS BARS - VMware style
      // ============================================================
      '.MuiLinearProgress-root': {
        backgroundColor: `${isLightMode ? '#e0e0e0' : '#333348'} !important`
      },
      '.MuiLinearProgress-bar': {
        backgroundColor: '#0079b8 !important'
      },

      // Typography
      'body, .MuiTypography-root': {
        fontFamily: '"Clarity City", "Segoe UI", -apple-system, BlinkMacSystemFont, "Roboto", sans-serif !important'
      }
    }),

    // Proxmox Classic Theme
    ...(globalTheme.id === 'proxmoxClassic' && {
      // Header - Proxmox blue-grey
      '.ts-vertical-layout-header, .ts-horizontal-layout-header': {
        backgroundColor: '#354759 !important',
        borderBottom: '1px solid #4a6785 !important'
      },
      '.ts-vertical-layout-navbar, .ts-horizontal-layout-navbar': {
        backgroundColor: '#354759 !important'
      },
      '.ts-vertical-layout-navbar *, .ts-horizontal-layout-navbar *': {
        color: '#ffffff !important'
      },

      // Sidebar - Dark Proxmox
      '.ts-vertical-nav-root, .ts-vertical-nav-container, .ts-vertical-nav-bg-color-container': {
        backgroundColor: '#2a3a4a !important'
      },
      '.ts-vertical-nav-root .ts-menu-button': {
        color: '#c8d4e0 !important'
      },
      '.ts-vertical-nav-root .ts-menu-icon': {
        color: '#e57000 !important'
      },
      '.ts-vertical-nav-root .ts-menu-section-label': {
        color: '#6a8aa8 !important',
        textTransform: 'uppercase !important',
        fontSize: '11px !important',
        fontWeight: '600 !important'
      },
      '.ts-vertical-nav-root .ts-menuitem-root > .ts-menu-button:hover': {
        backgroundColor: 'rgba(229, 112, 0, 0.15) !important',
        color: '#ffffff !important'
      },
      '.ts-vertical-nav-root .ts-menuitem-root.ts-active > .ts-menu-button': {
        backgroundColor: 'rgba(229, 112, 0, 0.25) !important',
        color: '#ffffff !important',
        borderLeft: '3px solid #e57000 !important'
      },
      '.ts-vertical-nav-root .ts-menuitem-root.ts-active > .ts-menu-button .ts-menu-icon': {
        color: '#e57000 !important'
      },

      // Content area
      'main, .ts-vertical-layout-content': {
        backgroundColor: `${isLightMode ? '#f5f5f5' : '#1e2a38'} !important`
      },

      // Cards
      '.MuiCard-root': {
        backgroundColor: `${isLightMode ? '#ffffff' : '#2a3a4a'} !important`,
        borderColor: `${isLightMode ? '#ddd' : '#4a6785'} !important`
      },

      // Tables
      '.MuiTableHead-root .MuiTableCell-root': {
        backgroundColor: `${isLightMode ? '#f0f0f0' : '#354759'} !important`,
        borderBottom: `1px solid ${isLightMode ? '#ddd' : '#4a6785'} !important`,
        color: `${isLightMode ? '#333' : '#c8d4e0'} !important`,
        fontWeight: '600 !important'
      },
      '.MuiTableBody-root .MuiTableRow-root': {
        backgroundColor: `${isLightMode ? '#ffffff' : '#2a3a4a'} !important`,
        '&:hover': {
          backgroundColor: `${isLightMode ? '#fff5eb' : '#354759'} !important`
        }
      },
      '.MuiTableBody-root .MuiTableRow-root:nth-of-type(even)': {
        backgroundColor: `${isLightMode ? '#fafafa' : '#2f4050'} !important`
      },
      '.MuiTableBody-root .MuiTableCell-root': {
        borderBottom: `1px solid ${isLightMode ? '#eee' : '#4a6785'} !important`
      },

      // Inputs
      '.MuiOutlinedInput-root': {
        backgroundColor: `${isLightMode ? '#ffffff' : '#2a3a4a'} !important`,
        '& .MuiOutlinedInput-notchedOutline': {
          borderColor: `${isLightMode ? '#ccc' : '#4a6785'} !important`
        },
        '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
          borderColor: '#e57000 !important'
        }
      },

      // Buttons
      '.MuiButton-containedPrimary': {
        backgroundColor: '#e57000 !important',
        '&:hover': {
          backgroundColor: '#c96000 !important'
        }
      },

      // Tabs
      '.MuiTab-root.Mui-selected': {
        color: '#e57000 !important'
      },
      '.MuiTabs-indicator': {
        backgroundColor: '#e57000 !important'
      },

      // Dividers
      '.MuiDivider-root': {
        borderColor: `${isLightMode ? '#ddd' : '#4a6785'} !important`
      }
    }),

    // Terminal Theme - Hacker style - TOUT EN VERT
    ...(globalTheme.id === 'terminal' && {
      // Header
      '.ts-vertical-layout-header, .ts-horizontal-layout-header': {
        backgroundColor: '#0d1117 !important',
        borderBottom: '1px solid #30363d !important'
      },
      '.ts-vertical-layout-navbar, .ts-horizontal-layout-navbar': {
        backgroundColor: '#0d1117 !important'
      },
      '.ts-vertical-layout-navbar *, .ts-horizontal-layout-navbar *': {
        color: '#00ff00 !important'
      },

      // Sidebar
      '.ts-vertical-nav-root, .ts-vertical-nav-container, .ts-vertical-nav-bg-color-container': {
        backgroundColor: '#0d1117 !important',
        borderRight: '1px solid #30363d !important'
      },
      '.ts-vertical-nav-root .ts-menu-button': {
        color: '#00ff00 !important',
        fontFamily: '"JetBrains Mono", "Fira Code", monospace !important'
      },
      '.ts-vertical-nav-root .ts-menu-icon': {
        color: '#00cc00 !important'
      },
      '.ts-vertical-nav-root .ts-menu-section-label': {
        color: '#008800 !important',
        fontFamily: '"JetBrains Mono", "Fira Code", monospace !important',
        textTransform: 'uppercase !important'
      },
      '.ts-vertical-nav-root .ts-menuitem-root > .ts-menu-button:hover': {
        backgroundColor: 'rgba(0, 255, 0, 0.1) !important',
        color: '#00ff00 !important',
        textShadow: '0 0 10px #00ff00 !important'
      },
      '.ts-vertical-nav-root .ts-menuitem-root.ts-active > .ts-menu-button': {
        backgroundColor: 'rgba(0, 255, 0, 0.15) !important',
        color: '#00ff00 !important',
        borderLeft: '3px solid #00ff00 !important',
        textShadow: '0 0 10px #00ff00 !important'
      },

      // ============================================================
      // GLOBAL - Tout le contenu en vert sur fond noir
      // ============================================================
      'main, .ts-vertical-layout-content, .ts-vertical-layout-content-wrapper': {
        backgroundColor: '#0d1117 !important'
      },
      'body': {
        backgroundColor: '#0d1117 !important'
      },

      // ALL TEXT GREEN
      'body, p, span, div, h1, h2, h3, h4, h5, h6, label, a': {
        color: '#00ff00 !important',
        fontFamily: '"JetBrains Mono", "Fira Code", monospace !important'
      },
      '.MuiTypography-root': {
        color: '#00ff00 !important',
        fontFamily: '"JetBrains Mono", "Fira Code", monospace !important'
      },

      // Muted text (secondary)
      '.MuiTypography-colorTextSecondary, [class*="text-secondary"], [class*="textSecondary"]': {
        color: '#00aa00 !important'
      },

      // ============================================================
      // CARDS - Fond noir, bordure verte
      // ============================================================
      '.MuiCard-root, .MuiPaper-root': {
        backgroundColor: '#0d1117 !important',
        borderColor: '#30363d !important',
        border: '1px solid #30363d !important'
      },
      '.MuiCardContent-root, .MuiCardHeader-root': {
        backgroundColor: '#0d1117 !important'
      },

      // ============================================================
      // TABLES - Terminal style complet
      // ============================================================
      '.MuiTable-root, .MuiTableContainer-root': {
        backgroundColor: '#0d1117 !important'
      },
      '.MuiTableHead-root': {
        backgroundColor: '#161b22 !important'
      },
      '.MuiTableHead-root .MuiTableCell-root': {
        backgroundColor: '#161b22 !important',
        borderBottom: '1px solid #30363d !important',
        color: '#00ff00 !important',
        fontFamily: '"JetBrains Mono", monospace !important',
        textTransform: 'uppercase !important',
        fontWeight: '600 !important'
      },
      '.MuiTableBody-root .MuiTableRow-root': {
        backgroundColor: '#0d1117 !important',
        '&:hover': {
          backgroundColor: '#1a2332 !important'
        }
      },
      '.MuiTableBody-root .MuiTableRow-root:nth-of-type(even)': {
        backgroundColor: '#111922 !important'
      },
      '.MuiTableBody-root .MuiTableCell-root': {
        borderBottom: '1px solid #21262d !important',
        color: '#00ff00 !important',
        fontFamily: '"JetBrains Mono", monospace !important'
      },

      // ============================================================
      // INPUTS - Terminal style
      // ============================================================
      '.MuiOutlinedInput-root, .MuiInputBase-root': {
        backgroundColor: '#0d1117 !important',
        fontFamily: '"JetBrains Mono", monospace !important',
        '& .MuiOutlinedInput-notchedOutline': {
          borderColor: '#30363d !important'
        },
        '&:hover .MuiOutlinedInput-notchedOutline': {
          borderColor: '#00aa00 !important'
        },
        '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
          borderColor: '#00ff00 !important',
          boxShadow: '0 0 10px rgba(0, 255, 0, 0.3) !important'
        }
      },
      '.MuiInputBase-input': {
        color: '#00ff00 !important',
        fontFamily: '"JetBrains Mono", monospace !important'
      },
      '.MuiInputLabel-root': {
        color: '#00aa00 !important',
        fontFamily: '"JetBrains Mono", monospace !important'
      },
      '.MuiSelect-select': {
        color: '#00ff00 !important',
        backgroundColor: '#0d1117 !important'
      },

      // ============================================================
      // BUTTONS - Terminal style
      // ============================================================
      '.MuiButton-root': {
        fontFamily: '"JetBrains Mono", monospace !important',
        textTransform: 'uppercase !important',
        borderRadius: '0 !important'
      },
      '.MuiButton-containedPrimary': {
        backgroundColor: '#238636 !important',
        color: '#ffffff !important',
        '&:hover': {
          backgroundColor: '#2ea043 !important',
          boxShadow: '0 0 15px rgba(0, 255, 0, 0.4) !important'
        }
      },
      '.MuiButton-outlinedPrimary': {
        borderColor: '#00ff00 !important',
        color: '#00ff00 !important',
        '&:hover': {
          backgroundColor: 'rgba(0, 255, 0, 0.1) !important'
        }
      },
      '.MuiButton-text': {
        color: '#00ff00 !important'
      },
      '.MuiIconButton-root': {
        color: '#00ff00 !important',
        '&:hover': {
          backgroundColor: 'rgba(0, 255, 0, 0.1) !important'
        }
      },

      // ============================================================
      // CHIPS - Terminal style (carrés)
      // ============================================================
      '.MuiChip-root': {
        fontFamily: '"JetBrains Mono", monospace !important',
        borderRadius: '0 !important',
        backgroundColor: '#161b22 !important',
        color: '#00ff00 !important',
        border: '1px solid #30363d !important'
      },
      '.MuiChip-colorSuccess': {
        backgroundColor: 'rgba(0, 255, 0, 0.15) !important',
        color: '#00ff00 !important',
        border: '1px solid #00ff00 !important'
      },
      '.MuiChip-colorError': {
        backgroundColor: 'rgba(255, 0, 0, 0.15) !important',
        color: '#ff4444 !important',
        border: '1px solid #ff4444 !important'
      },
      '.MuiChip-colorWarning': {
        backgroundColor: 'rgba(255, 165, 0, 0.15) !important',
        color: '#ffa500 !important',
        border: '1px solid #ffa500 !important'
      },
      '.MuiChip-colorInfo': {
        backgroundColor: 'rgba(0, 255, 255, 0.15) !important',
        color: '#00ffff !important',
        border: '1px solid #00ffff !important'
      },

      // ============================================================
      // TABS - Terminal style
      // ============================================================
      '.MuiTabs-root': {
        borderBottom: '1px solid #30363d !important'
      },
      '.MuiTab-root': {
        color: '#00aa00 !important',
        fontFamily: '"JetBrains Mono", monospace !important',
        textTransform: 'uppercase !important',
        '&.Mui-selected': {
          color: '#00ff00 !important',
          textShadow: '0 0 10px #00ff00 !important'
        }
      },
      '.MuiTabs-indicator': {
        backgroundColor: '#00ff00 !important',
        boxShadow: '0 0 10px #00ff00 !important'
      },

      // ============================================================
      // DIALOGS & MENUS - Terminal style
      // ============================================================
      '.MuiDialog-paper, .MuiPopover-paper, .MuiMenu-paper': {
        backgroundColor: '#0d1117 !important',
        border: '1px solid #30363d !important',
        color: '#00ff00 !important'
      },
      '.MuiMenuItem-root': {
        color: '#00ff00 !important',
        fontFamily: '"JetBrains Mono", monospace !important',
        '&:hover': {
          backgroundColor: 'rgba(0, 255, 0, 0.1) !important'
        }
      },
      '.MuiListItemIcon-root': {
        color: '#00ff00 !important'
      },

      // ============================================================
      // DIVIDERS & BORDERS
      // ============================================================
      '.MuiDivider-root': {
        borderColor: '#30363d !important'
      },

      // ============================================================
      // TOOLTIPS
      // ============================================================
      '.MuiTooltip-tooltip': {
        backgroundColor: '#161b22 !important',
        color: '#00ff00 !important',
        border: '1px solid #30363d !important',
        fontFamily: '"JetBrains Mono", monospace !important'
      },

      // ============================================================
      // PROGRESS BARS
      // ============================================================
      '.MuiLinearProgress-root': {
        backgroundColor: '#30363d !important'
      },
      '.MuiLinearProgress-bar': {
        backgroundColor: '#00ff00 !important'
      },

      // ============================================================
      // SCROLLBARS
      // ============================================================
      '*::-webkit-scrollbar': {
        width: '8px !important',
        height: '8px !important'
      },
      '*::-webkit-scrollbar-track': {
        backgroundColor: '#0d1117 !important'
      },
      '*::-webkit-scrollbar-thumb': {
        backgroundColor: '#30363d !important',
        '&:hover': {
          backgroundColor: '#00ff00 !important'
        }
      },

      // ============================================================
      // ICONS
      // ============================================================
      'i, [class^="ri-"], [class*=" ri-"], .MuiSvgIcon-root': {
        color: '#00ff00 !important'
      },

      // ============================================================
      // LINKS
      // ============================================================
      'a, .MuiLink-root': {
        color: '#00ff00 !important',
        '&:hover': {
          color: '#44ff44 !important',
          textShadow: '0 0 5px #00ff00 !important'
        }
      },

      // ============================================================
      // ALERTS
      // ============================================================
      '.MuiAlert-root': {
        backgroundColor: '#161b22 !important',
        border: '1px solid #30363d !important'
      },
      '.MuiAlert-message': {
        color: '#00ff00 !important'
      },

      // ============================================================
      // BADGES
      // ============================================================
      '.MuiBadge-badge': {
        backgroundColor: '#00ff00 !important',
        color: '#0d1117 !important'
      },

      // ============================================================
      // TREE VIEW / LISTS
      // ============================================================
      '.MuiTreeItem-root, .MuiListItem-root, .MuiListItemButton-root': {
        color: '#00ff00 !important',
        '&:hover': {
          backgroundColor: 'rgba(0, 255, 0, 0.1) !important'
        }
      },
      '.MuiTreeItem-label': {
        color: '#00ff00 !important',
        fontFamily: '"JetBrains Mono", monospace !important'
      }
    }),

    // Cyberpunk Theme - Neon style - MAGENTA/CYAN COMPLET
    ...(globalTheme.id === 'cyberpunk' && {
      // Header
      '.ts-vertical-layout-header, .ts-horizontal-layout-header': {
        backgroundColor: '#0a0a0f !important',
        borderBottom: '1px solid rgba(255, 0, 255, 0.4) !important',
        boxShadow: '0 0 20px rgba(255, 0, 255, 0.2), inset 0 -1px 0 rgba(0, 255, 255, 0.2) !important'
      },
      '.ts-vertical-layout-navbar, .ts-horizontal-layout-navbar': {
        backgroundColor: '#0a0a0f !important'
      },
      '.ts-vertical-layout-navbar *, .ts-horizontal-layout-navbar *': {
        color: '#ff00ff !important'
      },

      // Sidebar
      '.ts-vertical-nav-root, .ts-vertical-nav-container, .ts-vertical-nav-bg-color-container': {
        backgroundColor: '#0a0a0f !important',
        borderRight: '1px solid rgba(255, 0, 255, 0.3) !important'
      },
      '.ts-vertical-nav-root .ts-menu-button': {
        color: '#e0e0e0 !important'
      },
      '.ts-vertical-nav-root .ts-menu-icon': {
        color: '#ff00ff !important'
      },
      '.ts-vertical-nav-root .ts-menu-section-label': {
        color: '#00ffff !important',
        textTransform: 'uppercase !important',
        letterSpacing: '0.1em !important'
      },
      '.ts-vertical-nav-root .ts-menuitem-root > .ts-menu-button:hover': {
        backgroundColor: 'rgba(255, 0, 255, 0.15) !important',
        color: '#ff00ff !important',
        textShadow: '0 0 10px #ff00ff !important'
      },
      '.ts-vertical-nav-root .ts-menuitem-root.ts-active > .ts-menu-button': {
        backgroundColor: 'rgba(255, 0, 255, 0.2) !important',
        color: '#00ffff !important',
        borderLeft: '3px solid #ff00ff !important'
      },
      '.ts-vertical-nav-root .ts-menuitem-root.ts-active > .ts-menu-button .ts-menu-icon': {
        color: '#00ffff !important'
      },

      // ============================================================
      // GLOBAL - Fond noir, texte magenta/cyan
      // ============================================================
      'main, .ts-vertical-layout-content, .ts-vertical-layout-content-wrapper, body': {
        backgroundColor: '#0a0a0f !important'
      },
      'body, p, span, div, h1, h2, h3, h4, h5, h6, label': {
        color: '#e0e0e0 !important'
      },
      '.MuiTypography-root': {
        color: '#e0e0e0 !important'
      },
      '.MuiTypography-colorTextSecondary': {
        color: '#888 !important'
      },

      // ============================================================
      // CARDS - Cyberpunk style
      // ============================================================
      '.MuiCard-root, .MuiPaper-root': {
        backgroundColor: '#12121a !important',
        border: '1px solid rgba(255, 0, 255, 0.2) !important',
        boxShadow: '0 0 10px rgba(255, 0, 255, 0.1) !important'
      },

      // ============================================================
      // TABLES - Cyberpunk style
      // ============================================================
      '.MuiTable-root, .MuiTableContainer-root': {
        backgroundColor: '#0a0a0f !important'
      },
      '.MuiTableHead-root .MuiTableCell-root': {
        backgroundColor: '#12121a !important',
        borderBottom: '1px solid rgba(255, 0, 255, 0.3) !important',
        color: '#00ffff !important',
        textTransform: 'uppercase !important',
        letterSpacing: '0.05em !important'
      },
      '.MuiTableBody-root .MuiTableRow-root': {
        backgroundColor: '#0a0a0f !important',
        '&:hover': {
          backgroundColor: 'rgba(255, 0, 255, 0.1) !important'
        }
      },
      '.MuiTableBody-root .MuiTableRow-root:nth-of-type(even)': {
        backgroundColor: '#0f0f18 !important'
      },
      '.MuiTableBody-root .MuiTableCell-root': {
        borderBottom: '1px solid rgba(255, 0, 255, 0.15) !important',
        color: '#e0e0e0 !important'
      },

      // ============================================================
      // INPUTS - Cyberpunk style
      // ============================================================
      '.MuiOutlinedInput-root, .MuiInputBase-root': {
        backgroundColor: '#12121a !important',
        '& .MuiOutlinedInput-notchedOutline': {
          borderColor: 'rgba(255, 0, 255, 0.3) !important'
        },
        '&:hover .MuiOutlinedInput-notchedOutline': {
          borderColor: '#ff00ff !important'
        },
        '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
          borderColor: '#00ffff !important',
          boxShadow: '0 0 10px rgba(0, 255, 255, 0.3) !important'
        }
      },
      '.MuiInputBase-input': {
        color: '#e0e0e0 !important'
      },
      '.MuiInputLabel-root': {
        color: '#888 !important'
      },

      // ============================================================
      // BUTTONS - Cyberpunk style
      // ============================================================
      '.MuiButton-containedPrimary': {
        backgroundColor: '#ff00ff !important',
        color: '#ffffff !important',
        boxShadow: '0 0 15px rgba(255, 0, 255, 0.4) !important',
        '&:hover': {
          backgroundColor: '#cc00cc !important',
          boxShadow: '0 0 25px rgba(255, 0, 255, 0.6) !important'
        }
      },
      '.MuiButton-outlinedPrimary': {
        borderColor: '#ff00ff !important',
        color: '#ff00ff !important',
        '&:hover': {
          backgroundColor: 'rgba(255, 0, 255, 0.1) !important',
          boxShadow: '0 0 10px rgba(255, 0, 255, 0.3) !important'
        }
      },
      '.MuiIconButton-root': {
        color: '#ff00ff !important',
        '&:hover': {
          backgroundColor: 'rgba(255, 0, 255, 0.1) !important'
        }
      },

      // ============================================================
      // CHIPS - Cyberpunk style
      // ============================================================
      '.MuiChip-root': {
        backgroundColor: 'rgba(255, 0, 255, 0.15) !important',
        color: '#ff00ff !important',
        border: '1px solid rgba(255, 0, 255, 0.3) !important'
      },
      '.MuiChip-colorSuccess': {
        backgroundColor: 'rgba(0, 255, 255, 0.15) !important',
        color: '#00ffff !important',
        border: '1px solid #00ffff !important'
      },
      '.MuiChip-colorError': {
        backgroundColor: 'rgba(255, 50, 50, 0.15) !important',
        color: '#ff3232 !important',
        border: '1px solid #ff3232 !important'
      },
      '.MuiChip-colorWarning': {
        backgroundColor: 'rgba(255, 200, 0, 0.15) !important',
        color: '#ffc800 !important',
        border: '1px solid #ffc800 !important'
      },

      // ============================================================
      // TABS - Cyberpunk style
      // ============================================================
      '.MuiTabs-root': {
        borderBottom: '1px solid rgba(255, 0, 255, 0.3) !important'
      },
      '.MuiTab-root': {
        color: '#888 !important',
        '&.Mui-selected': {
          color: '#00ffff !important',
          textShadow: '0 0 10px #00ffff !important'
        }
      },
      '.MuiTabs-indicator': {
        backgroundColor: '#ff00ff !important',
        boxShadow: '0 0 10px #ff00ff !important'
      },

      // ============================================================
      // DIALOGS & MENUS
      // ============================================================
      '.MuiDialog-paper, .MuiPopover-paper, .MuiMenu-paper': {
        backgroundColor: '#12121a !important',
        border: '1px solid rgba(255, 0, 255, 0.3) !important'
      },
      '.MuiMenuItem-root': {
        color: '#e0e0e0 !important',
        '&:hover': {
          backgroundColor: 'rgba(255, 0, 255, 0.15) !important',
          color: '#ff00ff !important'
        }
      },

      // ============================================================
      // DIVIDERS
      // ============================================================
      '.MuiDivider-root': {
        borderColor: 'rgba(255, 0, 255, 0.2) !important'
      },

      // ============================================================
      // SCROLLBARS
      // ============================================================
      '*::-webkit-scrollbar-track': {
        backgroundColor: '#0a0a0f !important'
      },
      '*::-webkit-scrollbar-thumb': {
        backgroundColor: 'rgba(255, 0, 255, 0.3) !important',
        '&:hover': {
          backgroundColor: '#ff00ff !important'
        }
      },

      // ============================================================
      // ICONS
      // ============================================================
      'i, [class^="ri-"], [class*=" ri-"], .MuiSvgIcon-root': {
        color: '#ff00ff !important'
      },

      // ============================================================
      // PROGRESS & BADGES
      // ============================================================
      '.MuiLinearProgress-bar': {
        backgroundColor: '#ff00ff !important'
      },
      '.MuiBadge-badge': {
        backgroundColor: '#ff00ff !important'
      },

      // ============================================================
      // TREE VIEW / LISTS
      // ============================================================
      '.MuiTreeItem-root, .MuiListItem-root': {
        color: '#e0e0e0 !important',
        '&:hover': {
          backgroundColor: 'rgba(255, 0, 255, 0.1) !important'
        }
      }
    }),

    // Nord Theme - Arctic palette
    ...(globalTheme.id === 'nord' && {
      // Header - Polar Night
      '.ts-vertical-layout-header, .ts-horizontal-layout-header': {
        backgroundColor: '#2e3440 !important',
        borderBottom: '1px solid #3b4252 !important'
      },
      '.ts-vertical-layout-navbar, .ts-horizontal-layout-navbar': {
        backgroundColor: '#2e3440 !important'
      },
      '.ts-vertical-layout-navbar *, .ts-horizontal-layout-navbar *': {
        color: '#eceff4 !important'
      },

      // Sidebar
      '.ts-vertical-nav-root, .ts-vertical-nav-container, .ts-vertical-nav-bg-color-container': {
        backgroundColor: '#3b4252 !important'
      },
      '.ts-vertical-nav-root .ts-menu-button': {
        color: '#d8dee9 !important'
      },
      '.ts-vertical-nav-root .ts-menu-icon': {
        color: '#81a1c1 !important'
      },
      '.ts-vertical-nav-root .ts-menu-section-label': {
        color: '#4c566a !important'
      },
      '.ts-vertical-nav-root .ts-menuitem-root > .ts-menu-button:hover': {
        backgroundColor: '#434c5e !important',
        color: '#eceff4 !important'
      },
      '.ts-vertical-nav-root .ts-menuitem-root.ts-active > .ts-menu-button': {
        backgroundColor: 'rgba(136, 192, 208, 0.2) !important',
        color: '#88c0d0 !important',
        borderLeft: '3px solid #88c0d0 !important'
      },
      '.ts-vertical-nav-root .ts-menuitem-root.ts-active > .ts-menu-button .ts-menu-icon': {
        color: '#88c0d0 !important'
      },

      // Content area in light mode
      ...(isLightMode && {
        'main, .ts-vertical-layout-content': {
          backgroundColor: '#eceff4 !important'
        }
      })
    }),

    // Dracula Theme
    ...(globalTheme.id === 'dracula' && {
      // Header
      '.ts-vertical-layout-header, .ts-horizontal-layout-header': {
        backgroundColor: '#282a36 !important',
        borderBottom: '1px solid #44475a !important'
      },
      '.ts-vertical-layout-navbar, .ts-horizontal-layout-navbar': {
        backgroundColor: '#282a36 !important'
      },
      '.ts-vertical-layout-navbar *, .ts-horizontal-layout-navbar *': {
        color: '#f8f8f2 !important'
      },

      // Sidebar
      '.ts-vertical-nav-root, .ts-vertical-nav-container, .ts-vertical-nav-bg-color-container': {
        backgroundColor: '#21222c !important'
      },
      '.ts-vertical-nav-root .ts-menu-button': {
        color: '#f8f8f2 !important'
      },
      '.ts-vertical-nav-root .ts-menu-icon': {
        color: '#bd93f9 !important'
      },
      '.ts-vertical-nav-root .ts-menu-section-label': {
        color: '#6272a4 !important'
      },
      '.ts-vertical-nav-root .ts-menuitem-root > .ts-menu-button:hover': {
        backgroundColor: '#44475a !important',
        color: '#f8f8f2 !important'
      },
      '.ts-vertical-nav-root .ts-menuitem-root.ts-active > .ts-menu-button': {
        backgroundColor: 'rgba(189, 147, 249, 0.2) !important',
        color: '#bd93f9 !important',
        borderLeft: '3px solid #bd93f9 !important'
      },
      '.ts-vertical-nav-root .ts-menuitem-root.ts-active > .ts-menu-button .ts-menu-icon': {
        color: '#ff79c6 !important'
      },

      // Content area in light mode
      ...(isLightMode && {
        'main, .ts-vertical-layout-content': {
          backgroundColor: '#f8f8f2 !important'
        }
      })
    }),

    // One Dark Theme (Atom/VS Code)
    ...(globalTheme.id === 'oneDark' && {
      // Header
      '.ts-vertical-layout-header, .ts-horizontal-layout-header': {
        backgroundColor: '#21252b !important',
        borderBottom: '1px solid #181a1f !important'
      },
      '.ts-vertical-layout-navbar, .ts-horizontal-layout-navbar': {
        backgroundColor: '#21252b !important'
      },
      '.ts-vertical-layout-navbar *, .ts-horizontal-layout-navbar *': {
        color: '#abb2bf !important'
      },

      // Sidebar
      '.ts-vertical-nav-root, .ts-vertical-nav-container, .ts-vertical-nav-bg-color-container': {
        backgroundColor: '#282c34 !important'
      },
      '.ts-vertical-nav-root .ts-menu-button': {
        color: '#abb2bf !important'
      },
      '.ts-vertical-nav-root .ts-menu-icon': {
        color: '#61afef !important'
      },
      '.ts-vertical-nav-root .ts-menu-section-label': {
        color: '#5c6370 !important'
      },
      '.ts-vertical-nav-root .ts-menuitem-root > .ts-menu-button:hover': {
        backgroundColor: '#2c313a !important',
        color: '#d7dae0 !important'
      },
      '.ts-vertical-nav-root .ts-menuitem-root.ts-active > .ts-menu-button': {
        backgroundColor: 'rgba(97, 175, 239, 0.15) !important',
        color: '#61afef !important',
        borderLeft: '3px solid #61afef !important'
      },
      '.ts-vertical-nav-root .ts-menuitem-root.ts-active > .ts-menu-button .ts-menu-icon': {
        color: '#61afef !important'
      },

      // Content area in light mode  
      ...(isLightMode && {
        'main, .ts-vertical-layout-content': {
          backgroundColor: '#fafafa !important'
        }
      })
    }),

    // Glassmorphism Theme - special glass effects on sidebar too
    ...(globalTheme.id === 'glassmorphism' && !isLightMode && {
      // Sidebar with glass effect
      '.ts-vertical-nav-root, .ts-vertical-nav-container, .ts-vertical-nav-bg-color-container': {
        backgroundColor: 'rgba(30, 30, 45, 0.8) !important',
        backdropFilter: `${effectiveBlur} !important`,
        borderRight: '1px solid rgba(255, 255, 255, 0.08) !important'
      },
      '.ts-vertical-layout-header, .ts-horizontal-layout-header': {
        backgroundColor: 'rgba(30, 30, 45, 0.85) !important',
        backdropFilter: `${effectiveBlur} !important`,
        borderBottom: '1px solid rgba(255, 255, 255, 0.08) !important'
      },
      '.ts-vertical-layout-navbar, .ts-horizontal-layout-navbar': {
        backgroundColor: 'transparent !important'
      }
    }),

    // Neumorphism Theme - soft shadows
    ...(globalTheme.id === 'neumorphism' && !isLightMode && {
      '.ts-vertical-nav-root, .ts-vertical-nav-container, .ts-vertical-nav-bg-color-container': {
        backgroundColor: '#1e1e2d !important',
        boxShadow: 'inset -4px 0 8px rgba(0,0,0,0.3), inset 4px 0 8px rgba(255,255,255,0.02) !important'
      }
    })
  }
}

const CustomThemeProvider = props => {
  // Props
  const { children, direction, systemMode } = props

  // Vars
  const isServer = typeof window === 'undefined'
  let currentMode

  // Hooks
  const { settings } = useSettings()
  const isDark = useMedia('(prefers-color-scheme: dark)', systemMode === 'dark')

  if (isServer) {
    currentMode = systemMode
  } else {
    if (settings.mode === 'system') {
      currentMode = isDark ? 'dark' : 'light'
    } else {
      currentMode = settings.mode
    }
  }

  // Get global theme configuration
  const globalTheme = useMemo(() => {
    return getGlobalTheme(settings.globalTheme || 'default')
  }, [settings.globalTheme])

  // Get light background configuration
  const lightBg = useMemo(() => {
    return getLightBackground(settings.lightBackground || 'neutral')
  }, [settings.lightBackground])

  // Generate global styles for the selected theme
  const globalStyles = useMemo(() => {
    const customBorderRadius = settings.customBorderRadius
    const blurIntensity = settings.blurIntensity
    const fontSize = settings.fontSize
    const uiScale = settings.uiScale
    const baseStyles = getGlobalThemeStyles(globalTheme, currentMode, customBorderRadius, blurIntensity, fontSize, uiScale)
    
    // Add light background overrides if in light mode (for non-neutral tints)
    if (currentMode === 'light' && lightBg.id !== 'neutral') {
      return {
        ...baseStyles,
        ':root': {
          ...baseStyles[':root'],
          '--light-bg-body': lightBg.colors.body,
          '--light-bg-paper': lightBg.colors.paper,
          '--light-bg-paper-alt': lightBg.colors.paperAlt,
          '--light-bg-default': lightBg.colors.default,
          '--light-bg-hover': lightBg.colors.hover,
          '--light-bg-border': lightBg.colors.border,

          // Override MUI CSS variables for background
          '--mui-palette-background-default': lightBg.colors.body,
          '--mui-palette-background-paper': lightBg.colors.paper
        },

        // Page background - multiple selectors for specificity
        'body': {
          ...baseStyles['body'],
          backgroundColor: `${lightBg.colors.body} !important`
        },
        'html body': {
          backgroundColor: `${lightBg.colors.body} !important`
        },

        // Main content area
        'main': {
          backgroundColor: `${lightBg.colors.body} !important`
        },
        '.MuiContainer-root': {
          backgroundColor: 'transparent !important'
        },

        // Sidebar & Header
        '.MuiDrawer-paper': {
          backgroundColor: `${lightBg.colors.paper} !important`
        },
        '.MuiAppBar-root': {
          backgroundColor: `${lightBg.colors.paper} !important`
        },

        // ALL Paper components - maximum specificity
        '.MuiPaper-root': {
          backgroundColor: `${lightBg.colors.paper} !important`
        },
        'div.MuiPaper-root': {
          backgroundColor: `${lightBg.colors.paper} !important`
        },

        // Cards - multiple selectors for maximum coverage
        '.MuiCard-root': {
          backgroundColor: `${lightBg.colors.paper} !important`,
          borderColor: `${lightBg.colors.border} !important`
        },
        'div.MuiCard-root': {
          backgroundColor: `${lightBg.colors.paper} !important`,
          borderColor: `${lightBg.colors.border} !important`
        },
        '.MuiCard-root.MuiPaper-root': {
          backgroundColor: `${lightBg.colors.paper} !important`,
          borderColor: `${lightBg.colors.border} !important`
        },

        // Card content
        '.MuiCardContent-root': {
          backgroundColor: 'transparent !important'
        },

        // Cards with custom inline background - preserve their colors but add tinted border
        '.MuiCard-root[style*="background"]': {
          borderRadius: 'var(--proxcenter-card-radius, 12px) !important'
        },
        '.MuiCard-root[style*="linear-gradient"]': {
          borderRadius: 'var(--proxcenter-card-radius, 12px) !important'
        },

        // Dialogs
        '.MuiDialog-paper': {
          backgroundColor: `${lightBg.colors.paper} !important`
        },
        '.MuiDialog-paper.MuiPaper-root': {
          backgroundColor: `${lightBg.colors.paper} !important`
        },

        // Menus & Popovers
        '.MuiMenu-paper': {
          backgroundColor: `${lightBg.colors.paper} !important`,
          borderColor: `${lightBg.colors.border} !important`
        },
        '.MuiPopover-paper': {
          backgroundColor: `${lightBg.colors.paper} !important`,
          borderColor: `${lightBg.colors.border} !important`
        },
        '.MuiAutocomplete-paper': {
          backgroundColor: `${lightBg.colors.paper} !important`,
          borderColor: `${lightBg.colors.border} !important`
        },

        // Table
        '.MuiTableContainer-root': {
          backgroundColor: `${lightBg.colors.paper} !important`
        },
        '.MuiTableHead-root': {
          backgroundColor: `${lightBg.colors.default} !important`
        },
        '.MuiTableCell-head': {
          backgroundColor: `${lightBg.colors.default} !important`
        },
        '.MuiTableCell-root': {
          borderColor: `${lightBg.colors.border} !important`
        },

        // Inputs - outlined
        '.MuiOutlinedInput-root': {
          backgroundColor: `${lightBg.colors.paper} !important`
        },
        '.MuiOutlinedInput-notchedOutline': {
          borderColor: `${lightBg.colors.border} !important`
        },

        // Inputs - filled
        '.MuiFilledInput-root': {
          backgroundColor: `${lightBg.colors.default} !important`
        },
        '.MuiFilledInput-root:hover': {
          backgroundColor: `${lightBg.colors.hover} !important`
        },

        // Tabs
        '.MuiTabs-root': {
          backgroundColor: `${lightBg.colors.default} !important`
        },
        '.MuiTab-root': {
          backgroundColor: 'transparent !important'
        },

        // Tab panel
        '.MuiTabPanel-root': {
          backgroundColor: 'transparent !important'
        },

        // Accordion
        '.MuiAccordion-root': {
          backgroundColor: `${lightBg.colors.paper} !important`
        },

        // Alert standard variants
        '.MuiAlert-standard': {
          backgroundColor: `${lightBg.colors.default} !important`
        },
        '.MuiAlert-standardInfo': {
          backgroundColor: `${lightBg.colors.default} !important`
        },

        // Chip
        '.MuiChip-root': {
          borderColor: `${lightBg.colors.border} !important`
        },
        '.MuiChip-outlined': {
          borderColor: `${lightBg.colors.border} !important`
        },

        // Dividers
        '.MuiDivider-root': {
          borderColor: `${lightBg.colors.border} !important`
        },

        // List
        '.MuiList-root': {
          backgroundColor: 'transparent !important'
        },
        '.MuiListItem-root:hover': {
          backgroundColor: `${lightBg.colors.hover} !important`
        },

        // Select
        '.MuiSelect-select': {
          backgroundColor: 'transparent !important'
        },

        // Toggle buttons
        '.MuiToggleButtonGroup-root': {
          backgroundColor: `${lightBg.colors.default} !important`
        },
        '.MuiToggleButton-root': {
          borderColor: `${lightBg.colors.border} !important`
        }
      }
    }
    
    return baseStyles
  }, [globalTheme, currentMode, lightBg, settings.customBorderRadius, settings.blurIntensity, settings.fontSize, settings.uiScale])

  // Merge the primary color scheme override with the core theme
  const theme = useMemo(() => {
    // Build light palette with custom background
    const lightPalette = {
      primary: {
        main: settings.primaryColor,
        light: lighten(settings.primaryColor, 0.2),
        dark: darken(settings.primaryColor, 0.1)
      },
      background: {
        default: lightBg.colors.body,
        paper: lightBg.colors.paper
      },
      divider: lightBg.colors.border
    }

    const newTheme = {
      colorSchemes: {
        light: {
          palette: lightPalette
        },
        dark: {
          palette: {
            primary: {
              main: settings.primaryColor,
              light: lighten(settings.primaryColor, 0.2),
              dark: darken(settings.primaryColor, 0.1)
            }
          }
        }
      },
      cssVariables: {
        colorSchemeSelector: 'data'
      }
    }

    const coreTheme = deepmerge(defaultCoreTheme(settings, currentMode, direction), newTheme)

    return createTheme(coreTheme)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.primaryColor, settings.skin, settings.globalTheme, settings.lightBackground, settings.customBorderRadius, settings.blurIntensity, settings.density, currentMode, lightBg])

  return (
    <AppRouterCacheProvider
      options={{
        prepend: true,
        ...(direction === 'rtl' && {
          key: 'rtl',
          stylisPlugins: [stylisRTLPlugin]
        })
      }}
    >
      <ThemeProvider
        theme={theme}
        defaultMode={systemMode}
        modeStorageKey={`${themeConfig.templateName.toLowerCase().split(' ').join('-')}-mui-template-mode`}
        forceThemeRerender
      >
        <>
          <ModeChanger systemMode={systemMode} />
          <CssBaseline />
          <GlobalStyles styles={globalStyles} />
          {children}
        </>
      </ThemeProvider>
    </AppRouterCacheProvider>
  )
}

export default CustomThemeProvider
