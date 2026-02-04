/**
 * ProxCenter Global Themes Configuration
 * 
 * Each theme defines a complete visual style including:
 * - Card styles (shadows, borders, backdrop effects)
 * - Border radius
 * - Button styles
 * - Typography adjustments
 * - Spacing/density
 * - Special effects (glassmorphism, neumorphism, etc.)
 */

const globalThemesConfig = [
  {
    id: 'default',
    name: 'Default',
    descriptionKey: 'themes.global.default',
    icon: 'ri-layout-4-line',
    category: 'standard',
    preview: {
      cardBg: 'linear-gradient(135deg, #1e1e2d 0%, #252536 100%)',
      accent: '#E57000'
    },
    styles: {
      card: {
        borderRadius: 8,
        boxShadow: '0 2px 12px 0 rgba(0,0,0,0.2)',
        backdropFilter: 'none',
        background: 'var(--mui-palette-background-paper)',
        border: 'none'
      },
      button: {
        borderRadius: 6,
        textTransform: 'none',
        fontWeight: 500
      },
      input: {
        borderRadius: 6
      },
      density: 'comfortable',
      transitions: 'normal'
    }
  },
  {
    id: 'glassmorphism',
    name: 'Glassmorphism',
    descriptionKey: 'themes.global.glassmorphism',
    icon: 'ri-blur-off-line',
    category: 'design',
    preview: {
      cardBg: 'linear-gradient(135deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.05) 100%)',
      accent: '#06B6D4'
    },
    styles: {
      card: {
        borderRadius: 16,
        boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.37)',
        backdropFilter: 'blur(12px) saturate(180%)',
        background: 'rgba(30, 30, 45, 0.75)',
        border: '1px solid rgba(255, 255, 255, 0.08)'
      },
      button: {
        borderRadius: 12,
        textTransform: 'none',
        fontWeight: 500,
        backdropFilter: 'blur(8px)'
      },
      input: {
        borderRadius: 12,
        backdropFilter: 'blur(4px)'
      },
      density: 'comfortable',
      transitions: 'normal'
    },
    adjustable: {
      blurIntensity: {
        labelKey: 'themes.global.blurIntensity',
        min: 0,
        max: 24,
        default: 12,
        unit: 'px'
      }
    },
    cssOverrides: {
      dark: {
        '--glass-bg': 'rgba(30, 30, 45, 0.75)',
        '--glass-border': 'rgba(255, 255, 255, 0.08)',
        '--glass-shadow': '0 8px 32px 0 rgba(0, 0, 0, 0.37)'
      },
      light: {
        '--glass-bg': 'rgba(255, 255, 255, 0.7)',
        '--glass-border': 'rgba(0, 0, 0, 0.08)',
        '--glass-shadow': '0 8px 32px 0 rgba(0, 0, 0, 0.1)'
      }
    }
  },
  {
    id: 'neumorphism',
    name: 'Neumorphism',
    descriptionKey: 'themes.global.neumorphism',
    icon: 'ri-shape-2-line',
    category: 'design',
    preview: {
      cardBg: '#1e1e2d',
      accent: '#8B5CF6'
    },
    styles: {
      card: {
        borderRadius: 20,
        boxShadow: '8px 8px 16px rgba(0,0,0,0.4), -8px -8px 16px rgba(255,255,255,0.03)',
        backdropFilter: 'none',
        background: 'var(--mui-palette-background-paper)',
        border: 'none'
      },
      button: {
        borderRadius: 12,
        textTransform: 'none',
        fontWeight: 600,
        boxShadow: '4px 4px 8px rgba(0,0,0,0.3), -4px -4px 8px rgba(255,255,255,0.02)'
      },
      input: {
        borderRadius: 12,
        boxShadow: 'inset 4px 4px 8px rgba(0,0,0,0.2), inset -4px -4px 8px rgba(255,255,255,0.02)'
      },
      density: 'spacious',
      transitions: 'subtle'
    },
    cssOverrides: {
      dark: {
        '--neu-shadow-dark': 'rgba(0,0,0,0.4)',
        '--neu-shadow-light': 'rgba(255,255,255,0.03)',
        '--neu-inset-dark': 'rgba(0,0,0,0.2)',
        '--neu-inset-light': 'rgba(255,255,255,0.02)'
      },
      light: {
        '--neu-shadow-dark': 'rgba(0,0,0,0.15)',
        '--neu-shadow-light': 'rgba(255,255,255,0.8)',
        '--neu-inset-dark': 'rgba(0,0,0,0.1)',
        '--neu-inset-light': 'rgba(255,255,255,0.7)'
      }
    }
  },
  {
    id: 'cyberpunk',
    name: 'Cyberpunk',
    descriptionKey: 'themes.global.cyberpunk',
    icon: 'ri-flashlight-line',
    category: 'design',
    preview: {
      cardBg: 'linear-gradient(135deg, #0a0a0f 0%, #1a1a2e 100%)',
      accent: '#ff00ff'
    },
    styles: {
      card: {
        borderRadius: 4,
        boxShadow: '0 0 20px rgba(255, 0, 255, 0.15), 0 0 40px rgba(0, 255, 255, 0.05)',
        backdropFilter: 'none',
        background: 'linear-gradient(180deg, rgba(20, 20, 35, 0.95) 0%, rgba(10, 10, 20, 0.98) 100%)',
        border: '1px solid rgba(255, 0, 255, 0.2)'
      },
      button: {
        borderRadius: 2,
        textTransform: 'uppercase',
        fontWeight: 700,
        letterSpacing: '0.1em',
        boxShadow: '0 0 10px currentColor'
      },
      input: {
        borderRadius: 2,
        border: '1px solid rgba(255, 0, 255, 0.3)'
      },
      density: 'compact',
      transitions: 'playful'
    },
    cssOverrides: {
      dark: {
        '--cyber-glow-primary': 'rgba(255, 0, 255, 0.4)',
        '--cyber-glow-secondary': 'rgba(0, 255, 255, 0.4)',
        '--cyber-border': 'rgba(255, 0, 255, 0.3)',
        '--cyber-bg': 'rgba(10, 10, 20, 0.95)'
      },
      light: {
        '--cyber-glow-primary': 'rgba(255, 0, 255, 0.2)',
        '--cyber-glow-secondary': 'rgba(0, 255, 255, 0.2)',
        '--cyber-border': 'rgba(255, 0, 255, 0.2)',
        '--cyber-bg': 'rgba(240, 240, 255, 0.95)'
      }
    }
  },
  {
    id: 'minimal',
    name: 'Minimal',
    descriptionKey: 'themes.global.minimal',
    icon: 'ri-subtract-line',
    category: 'standard',
    preview: {
      cardBg: '#1e1e2d',
      accent: '#64748B'
    },
    styles: {
      card: {
        borderRadius: 4,
        boxShadow: 'none',
        backdropFilter: 'none',
        background: 'var(--mui-palette-background-paper)',
        border: '1px solid var(--mui-palette-divider)'
      },
      button: {
        borderRadius: 4,
        textTransform: 'none',
        fontWeight: 500,
        boxShadow: 'none'
      },
      input: {
        borderRadius: 4
      },
      density: 'compact',
      transitions: 'subtle'
    }
  },
  {
    id: 'corporate',
    name: 'Corporate',
    descriptionKey: 'themes.global.corporate',
    icon: 'ri-building-line',
    category: 'standard',
    preview: {
      cardBg: 'linear-gradient(180deg, #2d3748 0%, #1a202c 100%)',
      accent: '#3182CE'
    },
    styles: {
      card: {
        borderRadius: 6,
        boxShadow: '0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.24)',
        backdropFilter: 'none',
        background: 'var(--mui-palette-background-paper)',
        border: 'none'
      },
      button: {
        borderRadius: 4,
        textTransform: 'none',
        fontWeight: 600
      },
      input: {
        borderRadius: 4
      },
      density: 'comfortable',
      transitions: 'subtle'
    }
  },

  // vCenter - VMware vSphere Client style
  {
    id: 'vcenter',
    name: 'vCenter',
    descriptionKey: 'themes.global.vcenter',
    icon: 'ri-cloud-line',
    category: 'standard',
    tagKeys: ['themes.tags.vmware', 'themes.tags.enterprise'],
    preview: {
      cardBg: 'linear-gradient(180deg, #1e2d3d 0%, #10171e 100%)',
      accent: '#0079b8'
    },
    styles: {
      card: {
        borderRadius: 3,
        boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
        backdropFilter: 'none',
        background: 'var(--mui-palette-background-paper)',
        border: '1px solid var(--mui-palette-divider)'
      },
      button: {
        borderRadius: 3,
        textTransform: 'none',
        fontWeight: 500,
        letterSpacing: '0.01em'
      },
      input: {
        borderRadius: 3
      },
      density: 'compact',
      transitions: 'subtle'
    },

    // VMware font - Clarity City / Metropolis style
    fontOverride: {
      body: '"Clarity City", "Segoe UI", -apple-system, BlinkMacSystemFont, "Roboto", sans-serif',
      heading: '"Clarity City", "Segoe UI", -apple-system, BlinkMacSystemFont, "Roboto", sans-serif'
    },
    palette: {
      // VMware brand colors (exact)
      primary: '#0079b8',
      primaryDark: '#005d91',
      primaryLight: '#49afd9',

      // Navigation
      navBg: '#1b2a32',
      navBgDark: '#10171e',
      navText: '#ffffff',
      navHover: '#324a5e',

      // Status colors (VMware style)
      success: '#62a420',
      warning: '#efc006',
      error: '#c92100',
      info: '#0079b8'
    },
    cssOverrides: {
      dark: {
        // Header - VMware dark blue-gray
        '--vcenter-header-bg': '#1b2a32',
        '--vcenter-nav-bg': '#17242b',
        '--vcenter-nav-hover': '#324a5e',
        '--vcenter-nav-active': '#0079b8',
        '--vcenter-nav-border': '#324a5e',

        // Content
        '--vcenter-content-bg': '#17242b',
        '--vcenter-card-bg': '#1b2a32',
        '--vcenter-card-border': '#324a5e',

        // Accent
        '--vcenter-accent': '#0079b8',
        '--vcenter-accent-hover': '#49afd9',

        // Text
        '--vcenter-text-primary': '#fafafa',
        '--vcenter-text-secondary': '#9a9a9a'
      },
      light: {
        // Header stays dark like vCenter  
        '--vcenter-header-bg': '#1b2a32',
        '--vcenter-nav-bg': '#17242b',
        '--vcenter-nav-hover': '#324a5e',
        '--vcenter-nav-active': '#0079b8',

        // Content
        '--vcenter-content-bg': '#fafafa',
        '--vcenter-card-bg': '#ffffff',
        '--vcenter-card-border': '#d7d7d7',

        // Accent
        '--vcenter-accent': '#0079b8',

        // Text
        '--vcenter-text-primary': '#313131',
        '--vcenter-text-secondary': '#737373'
      }
    }
  },
  {
    id: 'terminal',
    name: 'Terminal',
    descriptionKey: 'themes.global.terminal',
    icon: 'ri-terminal-box-line',
    category: 'ide',
    preview: {
      cardBg: '#0d1117',
      accent: '#00ff00'
    },
    styles: {
      card: {
        borderRadius: 0,
        boxShadow: 'none',
        backdropFilter: 'none',
        background: 'rgba(13, 17, 23, 0.95)',
        border: '1px solid #30363d'
      },
      button: {
        borderRadius: 0,
        textTransform: 'uppercase',
        fontWeight: 500,
        fontFamily: 'monospace',
        letterSpacing: '0.05em'
      },
      input: {
        borderRadius: 0,
        fontFamily: 'monospace'
      },
      density: 'compact',
      transitions: 'none'
    },
    fontOverride: {
      body: '"JetBrains Mono", "Fira Code", "Consolas", monospace',
      heading: '"JetBrains Mono", "Fira Code", "Consolas", monospace'
    },
    cssOverrides: {
      dark: {
        '--terminal-bg': '#0d1117',
        '--terminal-border': '#30363d',
        '--terminal-text': '#c9d1d9',
        '--terminal-green': '#00ff00'
      },
      light: {
        '--terminal-bg': '#f6f8fa',
        '--terminal-border': '#d0d7de',
        '--terminal-text': '#24292f',
        '--terminal-green': '#008000'
      }
    }
  },
  {
    id: 'rounded',
    name: 'Rounded',
    descriptionKey: 'themes.global.rounded',
    icon: 'ri-checkbox-blank-circle-line',
    category: 'design',
    preview: {
      cardBg: 'linear-gradient(135deg, #1e1e2d 0%, #2a2a3d 100%)',
      accent: '#F59E0B'
    },
    styles: {
      card: {
        borderRadius: 24,
        boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
        backdropFilter: 'none',
        background: 'var(--mui-palette-background-paper)',
        border: 'none'
      },
      button: {
        borderRadius: 50,
        textTransform: 'none',
        fontWeight: 600
      },
      input: {
        borderRadius: 16
      },
      density: 'spacious',
      transitions: 'playful'
    }
  },

  // ============================================
  // NEW THEMES
  // ============================================

  // Proxmox Classic - Native Proxmox VE UI
  {
    id: 'proxmoxClassic',
    name: 'Proxmox Classic',
    descriptionKey: 'themes.global.proxmoxClassic',
    icon: 'ri-server-line',
    category: 'standard',
    tagKeys: ['themes.tags.official', 'themes.tags.familiar'],
    preview: {
      cardBg: 'linear-gradient(135deg, #354759 0%, #2c3e50 100%)',
      accent: '#e57000'
    },
    styles: {
      card: {
        borderRadius: 3,
        boxShadow: 'none',
        backdropFilter: 'none',
        background: 'var(--mui-palette-background-paper)',
        border: '1px solid var(--mui-palette-divider)'
      },
      button: {
        borderRadius: 3,
        textTransform: 'none',
        fontWeight: 500,
        boxShadow: 'none'
      },
      input: {
        borderRadius: 3
      },
      density: 'compact',
      transitions: 'subtle'
    },
    cssOverrides: {
      dark: {
        '--proxmox-header-bg': '#1a252f',
        '--proxmox-sidebar-bg': '#2c3e50',
        '--proxmox-card-bg': '#354759',
        '--proxmox-border': '#4a6785',
        '--proxmox-accent': '#e57000',
        '--proxmox-tab-active': '#e57000'
      },
      light: {
        '--proxmox-header-bg': '#4a6785',
        '--proxmox-sidebar-bg': '#f5f5f5',
        '--proxmox-card-bg': '#ffffff',
        '--proxmox-border': '#d0d0d0',
        '--proxmox-accent': '#e57000',
        '--proxmox-tab-active': '#e57000'
      }
    }
  },

  // High Contrast - WCAG AAA Accessibility
  {
    id: 'highContrast',
    name: 'High Contrast',
    descriptionKey: 'themes.global.highContrast',
    icon: 'ri-contrast-2-fill',
    category: 'accessibility',
    tagKeys: ['themes.tags.accessibility', 'themes.tags.wcagAAA'],
    preview: {
      cardBg: '#000000',
      accent: '#ffff00'
    },
    styles: {
      card: {
        borderRadius: 0,
        boxShadow: 'none',
        backdropFilter: 'none',
        background: 'var(--mui-palette-background-paper)',
        border: '2px solid currentColor'
      },
      button: {
        borderRadius: 0,
        textTransform: 'uppercase',
        fontWeight: 700,
        boxShadow: 'none',
        letterSpacing: '0.05em'
      },
      input: {
        borderRadius: 0,
        borderWidth: 2
      },
      density: 'comfortable',
      transitions: 'none'
    },
    cssOverrides: {
      dark: {
        '--hc-bg': '#000000',
        '--hc-surface': '#000000',
        '--hc-text': '#ffffff',
        '--hc-border': '#ffffff',
        '--hc-focus': '#ffff00',
        '--hc-link': '#00ffff',
        '--hc-success': '#00ff00',
        '--hc-error': '#ff0000',
        '--hc-warning': '#ffff00'
      },
      light: {
        '--hc-bg': '#ffffff',
        '--hc-surface': '#ffffff',
        '--hc-text': '#000000',
        '--hc-border': '#000000',
        '--hc-focus': '#0000ff',
        '--hc-link': '#0000ff',
        '--hc-success': '#006400',
        '--hc-error': '#8b0000',
        '--hc-warning': '#8b8b00'
      }
    },
    a11yEnhancements: {
      focusRingWidth: 3,
      focusRingOffset: 2,
      minContrastRatio: 7,
      largerText: true
    }
  },

  // Nord - Popular arctic palette
  {
    id: 'nord',
    name: 'Nord',
    descriptionKey: 'themes.global.nord',
    icon: 'ri-snowflake-line',
    category: 'ide',
    tagKeys: ['themes.tags.ide', 'themes.tags.popular'],
    preview: {
      cardBg: 'linear-gradient(135deg, #2e3440 0%, #3b4252 100%)',
      accent: '#88c0d0'
    },
    styles: {
      card: {
        borderRadius: 8,
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        backdropFilter: 'none',
        background: 'var(--mui-palette-background-paper)',
        border: '1px solid var(--mui-palette-divider)'
      },
      button: {
        borderRadius: 6,
        textTransform: 'none',
        fontWeight: 500
      },
      input: {
        borderRadius: 6
      },
      density: 'comfortable',
      transitions: 'normal'
    },
    palette: {
      polar: { nord0: '#2e3440', nord1: '#3b4252', nord2: '#434c5e', nord3: '#4c566a' },
      snow: { nord4: '#d8dee9', nord5: '#e5e9f0', nord6: '#eceff4' },
      frost: { nord7: '#8fbcbb', nord8: '#88c0d0', nord9: '#81a1c1', nord10: '#5e81ac' },
      aurora: { 
        red: '#bf616a', orange: '#d08770', yellow: '#ebcb8b', 
        green: '#a3be8c', purple: '#b48ead' 
      }
    },
    cssOverrides: {
      dark: {
        '--nord-bg-primary': '#2e3440',
        '--nord-bg-secondary': '#3b4252',
        '--nord-bg-tertiary': '#434c5e',
        '--nord-border': '#4c566a',
        '--nord-text': '#eceff4',
        '--nord-text-secondary': '#d8dee9',
        '--nord-accent': '#88c0d0',
        '--nord-accent-secondary': '#81a1c1',
        '--nord-success': '#a3be8c',
        '--nord-error': '#bf616a',
        '--nord-warning': '#ebcb8b',
        '--nord-info': '#5e81ac'
      },
      light: {
        '--nord-bg-primary': '#eceff4',
        '--nord-bg-secondary': '#e5e9f0',
        '--nord-bg-tertiary': '#d8dee9',
        '--nord-border': '#c9d1d9',
        '--nord-text': '#2e3440',
        '--nord-text-secondary': '#4c566a',
        '--nord-accent': '#5e81ac',
        '--nord-accent-secondary': '#81a1c1',
        '--nord-success': '#a3be8c',
        '--nord-error': '#bf616a',
        '--nord-warning': '#d08770',
        '--nord-info': '#88c0d0'
      }
    }
  },

  // Dracula - Popular dark theme
  {
    id: 'dracula',
    name: 'Dracula',
    descriptionKey: 'themes.global.dracula',
    icon: 'ri-ghost-line',
    category: 'ide',
    tagKeys: ['themes.tags.ide', 'themes.tags.popular'],
    preview: {
      cardBg: 'linear-gradient(135deg, #282a36 0%, #1e1f29 100%)',
      accent: '#bd93f9'
    },
    styles: {
      card: {
        borderRadius: 10,
        boxShadow: '0 4px 20px rgba(189, 147, 249, 0.1)',
        backdropFilter: 'none',
        background: 'var(--mui-palette-background-paper)',
        border: '1px solid var(--mui-palette-divider)'
      },
      button: {
        borderRadius: 8,
        textTransform: 'none',
        fontWeight: 500
      },
      input: {
        borderRadius: 8
      },
      density: 'comfortable',
      transitions: 'normal'
    },
    palette: {
      background: '#282a36',
      currentLine: '#44475a',
      foreground: '#f8f8f2',
      comment: '#6272a4',
      cyan: '#8be9fd',
      green: '#50fa7b',
      orange: '#ffb86c',
      pink: '#ff79c6',
      purple: '#bd93f9',
      red: '#ff5555',
      yellow: '#f1fa8c'
    },
    cssOverrides: {
      dark: {
        '--dracula-bg': '#282a36',
        '--dracula-bg-secondary': '#44475a',
        '--dracula-border': '#6272a4',
        '--dracula-text': '#f8f8f2',
        '--dracula-comment': '#6272a4',
        '--dracula-accent': '#bd93f9',
        '--dracula-accent-secondary': '#ff79c6',
        '--dracula-cyan': '#8be9fd',
        '--dracula-green': '#50fa7b',
        '--dracula-orange': '#ffb86c',
        '--dracula-red': '#ff5555',
        '--dracula-yellow': '#f1fa8c',
        '--dracula-glow': '0 0 20px rgba(189, 147, 249, 0.3)'
      },
      light: {
        '--dracula-bg': '#f8f8f2',
        '--dracula-bg-secondary': '#e8e8e2',
        '--dracula-border': '#d0d0d0',
        '--dracula-text': '#282a36',
        '--dracula-comment': '#6272a4',
        '--dracula-accent': '#9d79d2',
        '--dracula-accent-secondary': '#d659a4',
        '--dracula-cyan': '#56b5c2',
        '--dracula-green': '#3dba68',
        '--dracula-orange': '#d19a66',
        '--dracula-red': '#e05252',
        '--dracula-yellow': '#c9c57b',
        '--dracula-glow': '0 0 20px rgba(157, 121, 210, 0.2)'
      }
    }
  },

  // One Dark - Classic Atom/VS Code theme
  {
    id: 'oneDark',
    name: 'One Dark',
    descriptionKey: 'themes.global.oneDark',
    icon: 'ri-code-s-slash-line',
    category: 'ide',
    tagKeys: ['themes.tags.ide', 'themes.tags.popular'],
    preview: {
      cardBg: 'linear-gradient(135deg, #282c34 0%, #21252b 100%)',
      accent: '#61afef'
    },
    styles: {
      card: {
        borderRadius: 6,
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        backdropFilter: 'none',
        background: 'var(--mui-palette-background-paper)',
        border: '1px solid var(--mui-palette-divider)'
      },
      button: {
        borderRadius: 4,
        textTransform: 'none',
        fontWeight: 500
      },
      input: {
        borderRadius: 4
      },
      density: 'comfortable',
      transitions: 'normal'
    },
    palette: {
      background: '#282c34',
      backgroundLight: '#2c313a',
      foreground: '#abb2bf',
      comment: '#5c6370',
      red: '#e06c75',
      orange: '#d19a66',
      yellow: '#e5c07b',
      green: '#98c379',
      cyan: '#56b6c2',
      blue: '#61afef',
      purple: '#c678dd'
    },
    cssOverrides: {
      dark: {
        '--onedark-bg': '#282c34',
        '--onedark-bg-secondary': '#2c313a',
        '--onedark-bg-highlight': '#3e4451',
        '--onedark-border': '#3e4451',
        '--onedark-text': '#abb2bf',
        '--onedark-text-secondary': '#5c6370',
        '--onedark-accent': '#61afef',
        '--onedark-red': '#e06c75',
        '--onedark-orange': '#d19a66',
        '--onedark-yellow': '#e5c07b',
        '--onedark-green': '#98c379',
        '--onedark-cyan': '#56b6c2',
        '--onedark-purple': '#c678dd'
      },
      light: {
        '--onedark-bg': '#fafafa',
        '--onedark-bg-secondary': '#f0f0f0',
        '--onedark-bg-highlight': '#e5e5e5',
        '--onedark-border': '#d0d0d0',
        '--onedark-text': '#383a42',
        '--onedark-text-secondary': '#696c77',
        '--onedark-accent': '#4078f2',
        '--onedark-red': '#e45649',
        '--onedark-orange': '#c18401',
        '--onedark-yellow': '#986801',
        '--onedark-green': '#50a14f',
        '--onedark-cyan': '#0184bc',
        '--onedark-purple': '#a626a4'
      }
    }
  }
]

