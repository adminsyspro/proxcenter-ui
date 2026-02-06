// Menu data with translation support
// Pass the t function from useTranslations() to get translated labels
// requiredFeature: feature ID from license that is required to access this menu item
export const menuData = (t = (key) => key) => [
  {
    label: t('navigation.dashboard'),
    icon: 'ri-dashboard-line',
    href: '/home',

    // Accessible à tous les utilisateurs authentifiés
  },

  {
    isSection: true,
    label: t('navigation.infrastructure'),
    children: [
      {
        label: t('navigation.inventory'),
        icon: 'ri-database-fill',
        href: '/infrastructure/inventory',
        permissions: ['vm.view', 'node.view'] // Au moins une de ces permissions
      },
      {
        label: t('navigation.storage'),
        icon: 'ri-database-2-fill',
        href: '/storage/overview',
        permissions: ['storage.view']
      },
      {
        label: t('navigation.ceph'),
        icon: 'ri-stack-line',
        href: '/storage/ceph',
        permissions: ['storage.view']
      },
      {
        label: t('navigation.backups'),
        icon: 'ri-file-copy-fill',
        href: '/operations/backups',
        permissions: ['backup.view', 'backup.job.view']
      },
      {
        label: t('navigation.resources'),
        icon: 'ri-pie-chart-fill',
        href: '/infrastructure/resources',
        permissions: ['vm.view', 'node.view'],
        requiredFeature: 'green_metrics' // Requires Enterprise license
      }
    ]
  },

  {
    isSection: true,
    label: t('navigation.orchestration'),
    permissions: ['vm.migrate', 'vm.config'], // Section nécessite au moins une de ces permissions
    requiredFeature: 'drs', // Whole section requires DRS feature
    children: [
      {
        label: t('navigation.drs'),
        icon: 'ri-loop-left-fill',
        href: '/automation/drs',
        permissions: ['vm.migrate'],
        requiredFeature: 'drs'
      },
      {
        label: t('navigation.replication'),
        icon: 'ri-arrow-right-double-fill',
        href: '/automation/replication',
        permissions: ['vm.config'],
        requiredFeature: 'ceph_replication'
      },
      {
        label: t('navigation.networkSecurity'),
        icon: 'ri-shield-flash-fill',
        href: '/automation/network',
        permissions: ['admin.settings'],
        requiredFeature: 'microsegmentation'
      },
    ]
  },

  {
    isSection: true,
    label: t('navigation.operations'),
    children: [
      {
        label: t('navigation.events'),
        icon: 'ri-calendar-event-line',
        href: '/operations/events',

        // Accessible à tous - lecture d'événements
      },
      {
        label: t('navigation.alerts'),
        icon: 'ri-notification-3-line',
        href: '/operations/alerts',

        // Accessible à tous - lecture d'alertes
      },
      {
        label: t('navigation.jobs'),
        icon: 'ri-play-list-2-line',
        href: '/operations/jobs',
        requiredFeature: 'jobs' // Requires Enterprise license
      },
      {
        label: t('navigation.reports'),
        icon: 'ri-file-chart-line',
        href: '/operations/reports',
        requiredFeature: 'reports'
      }
    ]
  },

  {
    isSection: true,
    label: t('navigation.securityAccess'),
    permissions: ['admin.users', 'admin.rbac', 'admin.audit'], // Section admin
    children: [
      {
        label: t('navigation.users'),
        icon: 'ri-user-line',
        href: '/security/users',
        permissions: ['admin.users']
      },
      {
        label: t('navigation.rbacRoles'),
        icon: 'ri-lock-2-line',
        href: '/security/rbac',
        permissions: ['admin.rbac'],
        requiredFeature: 'rbac' // Requires Enterprise license
      },
      {
        label: t('navigation.auditLogs'),
        icon: 'ri-file-search-line',
        href: '/security/audit',
        permissions: ['admin.audit']
      }
    ]
  },

  {
    isSection: true,
    label: t('navigation.settings'),
    permissions: ['admin.settings', 'connection.manage'],
    children: [
      {
        label: t('navigation.settings'),
        icon: 'ri-settings-3-line',
        href: '/settings',
        permissions: ['connection.manage', 'admin.settings']
      },
      {
        label: t('navigation.license'),
        icon: 'ri-bill-line',
        href: '/settings/billing',
        permissions: ['admin.settings']
      }
    ]
  }
]
