/**
 * Light Mode Background Tints Configuration
 * 
 * Defines different background color schemes for light mode
 * to reduce eye strain and allow personalization.
 * 
 * Each tint defines:
 * - body: Main page background
 * - paper: Cards, dialogs, menus (slightly lighter than body)
 * - default: Default surfaces
 * - hover: Hover states
 */

const lightBackgroundConfig = [
  {
    id: 'neutral',
    nameKey: 'themes.lightBackground.neutral',
    descriptionKey: 'themes.lightBackground.neutralDesc',
    icon: 'ri-contrast-line',
    colors: {
      body: '#F4F5F7',
      paper: '#FFFFFF',
      paperAlt: '#FAFBFC',      // Cards on paper background
      default: '#F8F9FA',
      hover: '#EBEDF0',
      border: '#E2E5E9'
    },
    preview: {
      bg: '#F4F5F7',
      card: '#FFFFFF'
    }
  },
  {
    id: 'pure',
    nameKey: 'themes.lightBackground.pure',
    descriptionKey: 'themes.lightBackground.pureDesc',
    icon: 'ri-sun-line',
    colors: {
      body: '#FFFFFF',
      paper: '#FFFFFF',
      paperAlt: '#FAFAFA',
      default: '#F5F5F5',
      hover: '#EEEEEE',
      border: '#E0E0E0'
    },
    preview: {
      bg: '#FFFFFF',
      card: '#FFFFFF'
    }
  },
  {
    id: 'warm',
    nameKey: 'themes.lightBackground.warm',
    descriptionKey: 'themes.lightBackground.warmDesc',
    icon: 'ri-temp-hot-line',
    colors: {
      body: '#F8F6F2',
      paper: '#FEFDFB',
      paperAlt: '#FAF9F6',
      default: '#F5F3EF',
      hover: '#EFECE6',
      border: '#E5E1D8'
    },
    preview: {
      bg: '#F8F6F2',
      card: '#FEFDFB'
    }
  },
  {
    id: 'cool',
    nameKey: 'themes.lightBackground.cool',
    descriptionKey: 'themes.lightBackground.coolDesc',
    icon: 'ri-temp-cold-line',
    colors: {
      body: '#F4F7FA',
      paper: '#FBFCFE',
      paperAlt: '#F7F9FC',
      default: '#EFF3F8',
      hover: '#E6ECF3',
      border: '#D8E1EB'
    },
    preview: {
      bg: '#F4F7FA',
      card: '#FBFCFE'
    }
  },
  {
    id: 'sepia',
    nameKey: 'themes.lightBackground.sepia',
    descriptionKey: 'themes.lightBackground.sepiaDesc',
    icon: 'ri-eye-line',
    colors: {
      body: '#F7F4ED',
      paper: '#FDFBF7',
      paperAlt: '#FAF8F3',
      default: '#F3F0E8',
      hover: '#EBE7DC',
      border: '#E0DACE'
    },
    preview: {
      bg: '#F7F4ED',
      card: '#FDFBF7'
    }
  },
  {
    id: 'paper',
    nameKey: 'themes.lightBackground.paper',
    descriptionKey: 'themes.lightBackground.paperDesc',
    icon: 'ri-file-text-line',
    colors: {
      body: '#F5F5F0',
      paper: '#FBFBF7',
      paperAlt: '#F8F8F4',
      default: '#F0F0EB',
      hover: '#E8E8E1',
      border: '#DDDDD4'
    },
    preview: {
      bg: '#F5F5F0',
      card: '#FBFBF7'
    }
  },
  {
    id: 'mint',
    nameKey: 'themes.lightBackground.mint',
    descriptionKey: 'themes.lightBackground.mintDesc',
    icon: 'ri-leaf-line',
    colors: {
      body: '#F3F8F5',
      paper: '#FAFDFB',
      paperAlt: '#F6FAF8',
      default: '#EEF5F1',
      hover: '#E4EFE8',
      border: '#D5E5DB'
    },
    preview: {
      bg: '#F3F8F5',
      card: '#FAFDFB'
    }
  },
  {
    id: 'lavender',
    nameKey: 'themes.lightBackground.lavender',
    descriptionKey: 'themes.lightBackground.lavenderDesc',
    icon: 'ri-palette-line',
    colors: {
      body: '#F6F5FA',
      paper: '#FCFBFE',
      paperAlt: '#F9F8FC',
      default: '#F1F0F7',
      hover: '#E9E7F2',
      border: '#DBD8E8'
    },
    preview: {
      bg: '#F6F5FA',
      card: '#FCFBFE'
    }
  }
]

export default lightBackgroundConfig

// Helper to get background config by ID
export const getLightBackground = (id) => {
  return lightBackgroundConfig.find(bg => bg.id === id) || lightBackgroundConfig[0]
}
