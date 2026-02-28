// src/lib/db/sqlite.ts
import path from "path"
import fs from "fs"

import Database from "better-sqlite3"

let db: Database.Database | null = null

export function getDb() {
  if (db) return db

  const dir = path.join(process.cwd(), "data")

  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  const file = path.join(dir, "proxcenter.db")

  db = new Database(file)

  // NOTE: La table des connexions (Connection) est gérée par Prisma
  // Ne pas créer pve_connections ici pour éviter les doublons

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password TEXT,
      name TEXT,
      avatar TEXT,
      role TEXT NOT NULL DEFAULT 'viewer',
      auth_provider TEXT NOT NULL DEFAULT 'credentials',
      ldap_dn TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_login_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);
  `)

  // Migration pour ajouter la colonne avatar si elle n'existe pas
  try {
    const userColumns = db.pragma('table_info(users)') as any[]
    const hasAvatarColumn = userColumns.some((col: any) => col.name === 'avatar')

    if (!hasAvatarColumn) {
      db.exec(`ALTER TABLE users ADD COLUMN avatar TEXT`)
    }
  } catch (e) {
    // Ignore si erreur
  }

  // Migration pour ajouter la colonne oidc_sub si elle n'existe pas
  try {
    const userColumns2 = db.pragma('table_info(users)') as any[]
    const hasOidcSub = userColumns2.some((col: any) => col.name === 'oidc_sub')

    if (!hasOidcSub) {
      db.exec(`ALTER TABLE users ADD COLUMN oidc_sub TEXT`)
    }
  } catch (e) {
    // Ignore si erreur
  }

  db.exec(`
    -- Table des sessions
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

    -- Table des logs d'audit
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      user_id TEXT,
      user_email TEXT,
      action TEXT NOT NULL,
      category TEXT NOT NULL,
      resource_type TEXT,
      resource_id TEXT,
      resource_name TEXT,
      details TEXT,
      ip_address TEXT,
      user_agent TEXT,
      status TEXT NOT NULL DEFAULT 'success',
      error_message TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_category ON audit_logs(category);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id);

    -- Table de configuration LDAP
    CREATE TABLE IF NOT EXISTS ldap_config (
      id TEXT PRIMARY KEY DEFAULT 'default',
      enabled INTEGER NOT NULL DEFAULT 0,
      url TEXT NOT NULL,
      bind_dn TEXT,
      bind_password_enc TEXT,
      base_dn TEXT NOT NULL,
      user_filter TEXT NOT NULL DEFAULT '(uid={{username}})',
      email_attribute TEXT NOT NULL DEFAULT 'mail',
      name_attribute TEXT NOT NULL DEFAULT 'cn',
      tls_insecure INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Table de configuration OIDC / SSO
    CREATE TABLE IF NOT EXISTS oidc_config (
      id TEXT PRIMARY KEY DEFAULT 'default',
      enabled INTEGER NOT NULL DEFAULT 0,
      provider_name TEXT NOT NULL DEFAULT 'SSO',
      issuer_url TEXT NOT NULL DEFAULT '',
      client_id TEXT NOT NULL DEFAULT '',
      client_secret_enc TEXT,
      scopes TEXT NOT NULL DEFAULT 'openid profile email',
      authorization_url TEXT,
      token_url TEXT,
      userinfo_url TEXT,
      claim_email TEXT NOT NULL DEFAULT 'email',
      claim_name TEXT NOT NULL DEFAULT 'name',
      claim_groups TEXT DEFAULT 'groups',
      auto_provision INTEGER NOT NULL DEFAULT 1,
      default_role TEXT NOT NULL DEFAULT 'viewer',
      group_role_mapping TEXT DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Table des règles d'alertes
    CREATE TABLE IF NOT EXISTS alert_rules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      metric TEXT NOT NULL,
      operator TEXT NOT NULL,
      threshold REAL NOT NULL,
      duration INTEGER NOT NULL DEFAULT 0,
      severity TEXT NOT NULL DEFAULT 'warning',
      scope_type TEXT NOT NULL DEFAULT 'all',
      scope_target TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_alert_rules_enabled ON alert_rules(enabled);
    CREATE INDEX IF NOT EXISTS idx_alert_rules_metric ON alert_rules(metric);

    -- Table des alertes déclenchées par les règles (distinct de la table Prisma "alerts")
    CREATE TABLE IF NOT EXISTS alert_instances (
      id TEXT PRIMARY KEY,
      rule_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      entity_name TEXT,
      node TEXT,
      connection_id TEXT,
      connection_name TEXT,
      metric TEXT NOT NULL,
      current_value REAL,
      threshold REAL NOT NULL,
      severity TEXT NOT NULL,
      message TEXT NOT NULL,
      triggered_at TEXT NOT NULL,
      resolved_at TEXT,
      acknowledged_at TEXT,
      acknowledged_by TEXT,
      FOREIGN KEY (rule_id) REFERENCES alert_rules(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_alert_instances_status ON alert_instances(status);
    CREATE INDEX IF NOT EXISTS idx_alert_instances_rule_id ON alert_instances(rule_id);
    CREATE INDEX IF NOT EXISTS idx_alert_instances_triggered_at ON alert_instances(triggered_at);
    CREATE INDEX IF NOT EXISTS idx_alert_instances_entity ON alert_instances(entity_type, entity_id);
  `)

  // Migration pour créer la table favorites si elle n'existe pas
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS favorites (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        vm_key TEXT NOT NULL,
        connection_id TEXT NOT NULL,
        node TEXT NOT NULL,
        vm_type TEXT NOT NULL,
        vmid TEXT NOT NULL,
        vm_name TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(user_id, vm_key)
      );
    `)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_favorites_user_id ON favorites(user_id);`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_favorites_vm_key ON favorites(vm_key);`)
  } catch (e) {
    // Migration error is non-critical, table may already exist
  }

  // Health score history (Resource Planner F8)
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS health_score_history (
        id TEXT PRIMARY KEY,
        date TEXT NOT NULL UNIQUE,
        score INTEGER NOT NULL,
        cpu_pct REAL,
        ram_pct REAL,
        storage_pct REAL,
        details TEXT,
        connection_id TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_health_score_date ON health_score_history(date);
    `)
  } catch (e) {
    // Migration error is non-critical
  }

  // ========================================
  // Table security_policies (singleton, like ldap_config)
  // ========================================
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS security_policies (
        id TEXT PRIMARY KEY DEFAULT 'default',
        password_min_length INTEGER NOT NULL DEFAULT 8,
        password_require_uppercase INTEGER NOT NULL DEFAULT 0,
        password_require_lowercase INTEGER NOT NULL DEFAULT 0,
        password_require_numbers INTEGER NOT NULL DEFAULT 0,
        password_require_special INTEGER NOT NULL DEFAULT 0,
        session_timeout_minutes INTEGER NOT NULL DEFAULT 43200,
        session_max_concurrent INTEGER NOT NULL DEFAULT 0,
        login_max_failed_attempts INTEGER NOT NULL DEFAULT 0,
        login_lockout_duration_minutes INTEGER NOT NULL DEFAULT 15,
        audit_retention_days INTEGER NOT NULL DEFAULT 90,
        audit_auto_cleanup INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        updated_by TEXT
      );
      INSERT OR IGNORE INTO security_policies (id, updated_at) VALUES ('default', datetime('now'));
    `)
  } catch (e) {
    // Migration error is non-critical
  }

  // ========================================
  // Tables compliance profiles
  // ========================================
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS compliance_profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        framework_id TEXT,
        is_active INTEGER NOT NULL DEFAULT 0,
        connection_id TEXT,
        created_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_compliance_profiles_active ON compliance_profiles(is_active);
      CREATE INDEX IF NOT EXISTS idx_compliance_profiles_connection ON compliance_profiles(connection_id);

      CREATE TABLE IF NOT EXISTS compliance_profile_checks (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        check_id TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        weight REAL NOT NULL DEFAULT 1.0,
        control_ref TEXT,
        category TEXT,
        FOREIGN KEY (profile_id) REFERENCES compliance_profiles(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_compliance_profile_checks_profile ON compliance_profile_checks(profile_id);
    `)
  } catch (e) {
    // Migration error is non-critical
  }

  // ========================================
  // Tables RBAC
  // ========================================
  
  db.exec(`
    -- Table des rôles personnalisés
    CREATE TABLE IF NOT EXISTS rbac_roles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      is_system INTEGER NOT NULL DEFAULT 0,
      color TEXT DEFAULT '#6366f1',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rbac_roles_name ON rbac_roles(name);
    CREATE INDEX IF NOT EXISTS idx_rbac_roles_system ON rbac_roles(is_system);

    -- Table des permissions disponibles
    CREATE TABLE IF NOT EXISTS rbac_permissions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL,
      description TEXT,
      is_dangerous INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_rbac_permissions_category ON rbac_permissions(category);

    -- Table de liaison rôles <-> permissions
    CREATE TABLE IF NOT EXISTS rbac_role_permissions (
      role_id TEXT NOT NULL,
      permission_id TEXT NOT NULL,
      PRIMARY KEY (role_id, permission_id),
      FOREIGN KEY (role_id) REFERENCES rbac_roles(id) ON DELETE CASCADE,
      FOREIGN KEY (permission_id) REFERENCES rbac_permissions(id) ON DELETE CASCADE
    );

    -- Table des assignations de rôles aux utilisateurs avec scope
    -- scope_type: 'global', 'connection', 'node', 'vm'
    -- scope_target: null (global), connection_id, node, ou vmid (format: connection_id:node:vmtype:vmid)
    CREATE TABLE IF NOT EXISTS rbac_user_roles (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      scope_type TEXT NOT NULL DEFAULT 'global',
      scope_target TEXT,
      granted_by TEXT,
      granted_at TEXT NOT NULL,
      expires_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (role_id) REFERENCES rbac_roles(id) ON DELETE CASCADE,
      FOREIGN KEY (granted_by) REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rbac_user_roles_user ON rbac_user_roles(user_id);
    CREATE INDEX IF NOT EXISTS idx_rbac_user_roles_role ON rbac_user_roles(role_id);
    CREATE INDEX IF NOT EXISTS idx_rbac_user_roles_scope ON rbac_user_roles(scope_type, scope_target);

    -- Table des permissions directes (sans passer par un rôle)
    CREATE TABLE IF NOT EXISTS rbac_user_permissions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      permission_id TEXT NOT NULL,
      scope_type TEXT NOT NULL DEFAULT 'global',
      scope_target TEXT,
      granted_by TEXT,
      granted_at TEXT NOT NULL,
      expires_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (permission_id) REFERENCES rbac_permissions(id) ON DELETE CASCADE,
      FOREIGN KEY (granted_by) REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rbac_user_perms_user ON rbac_user_permissions(user_id);
    CREATE INDEX IF NOT EXISTS idx_rbac_user_perms_scope ON rbac_user_permissions(scope_type, scope_target);
  `)

  // Liste complète des permissions - utilise INSERT OR IGNORE pour ajouter les nouvelles sans dupliquer
  const allPermissions = [
    // VM/CT Operations
    { id: 'vm.view', name: 'vm.view', category: 'vm', description: 'View VMs and their details' },
    { id: 'vm.console', name: 'vm.console', category: 'vm', description: 'Access VNC/SPICE console' },
    { id: 'vm.start', name: 'vm.start', category: 'vm', description: 'Start a VM' },
    { id: 'vm.stop', name: 'vm.stop', category: 'vm', description: 'Stop a VM' },
    { id: 'vm.restart', name: 'vm.restart', category: 'vm', description: 'Restart a VM' },
    { id: 'vm.suspend', name: 'vm.suspend', category: 'vm', description: 'Suspend/Resume a VM' },
    { id: 'vm.snapshot', name: 'vm.snapshot', category: 'vm', description: 'Create/Delete snapshots' },
    { id: 'vm.backup', name: 'vm.backup', category: 'vm', description: 'Backup/Restore a VM' },
    { id: 'vm.clone', name: 'vm.clone', category: 'vm', description: 'Clone a VM' },
    { id: 'vm.migrate', name: 'vm.migrate', category: 'vm', description: 'Migrate a VM', is_dangerous: 1 },
    { id: 'vm.config', name: 'vm.config', category: 'vm', description: 'Modify VM configuration', is_dangerous: 1 },
    { id: 'vm.delete', name: 'vm.delete', category: 'vm', description: 'Delete a VM', is_dangerous: 1 },
    { id: 'vm.create', name: 'vm.create', category: 'vm', description: 'Create a new VM', is_dangerous: 1 },

    // Storage Operations
    { id: 'storage.view', name: 'storage.view', category: 'storage', description: 'View storages' },
    { id: 'storage.content', name: 'storage.content', category: 'storage', description: 'Browse storage content' },
    { id: 'storage.upload', name: 'storage.upload', category: 'storage', description: 'Upload ISO files/templates' },
    { id: 'storage.delete', name: 'storage.delete', category: 'storage', description: 'Delete files', is_dangerous: 1 },

    // Node Operations
    { id: 'node.view', name: 'node.view', category: 'node', description: 'View cluster nodes' },
    { id: 'node.console', name: 'node.console', category: 'node', description: 'Access node console' },
    { id: 'node.services', name: 'node.services', category: 'node', description: 'Manage services', is_dangerous: 1 },
    { id: 'node.network', name: 'node.network', category: 'node', description: 'Configure network', is_dangerous: 1 },

    // Cluster/Connection Operations
    { id: 'connection.view', name: 'connection.view', category: 'connection', description: 'View PVE/PBS connections' },
    { id: 'connection.manage', name: 'connection.manage', category: 'connection', description: 'Manage connections', is_dangerous: 1 },

    // Backup Operations
    { id: 'backup.view', name: 'backup.view', category: 'backup', description: 'View backups' },
    { id: 'backup.restore', name: 'backup.restore', category: 'backup', description: 'Restore a backup', is_dangerous: 1 },
    { id: 'backup.delete', name: 'backup.delete', category: 'backup', description: 'Delete a backup', is_dangerous: 1 },

    // Backup Job Operations (scheduled backups)
    { id: 'backup.job.view', name: 'backup.job.view', category: 'backup', description: 'View scheduled backup jobs' },
    { id: 'backup.job.create', name: 'backup.job.create', category: 'backup', description: 'Create a backup job', is_dangerous: 1 },
    { id: 'backup.job.edit', name: 'backup.job.edit', category: 'backup', description: 'Edit a backup job', is_dangerous: 1 },
    { id: 'backup.job.delete', name: 'backup.job.delete', category: 'backup', description: 'Delete a backup job', is_dangerous: 1 },
    { id: 'backup.job.run', name: 'backup.job.run', category: 'backup', description: 'Manually run a backup job' },

    // Node Management
    { id: 'node.manage', name: 'node.manage', category: 'node', description: 'Manage nodes (updates, restart)', is_dangerous: 1 },

    // Automation (DRS, Rolling Updates, etc.)
    { id: 'automation.view', name: 'automation.view', category: 'automation', description: 'View automation and DRS settings' },
    { id: 'automation.manage', name: 'automation.manage', category: 'automation', description: 'Configure automation and DRS', is_dangerous: 1 },
    { id: 'automation.execute', name: 'automation.execute', category: 'automation', description: 'Execute automation actions', is_dangerous: 1 },

    // Operations
    { id: 'events.view', name: 'events.view', category: 'operations', description: 'View events and logs' },
    { id: 'alerts.view', name: 'alerts.view', category: 'operations', description: 'View alerts' },
    { id: 'alerts.manage', name: 'alerts.manage', category: 'operations', description: 'Manage alerts (acknowledge, resolve)', is_dangerous: 1 },
    { id: 'tasks.view', name: 'tasks.view', category: 'operations', description: 'View task center' },
    { id: 'reports.view', name: 'reports.view', category: 'operations', description: 'View reports' },

    // Storage Admin
    { id: 'storage.admin', name: 'storage.admin', category: 'storage', description: 'Access Storage Overview and Ceph pages', is_dangerous: 1 },

    // Admin Operations
    { id: 'admin.users', name: 'admin.users', category: 'admin', description: 'Manage users', is_dangerous: 1 },
    { id: 'admin.rbac', name: 'admin.rbac', category: 'admin', description: 'Manage roles and permissions', is_dangerous: 1 },
    { id: 'admin.settings', name: 'admin.settings', category: 'admin', description: 'Modify settings', is_dangerous: 1 },
    { id: 'admin.audit', name: 'admin.audit', category: 'admin', description: 'View audit logs' },
    { id: 'admin.compliance', name: 'admin.compliance', category: 'admin', description: 'Manage compliance and security policies', is_dangerous: 1 },
  ]

  // Utiliser INSERT OR IGNORE pour ajouter les permissions manquantes sans erreur
  const now = new Date().toISOString()
  const insertPerm = db.prepare(
    'INSERT OR IGNORE INTO rbac_permissions (id, name, category, description, is_dangerous, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  )

  for (const p of allPermissions) {
    insertPerm.run(p.id, p.name, p.category, p.description, p.is_dangerous || 0, now)
  }

  // Insérer les rôles système par défaut si la table est vide
  const roleCount = db.prepare('SELECT COUNT(*) as count FROM rbac_roles').get() as any

  if (roleCount.count === 0) {
    const now = new Date().toISOString()

    const roles = [
      {
        id: 'role_super_admin',
        name: 'Super Admin',
        description: 'Full access to all features',
        is_system: 1,
        color: '#ef4444',
        permissions: ['*'] // Wildcard = all permissions
      },
      {
        id: 'role_operator',
        name: 'Operator',
        description: 'Day-to-day VM management without admin access',
        is_system: 1,
        color: '#f59e0b',
        permissions: [
          'vm.view', 'vm.console', 'vm.start', 'vm.stop', 'vm.restart', 'vm.suspend',
          'vm.snapshot', 'vm.backup',
          'node.view', 'connection.view', 'backup.view',
          'events.view', 'tasks.view'
        ]
      },
      {
        id: 'role_vm_admin',
        name: 'VM Admin',
        description: 'Full VM administration',
        is_system: 1,
        color: '#8b5cf6',
        permissions: [
          'vm.view', 'vm.console', 'vm.start', 'vm.stop', 'vm.restart', 'vm.suspend',
          'vm.snapshot', 'vm.backup', 'vm.clone', 'vm.migrate', 'vm.config', 'vm.delete', 'vm.create',
          'storage.view', 'storage.content', 'storage.upload',
          'node.view', 'connection.view', 'backup.view', 'backup.restore',
          'events.view', 'tasks.view', 'storage.admin'
        ]
      },
      {
        id: 'role_viewer',
        name: 'Viewer',
        description: 'Read-only access to all resources',
        is_system: 1,
        color: '#3b82f6',
        permissions: [
          'vm.view', 'node.view', 'connection.view', 'backup.view',
          'events.view'
        ]
      },
      { 
        id: 'role_vm_user',
        name: 'VM User',
        description: 'Basic usage of assigned VMs (console, start/stop)',
        is_system: 1,
        color: '#10b981',
        permissions: [
          'vm.view', 'vm.console', 'vm.start', 'vm.stop', 'vm.restart'
        ]
      },
    ]

    const insertRole = db.prepare(
      'INSERT INTO rbac_roles (id, name, description, is_system, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )

    const insertRolePerm = db.prepare(
      'INSERT INTO rbac_role_permissions (role_id, permission_id) VALUES (?, ?)'
    )

    const allPermissions = db.prepare('SELECT id FROM rbac_permissions').all() as any[]

    for (const r of roles) {
      insertRole.run(r.id, r.name, r.description, r.is_system, r.color, now, now)
      
      if (r.permissions.includes('*')) {
        // Super Admin: toutes les permissions
        for (const p of allPermissions) {
          insertRolePerm.run(r.id, p.id)
        }
      } else {
        for (const permId of r.permissions) {
          try {
            insertRolePerm.run(r.id, permId)
          } catch (e) {
            // Permission n'existe pas, ignorer
          }
        }
      }
    }
  } else {
    // Roles already exist — ensure Super Admin has all permissions (covers newly added ones)
    const superAdminRole = db.prepare("SELECT id FROM rbac_roles WHERE id = 'role_super_admin'").get() as any
    if (superAdminRole) {
      const allPerms = db.prepare('SELECT id FROM rbac_permissions').all() as any[]
      const insertRolePerm = db.prepare(
        'INSERT OR IGNORE INTO rbac_role_permissions (role_id, permission_id) VALUES (?, ?)'
      )
      for (const p of allPerms) {
        insertRolePerm.run('role_super_admin', p.id)
      }
    }
  }

  // ========================================
  // Auto-migration: assign role_super_admin to legacy admins
  // ========================================
  try {
    const legacyAdmins = db.prepare(
      "SELECT id FROM users WHERE role IN ('admin', 'super_admin')"
    ).all() as any[]

    const checkExisting = db.prepare(
      "SELECT 1 FROM rbac_user_roles WHERE user_id = ? AND role_id = 'role_super_admin'"
    )
    const insertUserRole = db.prepare(
      "INSERT INTO rbac_user_roles (id, user_id, role_id, scope_type, scope_target, granted_at) VALUES (?, ?, 'role_super_admin', 'global', NULL, ?)"
    )

    const migrationNow = new Date().toISOString()

    for (const admin of legacyAdmins) {
      const existing = checkExisting.get(admin.id)

      if (!existing) {
        insertUserRole.run(crypto.randomUUID(), admin.id, migrationNow)
      }
    }
  } catch (e) {
    // Migration error is non-critical for existing installs without RBAC tables yet
  }

  return db
}