export default globalThemesConfig

// Helper to get theme by ID
export const getGlobalTheme = (themeId) => {
  return globalThemesConfig.find(t => t.id === themeId) || globalThemesConfig[0]
}

// Get themes by category
export const getThemesByCategory = (category) => {
  if (!category || category === 'all') return globalThemesConfig
  
return globalThemesConfig.filter(t => t.category === category)
}

// Theme categories
export const themeCategories = [
  { id: 'all', nameKey: 'themes.categories.all', icon: 'ri-apps-line' },
  { id: 'standard', nameKey: 'themes.categories.standard', icon: 'ri-layout-line' },
  { id: 'design', nameKey: 'themes.categories.design', icon: 'ri-palette-line' },
  { id: 'ide', nameKey: 'themes.categories.ide', icon: 'ri-code-line' },
  { id: 'accessibility', nameKey: 'themes.categories.accessibility', icon: 'ri-eye-line' }
]

// Density spacing multipliers
export const densityConfig = {
  compact: { multiplier: 0.8, labelKey: 'themes.density.compact', descriptionKey: 'themes.density.compactDesc' },
  comfortable: { multiplier: 1, labelKey: 'themes.density.comfortable', descriptionKey: 'themes.density.comfortableDesc' },
  spacious: { multiplier: 1.2, labelKey: 'themes.density.spacious', descriptionKey: 'themes.density.spaciousDesc' }
}

