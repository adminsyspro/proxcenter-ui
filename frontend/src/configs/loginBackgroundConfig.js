/**
 * ProxCenter Login Background Configuration
 * 
 * Presets for login page backgrounds including gradients,
 * animated effects, and theme-matched options.
 */

// Gradient presets
export const gradientPresets = [
  {
    id: 'default',
    name: 'Default',
    descriptionKey: 'themes.loginBackground.default',
    gradient: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
    category: 'brand'
  },
  {
    id: 'proxcenter-warm',
    name: 'ProxCenter Warm',
    descriptionKey: 'themes.loginBackground.proxcenterWarm',
    gradient: 'linear-gradient(135deg, #1a1a2e 0%, #2d1810 50%, #0f0a06 100%)',
    category: 'brand'
  },
  {
    id: 'datacenter',
    name: 'Datacenter',
    descriptionKey: 'themes.loginBackground.datacenter',
    gradient: 'linear-gradient(180deg, #0a0f1a 0%, #1a2744 50%, #0d1929 100%)',
    category: 'tech'
  },
  {
    id: 'midnight',
    name: 'Midnight',
    descriptionKey: 'themes.loginBackground.midnight',
    gradient: 'radial-gradient(ellipse at top, #1b2838 0%, #0d1117 50%, #010409 100%)',
    category: 'dark'
  },
  {
    id: 'aurora',
    name: 'Aurora',
    descriptionKey: 'themes.loginBackground.aurora',
    gradient: 'linear-gradient(135deg, #0f2027 0%, #203a43 25%, #2c5364 50%, #203a43 75%, #0f2027 100%)',
    category: 'nature'
  },
  {
    id: 'cyberpunk',
    name: 'Cyberpunk',
    descriptionKey: 'themes.loginBackground.cyberpunk',
    gradient: 'linear-gradient(135deg, #0a0a0f 0%, #1a0a2e 25%, #0a1a2e 50%, #2e0a1a 75%, #0a0a0f 100%)',
    category: 'design'
  },
  {
    id: 'terminal',
    name: 'Terminal',
    descriptionKey: 'themes.loginBackground.terminal',
    gradient: 'linear-gradient(180deg, #0a0a0a 0%, #0d1a0d 50%, #0a0f0a 100%)',
    category: 'tech'
  },
  {
    id: 'nord',
    name: 'Nord',
    descriptionKey: 'themes.loginBackground.nord',
    gradient: 'linear-gradient(135deg, #2e3440 0%, #3b4252 50%, #2e3440 100%)',
    category: 'design'
  },
  {
    id: 'dracula',
    name: 'Dracula',
    descriptionKey: 'themes.loginBackground.dracula',
    gradient: 'linear-gradient(135deg, #1e1f29 0%, #282a36 50%, #1e1f29 100%)',
    category: 'design'
  },
  {
    id: 'ocean',
    name: 'Ocean',
    descriptionKey: 'themes.loginBackground.ocean',
    gradient: 'linear-gradient(180deg, #000428 0%, #004e92 100%)',
    category: 'nature'
  },
  {
    id: 'sunset',
    name: 'Sunset',
    descriptionKey: 'themes.loginBackground.sunset',
    gradient: 'linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)',
    category: 'nature'
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    descriptionKey: 'themes.loginBackground.enterprise',
    gradient: 'linear-gradient(180deg, #1e2d3d 0%, #10171e 100%)',
    category: 'brand'
  },
  {
    id: 'matrix',
    name: 'Matrix',
    descriptionKey: 'themes.loginBackground.matrix',
    gradient: 'linear-gradient(180deg, #000000 0%, #001100 50%, #000000 100%)',
    category: 'tech'
  },
  {
    id: 'minimal-dark',
    name: 'Minimal Dark',
    descriptionKey: 'themes.loginBackground.minimalDark',
    gradient: 'linear-gradient(135deg, #0d0d0d 0%, #1a1a1a 50%, #0d0d0d 100%)',
    category: 'dark'
  },
  {
    id: 'minimal-light',
    name: 'Minimal Light',
    descriptionKey: 'themes.loginBackground.minimalLight',
    gradient: 'linear-gradient(135deg, #f5f5f5 0%, #e8e8e8 50%, #f5f5f5 100%)',
    category: 'light'
  }
]

