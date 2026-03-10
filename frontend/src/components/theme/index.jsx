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
import { useBranding } from '@/contexts/BrandingContext'

// Core Theme Imports
import defaultCoreTheme from '@core/theme'

// Helper: generates 17-group content area overrides from CSS variable names
// Each theme provides a mapping of semantic names to its own CSS variable names
const createContentOverrides = (vars) => ({
  'main, .ts-vertical-layout-content': {
    backgroundColor: `var(${vars.bg}) !important`
  },
  '.MuiCard-root': {
    backgroundColor: `var(${vars.surface}) !important`,
    borderColor: `var(${vars.border}) !important`
  },
  '.MuiTableHead-root .MuiTableCell-root': {
    backgroundColor: `var(${vars.surfaceAlt || vars.surface}) !important`,
    borderBottom: `1px solid var(${vars.border}) !important`,
    color: `var(${vars.text}) !important`,
    fontWeight: '600 !important'
  },
  '.MuiTableBody-root .MuiTableRow-root': {
    backgroundColor: `var(${vars.surface}) !important`,
    '&:hover': {
      backgroundColor: `var(${vars.hover}) !important`
    }
  },
  '.MuiTableBody-root .MuiTableRow-root:nth-of-type(even)': {
    backgroundColor: `var(${vars.bg}) !important`
  },
  '.MuiTableBody-root .MuiTableCell-root': {
    borderBottom: `1px solid var(${vars.border}) !important`,
    color: `var(${vars.text}) !important`
  },
  '.MuiOutlinedInput-root': {
    backgroundColor: `var(${vars.surface}) !important`,
    '& .MuiOutlinedInput-notchedOutline': {
      borderColor: `var(${vars.border}) !important`
    },
    '&:hover .MuiOutlinedInput-notchedOutline': {
      borderColor: `var(${vars.accent}) !important`
    },
    '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
      borderColor: `var(${vars.accent}) !important`
    }
  },
  '.MuiInputBase-input': {
    color: `var(${vars.text}) !important`
  },
  '.MuiInputLabel-root': {
    color: `var(${vars.textSecondary || vars.text}) !important`
  },
  '.MuiButton-containedPrimary': {
    backgroundColor: `var(${vars.accent}) !important`,
    color: `var(${vars.accentText || vars.bg}) !important`,
    '&:hover': {
      backgroundColor: `var(${vars.accentHover || vars.accent}) !important`
    }
  },
  '.MuiTab-root.Mui-selected': {
    color: `var(${vars.accent}) !important`
  },
  '.MuiTabs-indicator': {
    backgroundColor: `var(${vars.accent}) !important`
  },
  '.MuiDialog-paper, .MuiPopover-paper, .MuiMenu-paper': {
    backgroundColor: `var(${vars.surface}) !important`,
    border: `1px solid var(${vars.border}) !important`
  },
  '.MuiMenuItem-root': {
    color: `var(${vars.text}) !important`,
    '&:hover': {
      backgroundColor: `var(${vars.hover}) !important`
    }
  },
  '.MuiDivider-root': {
    borderColor: `var(${vars.border}) !important`
  },
  '*::-webkit-scrollbar-track': {
    backgroundColor: `var(${vars.bg}) !important`
  },
  '*::-webkit-scrollbar-thumb': {
    backgroundColor: `var(${vars.border}) !important`,
    '&:hover': {
      backgroundColor: `var(${vars.accent}) !important`
    }
  },
  '.MuiLinearProgress-bar': {
    backgroundColor: `var(${vars.accent}) !important`
  },
  '.MuiTreeItem-root, .MuiListItem-root': {
    '&:hover': {
      backgroundColor: `var(${vars.hover}) !important`
    }
  }
})

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
  const themesWithDarkChrome = ['proxmoxClassic', 'terminal', 'cyberpunk', 'nord', 'dracula', 'oneDark']
  const hasDarkChrome = themesWithDarkChrome.includes(globalTheme.id)

  // Font families par thème
  const themeFonts = {
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

      // Content area overrides via CSS vars
      ...createContentOverrides({
        bg: '--nord-bg-primary',
        surface: '--nord-bg-secondary',
        surfaceAlt: '--nord-bg-secondary',
        border: '--nord-border',
        text: '--nord-text',
        textSecondary: '--nord-text-secondary',
        accent: '--nord-accent',
        accentHover: '--nord-accent-secondary',
        accentText: '--nord-bg-primary',
        hover: '--nord-bg-tertiary'
      }),
      '.MuiChip-colorSuccess': { color: 'var(--nord-success) !important', border: '1px solid var(--nord-success) !important' },
      '.MuiChip-colorError': { color: 'var(--nord-error) !important', border: '1px solid var(--nord-error) !important' },
      '.MuiChip-colorWarning': { color: 'var(--nord-warning) !important', border: '1px solid var(--nord-warning) !important' },
      '.MuiChip-colorInfo': { color: 'var(--nord-info) !important', border: '1px solid var(--nord-info) !important' }
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

      // Content area overrides via CSS vars
      ...createContentOverrides({
        bg: '--dracula-bg',
        surface: '--dracula-surface',
        surfaceAlt: '--dracula-surface',
        border: '--dracula-border',
        text: '--dracula-text',
        textSecondary: '--dracula-comment',
        accent: '--dracula-accent',
        accentText: '--dracula-bg',
        hover: '--dracula-hover'
      }),
      '.MuiChip-colorSuccess': { color: 'var(--dracula-green) !important', border: '1px solid var(--dracula-green) !important' },
      '.MuiChip-colorError': { color: 'var(--dracula-red) !important', border: '1px solid var(--dracula-red) !important' },
      '.MuiChip-colorWarning': { color: 'var(--dracula-orange) !important', border: '1px solid var(--dracula-orange) !important' },
      '.MuiChip-colorInfo': { color: 'var(--dracula-cyan) !important', border: '1px solid var(--dracula-cyan) !important' }
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

      // Content area overrides via CSS vars
      ...createContentOverrides({
        bg: '--onedark-bg',
        surface: '--onedark-bg-secondary',
        surfaceAlt: '--onedark-bg-secondary',
        border: '--onedark-border',
        text: '--onedark-text',
        textSecondary: '--onedark-text-secondary',
        accent: '--onedark-accent',
        accentText: '--onedark-bg',
        hover: '--onedark-hover'
      }),
      '.MuiChip-colorSuccess': { color: 'var(--onedark-green) !important', border: '1px solid var(--onedark-green) !important' },
      '.MuiChip-colorError': { color: 'var(--onedark-red) !important', border: '1px solid var(--onedark-red) !important' },
      '.MuiChip-colorWarning': { color: 'var(--onedark-yellow) !important', border: '1px solid var(--onedark-yellow) !important' },
      '.MuiChip-colorInfo': { color: 'var(--onedark-cyan) !important', border: '1px solid var(--onedark-cyan) !important' }
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

    // Neumorphism Theme - soft shadows (sidebar only, dark mode)
    ...(globalTheme.id === 'neumorphism' && !isLightMode && {
      '.ts-vertical-nav-root, .ts-vertical-nav-container, .ts-vertical-nav-bg-color-container': {
        backgroundColor: '#1e1e2d !important',
        boxShadow: 'inset -4px 0 8px rgba(0,0,0,0.3), inset 4px 0 8px rgba(255,255,255,0.02) !important'
      }
    }),

    // ============================================================
    // GLASSMORPHISM CONTENT OVERRIDES - via CSS vars + backdrop-blur
    // ============================================================
    ...(globalTheme.id === 'glassmorphism' && {
      ...createContentOverrides({
        bg: '--glass-body',
        surface: '--glass-card',
        surfaceAlt: '--glass-surface',
        border: '--glass-border',
        text: '--glass-text',
        textSecondary: '--glass-text-secondary',
        accent: '--glass-accent',
        hover: '--glass-hover'
      }),
      // Override selectors that need backdrop-filter
      '.MuiCard-root': {
        backgroundColor: 'var(--glass-card) !important',
        borderColor: 'var(--glass-border) !important',
        backdropFilter: `${effectiveBlur} !important`
      },
      '.MuiTableHead-root .MuiTableCell-root': {
        backgroundColor: 'var(--glass-surface) !important',
        borderBottom: '1px solid var(--glass-border) !important',
        color: 'var(--glass-text) !important',
        fontWeight: '600 !important',
        backdropFilter: 'blur(8px) !important'
      },
      '.MuiOutlinedInput-root': {
        backgroundColor: 'var(--glass-surface) !important',
        backdropFilter: 'blur(8px) !important',
        '& .MuiOutlinedInput-notchedOutline': {
          borderColor: 'var(--glass-border) !important'
        },
        '&:hover .MuiOutlinedInput-notchedOutline': {
          borderColor: 'var(--glass-accent) !important'
        },
        '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
          borderColor: 'var(--glass-accent) !important'
        }
      },
      '.MuiButton-containedPrimary': {
        backgroundColor: 'var(--glass-accent) !important',
        color: '#ffffff !important',
        backdropFilter: 'blur(8px) !important',
        '&:hover': {
          filter: 'brightness(1.1) !important'
        }
      },
      '.MuiChip-root': {
        backdropFilter: 'blur(4px) !important'
      },
      '.MuiDialog-paper, .MuiPopover-paper, .MuiMenu-paper': {
        backgroundColor: 'var(--glass-dialog) !important',
        backdropFilter: `${effectiveBlur} !important`,
        border: '1px solid var(--glass-border) !important'
      }
    }),

    // ============================================================
    // NEUMORPHISM CONTENT OVERRIDES - via CSS vars + neumorphic shadows
    // ============================================================
    ...(globalTheme.id === 'neumorphism' && {
      ...createContentOverrides({
        bg: '--neu-bg',
        surface: '--neu-surface',
        surfaceAlt: '--neu-surface-alt',
        border: '--neu-border',
        text: '--neu-text',
        textSecondary: '--neu-text-secondary',
        accent: '--neu-accent',
        accentHover: '--neu-accent-hover',
        hover: '--neu-hover'
      }),
      // Override with neumorphic shadows
      '.MuiCard-root': {
        backgroundColor: 'var(--neu-surface) !important',
        border: 'none !important',
        boxShadow: 'var(--neu-card-shadow) !important'
      },
      '.MuiOutlinedInput-root': {
        backgroundColor: 'var(--neu-surface) !important',
        boxShadow: 'var(--neu-input-shadow) !important',
        '& .MuiOutlinedInput-notchedOutline': {
          borderColor: 'transparent !important'
        },
        '&:hover .MuiOutlinedInput-notchedOutline': {
          borderColor: 'var(--neu-accent) !important'
        },
        '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
          borderColor: 'var(--neu-accent) !important'
        }
      },
      '.MuiButton-containedPrimary': {
        backgroundColor: 'var(--neu-accent) !important',
        color: '#ffffff !important',
        boxShadow: 'var(--neu-button-shadow) !important',
        '&:hover': {
          backgroundColor: 'var(--neu-accent-hover) !important'
        }
      },
      '.MuiChip-root': {
        boxShadow: 'var(--neu-chip-shadow) !important',
        border: 'none !important'
      },
      '.MuiDialog-paper, .MuiPopover-paper, .MuiMenu-paper': {
        backgroundColor: 'var(--neu-surface) !important',
        boxShadow: 'var(--neu-dialog-shadow) !important',
        border: 'none !important'
      },
      '*::-webkit-scrollbar-thumb': {
        backgroundColor: 'var(--neu-border) !important',
        borderRadius: '10px !important',
        '&:hover': {
          backgroundColor: 'var(--neu-accent) !important'
        }
      }
    }),

    // ============================================================
    // CORPORATE THEME - via CSS vars
    // ============================================================
    ...(globalTheme.id === 'corporate' && {
      ...createContentOverrides({
        bg: '--corp-bg',
        surface: '--corp-surface',
        surfaceAlt: '--corp-surface-alt',
        border: '--corp-border',
        text: '--corp-text',
        textSecondary: '--corp-text-secondary',
        accent: '--corp-accent',
        accentHover: '--corp-accent-hover',
        hover: '--corp-hover'
      }),
      '.MuiChip-colorSuccess': { color: 'var(--corp-success) !important' },
      '.MuiChip-colorError': { color: 'var(--corp-error) !important' },
      '.MuiChip-colorWarning': { color: 'var(--corp-warning) !important' },
      '.MuiChip-colorInfo': { color: 'var(--corp-info) !important' },
      '.MuiButton-containedPrimary': {
        backgroundColor: 'var(--corp-accent) !important',
        color: '#ffffff !important',
        '&:hover': {
          backgroundColor: 'var(--corp-accent-hover) !important'
        }
      }
    }),

    // ============================================================
    // MINIMAL THEME - via CSS vars
    // ============================================================
    ...(globalTheme.id === 'minimal' && {
      ...createContentOverrides({
        bg: '--min-bg',
        surface: '--min-surface',
        surfaceAlt: '--min-surface-alt',
        border: '--min-border',
        text: '--min-text',
        textSecondary: '--min-text-secondary',
        accent: '--min-accent',
        accentHover: '--min-accent-hover',
        hover: '--min-hover'
      }),
      '.MuiCard-root': {
        backgroundColor: 'var(--min-surface) !important',
        borderColor: 'var(--min-border) !important',
        boxShadow: 'none !important'
      },
      '.MuiButton-containedPrimary': {
        backgroundColor: 'var(--min-accent) !important',
        color: '#ffffff !important',
        boxShadow: 'none !important',
        '&:hover': {
          backgroundColor: 'var(--min-accent-hover) !important',
          boxShadow: 'none !important'
        }
      },
      '.MuiDialog-paper, .MuiPopover-paper, .MuiMenu-paper': {
        backgroundColor: 'var(--min-surface) !important',
        border: '1px solid var(--min-border) !important',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15) !important'
      }
    }),

    // ============================================================
    // ROUNDED THEME - via CSS vars
    // ============================================================
    ...(globalTheme.id === 'rounded' && {
      ...createContentOverrides({
        bg: '--round-bg',
        surface: '--round-surface',
        surfaceAlt: '--round-surface-alt',
        border: '--round-border',
        text: '--round-text',
        textSecondary: '--round-text-secondary',
        accent: '--round-accent',
        accentHover: '--round-accent-hover',
        hover: '--round-hover'
      }),
      '.MuiChip-colorSuccess': { color: 'var(--round-success) !important' },
      '.MuiChip-colorError': { color: 'var(--round-error) !important' },
      '.MuiChip-colorWarning': { color: 'var(--round-warning) !important' },
      '.MuiChip-colorInfo': { color: 'var(--round-info) !important' },
      '.MuiButton-containedPrimary': {
        backgroundColor: 'var(--round-accent) !important',
        color: 'var(--round-bg) !important',
        '&:hover': {
          backgroundColor: 'var(--round-accent-hover) !important'
        }
      }
    }),

    // ============================================================
    // HIGH CONTRAST THEME - via CSS vars, WCAG AAA
    // ============================================================
    ...(globalTheme.id === 'highContrast' && {
      ...createContentOverrides({
        bg: '--hc-bg',
        surface: '--hc-surface',
        surfaceAlt: '--hc-surface-alt',
        border: '--hc-border',
        text: '--hc-text',
        accent: '--hc-focus',
        hover: '--hc-hover'
      }),
      // Override with thick borders and no shadows
      '.MuiCard-root': {
        backgroundColor: 'var(--hc-surface) !important',
        border: '2px solid var(--hc-border) !important',
        boxShadow: 'none !important'
      },
      '.MuiTableHead-root .MuiTableCell-root': {
        backgroundColor: 'var(--hc-hover) !important',
        borderBottom: '2px solid var(--hc-border) !important',
        color: 'var(--hc-text) !important',
        fontWeight: '700 !important'
      },
      '.MuiTableBody-root .MuiTableCell-root': {
        borderBottom: '2px solid var(--hc-border) !important',
        color: 'var(--hc-text) !important'
      },
      '.MuiOutlinedInput-root': {
        backgroundColor: 'var(--hc-surface) !important',
        '& .MuiOutlinedInput-notchedOutline': {
          borderColor: 'var(--hc-border) !important',
          borderWidth: '2px !important'
        },
        '&:hover .MuiOutlinedInput-notchedOutline': {
          borderColor: 'var(--hc-focus) !important'
        },
        '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
          borderColor: 'var(--hc-focus) !important',
          borderWidth: '3px !important'
        }
      },
      '.MuiButton-containedPrimary': {
        backgroundColor: 'var(--hc-focus) !important',
        color: 'var(--hc-bg) !important',
        fontWeight: '700 !important',
        boxShadow: 'none !important',
        border: '2px solid var(--hc-border) !important',
        '&:hover': {
          filter: 'brightness(0.85) !important'
        }
      },
      '.MuiButton-root:focus-visible': {
        outline: '3px solid var(--hc-focus) !important',
        outlineOffset: '2px !important'
      },
      '.MuiChip-root': {
        border: '2px solid var(--hc-border) !important',
        fontWeight: '600 !important',
        boxShadow: 'none !important'
      },
      '.MuiChip-colorSuccess': {
        backgroundColor: 'var(--hc-success) !important',
        color: 'var(--hc-bg) !important'
      },
      '.MuiChip-colorError': {
        backgroundColor: 'var(--hc-error) !important',
        color: '#ffffff !important'
      },
      '.MuiChip-colorWarning': {
        backgroundColor: 'var(--hc-warning) !important',
        color: 'var(--hc-bg) !important'
      },
      '.MuiTabs-indicator': {
        backgroundColor: 'var(--hc-focus) !important',
        height: '3px !important'
      },
      '.MuiTab-root.Mui-selected': {
        color: 'var(--hc-focus) !important',
        fontWeight: '700 !important'
      },
      '.MuiDialog-paper, .MuiPopover-paper, .MuiMenu-paper': {
        backgroundColor: 'var(--hc-surface) !important',
        border: '2px solid var(--hc-border) !important',
        boxShadow: 'none !important'
      },
      '.MuiDivider-root': {
        borderColor: 'var(--hc-border) !important',
        borderWidth: '1px !important'
      },
      'a, .MuiLink-root': {
        color: 'var(--hc-link) !important',
        textDecoration: 'underline !important'
      },
      '*::-webkit-scrollbar-thumb': {
        backgroundColor: 'var(--hc-text) !important',
        border: '2px solid var(--hc-border) !important',
        '&:hover': {
          backgroundColor: 'var(--hc-focus) !important'
        }
      },
      '*:focus-visible': {
        outline: '3px solid var(--hc-focus) !important',
        outlineOffset: '2px !important'
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
  const { branding } = useBranding()
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
    // Branding primary color takes precedence over user setting
    const effectivePrimaryColor = branding.primaryColor || settings.primaryColor

    // Build light palette with custom background
    const lightPalette = {
      primary: {
        main: effectivePrimaryColor,
        light: lighten(effectivePrimaryColor, 0.2),
        dark: darken(effectivePrimaryColor, 0.1)
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
              main: effectivePrimaryColor,
              light: lighten(effectivePrimaryColor, 0.2),
              dark: darken(effectivePrimaryColor, 0.1)
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
  }, [settings.primaryColor, branding.primaryColor, settings.skin, settings.globalTheme, settings.lightBackground, settings.customBorderRadius, settings.blurIntensity, settings.density, currentMode, lightBg])

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
