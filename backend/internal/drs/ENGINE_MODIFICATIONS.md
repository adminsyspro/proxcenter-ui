# Modifications à appliquer à internal/drs/engine.go

## 1. Ajouter le champ notificationService dans la structure Engine

Dans la structure `Engine` (vers ligne 17), ajouter :

```go
type Engine struct {
    pveManager *proxmox.Manager
    db         *storage.Database
    config     config.DRSConfig

    // Notifications
    notificationService NotificationService  // <-- AJOUTER CETTE LIGNE

    // State
    recommendations   []Recommendation
    activeMigrations  map[string]*Migration
    // ... reste du code
}
```

## 2. Modifier ExecuteMigration pour notifier le début

Dans `ExecuteMigration` (vers ligne 1284), après le log "Migration started", ajouter :

```go
    log.Info().
        Int("vmid", rec.VMID).
        Str("type", rec.GuestType).
        Str("source", rec.SourceNode).
        Str("target", rec.TargetNode).
        Str("task_id", taskID).
        Msg("Migration started")

    // AJOUTER: Notification de début de migration
    e.notifyMigrationStarted(migration, rec.Reason)

    // Monitor migration in background
    go e.monitorMigration(migration, client)
```

## 3. Modifier monitorMigration pour notifier la fin/échec

Dans `monitorMigration`, modifier les 3 endroits où le statut change :

### 3.1 Migration réussie (vers ligne 1318-1319)
```go
    if status == "OK" {
        now := time.Now()
        migration.CompletedAt = &now
        migration.Status = "completed"

        e.mu.Lock()
        delete(e.activeMigrations, migration.ID)
        e.mu.Unlock()

        e.db.UpdateMigrationStatus(migration.ID, "completed", "")
        log.Info().Str("migration", migration.ID).Msg("Migration completed successfully")
        
        // AJOUTER: Notification de succès
        e.notifyMigrationCompleted(migration)
        
        return
    }
```

### 3.2 Migration échouée (vers ligne 1333-1334)
```go
    if status != "running" {
        now := time.Now()
        migration.CompletedAt = &now
        migration.Status = "failed"
        migration.Error = status

        e.mu.Lock()
        delete(e.activeMigrations, migration.ID)
        e.mu.Unlock()

        e.db.UpdateMigrationStatus(migration.ID, "failed", status)
        log.Error().Str("migration", migration.ID).Str("error", status).Msg("Migration failed")
        
        // AJOUTER: Notification d'échec
        e.notifyMigrationFailed(migration, status)
        
        return
    }
```

### 3.3 Migration timeout (vers ligne 1346-1347)
```go
    case <-timeout:
        migration.Status = "failed"
        migration.Error = "timeout"

        e.mu.Lock()
        delete(e.activeMigrations, migration.ID)
        e.mu.Unlock()

        e.db.UpdateMigrationStatus(migration.ID, "failed", "timeout")
        log.Error().Str("migration", migration.ID).Msg("Migration timed out")
        
        // AJOUTER: Notification d'échec timeout
        e.notifyMigrationFailed(migration, "Migration timeout after 30 minutes")
        
        return
```

## 4. (Optionnel) Ajouter des notifications pour les seuils dépassés

Dans la fonction `Evaluate` ou `checkThresholds`, vous pouvez ajouter :

```go
if node.CPUUsage > e.config.CPUHighThreshold {
    e.notifyThresholdExceeded(node.Name, "cpu", node.CPUUsage, e.config.CPUHighThreshold)
}

if node.MemoryUsage > e.config.MemoryHighThreshold {
    e.notifyThresholdExceeded(node.Name, "memory", node.MemoryUsage, e.config.MemoryHighThreshold)
}
```

## 5. (Optionnel) Ajouter des notifications pour le mode maintenance

Dans les fonctions de maintenance mode (`EnterMaintenanceMode`, `ExitMaintenanceMode`, `EvacuateNode`), ajouter les appels correspondants :

```go
// Dans EnterMaintenanceMode
e.notifyMaintenanceModeEnter(nodeName, len(vmsToMove))

// Dans ExitMaintenanceMode
e.notifyMaintenanceModeExit(nodeName)

// Dans EvacuateNode (à la fin)
e.notifyEvacuationCompleted(nodeName, vmsMoved, time.Since(startTime))
```