// Animated gradient presets (CSS animations)
export const animatedPresets = [
  {
    id: 'mesh-gradient',
    name: 'Mesh Gradient',
    descriptionKey: 'themes.loginBackground.meshGradient',
    keyframes: `
      @keyframes meshGradient {
        0%, 100% { background-position: 0% 50%; }
        50% { background-position: 100% 50%; }
      }
    `,
    style: {
      background: 'linear-gradient(-45deg, #0f2027, #203a43, #2c5364, #0f3460, #1a1a2e)',
      backgroundSize: '400% 400%',
      animation: 'meshGradient 15s ease infinite'
    }
  },
  {
    id: 'aurora-animated',
    name: 'Aurora Animated',
    descriptionKey: 'themes.loginBackground.auroraAnimated',
    keyframes: `
      @keyframes aurora {
        0%, 100% { background-position: 0% 50%; filter: hue-rotate(0deg); }
        50% { background-position: 100% 50%; filter: hue-rotate(30deg); }
      }
    `,
    style: {
      background: 'linear-gradient(-45deg, #0f2027, #203a43, #2c5364, #134e5e, #71b280)',
      backgroundSize: '400% 400%',
      animation: 'aurora 20s ease infinite'
    }
  },
  {
    id: 'cyberpunk-pulse',
    name: 'Cyberpunk Pulse',
    descriptionKey: 'themes.loginBackground.cyberpunkPulse',
    keyframes: `
      @keyframes cyberPulse {
        0%, 100% { background-position: 0% 50%; }
        50% { background-position: 100% 50%; }
      }
    `,
    style: {
      background: 'linear-gradient(-45deg, #0a0a0f, #1a0a2e, #ff00ff20, #00ffff20, #0a0a0f)',
      backgroundSize: '400% 400%',
      animation: 'cyberPulse 10s ease infinite'
    }
  }
]

// Built-in image presets (paths to public assets)
export const imagePresets = [
  {
    id: 'datacenter-1',
    name: 'Datacenter Servers',
    thumbnail: '/images/login-bg/datacenter-thumb.jpg',
    fullImage: '/images/login-bg/datacenter.jpg',
    category: 'infrastructure'
  },
  {
    id: 'network-1',
    name: 'Network Cables',
    thumbnail: '/images/login-bg/network-thumb.jpg',
    fullImage: '/images/login-bg/network.jpg',
    category: 'infrastructure'
  },
  {
    id: 'abstract-1',
    name: 'Abstract Tech',
    thumbnail: '/images/login-bg/abstract-thumb.jpg',
    fullImage: '/images/login-bg/abstract.jpg',
    category: 'abstract'
  }
]

// Categories for filtering
export const backgroundCategories = [
  { id: 'all', nameKey: 'themes.bgCategories.all', icon: 'ri-apps-line' },
  { id: 'brand', nameKey: 'themes.bgCategories.brand', icon: 'ri-building-line' },
  { id: 'tech', nameKey: 'themes.bgCategories.tech', icon: 'ri-server-line' },
  { id: 'design', nameKey: 'themes.bgCategories.design', icon: 'ri-palette-line' },
  { id: 'nature', nameKey: 'themes.bgCategories.nature', icon: 'ri-leaf-line' },
  { id: 'dark', nameKey: 'themes.bgCategories.dark', icon: 'ri-moon-line' },
  { id: 'light', nameKey: 'themes.bgCategories.light', icon: 'ri-sun-line' }
]

// Background types
export const backgroundTypes = [
  {
    id: 'gradient',
    nameKey: 'themes.bgTypes.gradient',
    descriptionKey: 'themes.bgTypes.gradientDesc',
    icon: 'ri-contrast-drop-line'
  },
  {
    id: 'animated',
    nameKey: 'themes.bgTypes.animated',
    descriptionKey: 'themes.bgTypes.animatedDesc',
    icon: 'ri-movie-line'
  },
  {
    id: 'image',
    nameKey: 'themes.bgTypes.image',
    descriptionKey: 'themes.bgTypes.imageDesc',
    icon: 'ri-image-line'
  },
  {
    id: 'particles',
    nameKey: 'themes.bgTypes.particles',
    descriptionKey: 'themes.bgTypes.particlesDesc',
    icon: 'ri-share-line'
  }
]

// Helper to get gradient by ID
export const getGradientPreset = (id) => {
  return gradientPresets.find(g => g.id === id) || gradientPresets[0]
}

// Helper to get animated preset by ID
export const getAnimatedPreset = (id) => {
  return animatedPresets.find(a => a.id === id) || animatedPresets[0]
}

// Map global theme to matching login background
export const themeToBackgroundMap = {
  default: 'default',
  glassmorphism: 'aurora',
  neumorphism: 'minimal-dark',
  cyberpunk: 'cyberpunk',
  minimal: 'minimal-dark',
  corporate: 'enterprise',
  vcenter: 'enterprise',
  terminal: 'terminal',
  nord: 'nord',
  dracula: 'dracula',
  oneDark: 'midnight'
}

export default {
  gradientPresets,
  animatedPresets,
  imagePresets,
  backgroundCategories,
  backgroundTypes,
  getGradientPreset,
  getAnimatedPreset,
  themeToBackgroundMap
}