// Transition configurations
export const transitionConfig = {
  none: {
    duration: '0ms',
    easing: 'linear',
    labelKey: 'themes.transitions.none',
    descriptionKey: 'themes.transitions.noneDesc'
  },
  subtle: {
    duration: '150ms',
    easing: 'ease-out',
    labelKey: 'themes.transitions.subtle',
    descriptionKey: 'themes.transitions.subtleDesc'
  },
  normal: {
    duration: '250ms',
    easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
    labelKey: 'themes.transitions.normal',
    descriptionKey: 'themes.transitions.normalDesc'
  },
  playful: {
    duration: '350ms',
    easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
    labelKey: 'themes.transitions.playful',
    descriptionKey: 'themes.transitions.playfulDesc'
  }
}

// Border radius presets
export const borderRadiusPresets = [
  { value: 0, labelKey: 'themes.borderRadius.none', icon: 'ri-square-line' },
  { value: 4, labelKey: 'themes.borderRadius.subtle', icon: 'ri-checkbox-blank-line' },
  { value: 8, labelKey: 'themes.borderRadius.moderate', icon: 'ri-checkbox-blank-line' },
  { value: 12, labelKey: 'themes.borderRadius.rounded', icon: 'ri-checkbox-blank-line' },
  { value: 16, labelKey: 'themes.borderRadius.veryRounded', icon: 'ri-checkbox-blank-line' },
  { value: 24, labelKey: 'themes.borderRadius.pill', icon: 'ri-checkbox-blank-circle-line' }
]