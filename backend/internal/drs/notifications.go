package drs

import (
	"fmt"
	"time"

	"github.com/proxcenter/orchestrator/internal/notifications"
)

// NotificationService interface pour découpler le DRS des notifications
type NotificationService interface {
	NotifyMigrationStarted(data notifications.MigrationNotificationData)
	NotifyMigrationCompleted(data notifications.MigrationNotificationData)
	NotifyMigrationFailed(data notifications.MigrationNotificationData, errMsg string)
	NotifyAlert(data notifications.AlertNotificationData)
	NotifyMaintenanceMode(data notifications.MaintenanceNotificationData)
}

// SetNotificationService configure le service de notifications pour le DRS
func (e *Engine) SetNotificationService(svc NotificationService) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.notificationService = svc
}

// notifyMigrationStarted envoie une notification de début de migration
func (e *Engine) notifyMigrationStarted(migration *Migration, reason string) {
	e.mu.RLock()
	svc := e.notificationService
	e.mu.RUnlock()

	if svc == nil {
		return
	}

	svc.NotifyMigrationStarted(notifications.MigrationNotificationData{
		VMID:       migration.VMID,
		VMName:     migration.VMName,
		SourceNode: migration.SourceNode,
		TargetNode: migration.TargetNode,
		Reason:     reason,
		Status:     "started",
	})
}

// notifyMigrationCompleted envoie une notification de fin de migration
func (e *Engine) notifyMigrationCompleted(migration *Migration) {
	e.mu.RLock()
	svc := e.notificationService
	e.mu.RUnlock()

	if svc == nil {
		return
	}

	duration := "N/A"
	if migration.CompletedAt != nil {
		duration = migration.CompletedAt.Sub(migration.StartedAt).Round(time.Second).String()
	}

	svc.NotifyMigrationCompleted(notifications.MigrationNotificationData{
		VMID:       migration.VMID,
		VMName:     migration.VMName,
		SourceNode: migration.SourceNode,
		TargetNode: migration.TargetNode,
		Duration:   duration,
		Status:     "completed",
	})
}

// notifyMigrationFailed envoie une notification d'échec de migration
func (e *Engine) notifyMigrationFailed(migration *Migration, errMsg string) {
	e.mu.RLock()
	svc := e.notificationService
	e.mu.RUnlock()

	if svc == nil {
		return
	}

	svc.NotifyMigrationFailed(notifications.MigrationNotificationData{
		VMID:       migration.VMID,
		VMName:     migration.VMName,
		SourceNode: migration.SourceNode,
		TargetNode: migration.TargetNode,
		Status:     "failed",
	}, errMsg)
}

// notifyThresholdExceeded envoie une alerte quand un seuil est dépassé
func (e *Engine) notifyThresholdExceeded(node string, resourceType string, currentValue, threshold float64) {
	e.mu.RLock()
	svc := e.notificationService
	e.mu.RUnlock()

	if svc == nil {
		return
	}

	var alertName, description string
	switch resourceType {
	case "cpu":
		alertName = fmt.Sprintf("CPU élevé sur %s", node)
		description = fmt.Sprintf("L'utilisation CPU du nœud %s a dépassé le seuil configuré.", node)
	case "memory":
		alertName = fmt.Sprintf("Mémoire élevée sur %s", node)
		description = fmt.Sprintf("L'utilisation mémoire du nœud %s a dépassé le seuil configuré.", node)
	case "storage":
		alertName = fmt.Sprintf("Stockage élevé sur %s", node)
		description = fmt.Sprintf("L'utilisation du stockage sur le nœud %s a dépassé le seuil configuré.", node)
	default:
		alertName = fmt.Sprintf("Seuil dépassé sur %s", node)
		description = fmt.Sprintf("Une ressource du nœud %s a dépassé son seuil.", node)
	}

	svc.NotifyAlert(notifications.AlertNotificationData{
		AlertID:      fmt.Sprintf("%s-%s-%d", node, resourceType, time.Now().Unix()),
		AlertName:    alertName,
		Resource:     resourceType,
		Node:         node,
		CurrentValue: currentValue,
		Threshold:    threshold,
		Unit:         "%",
		Description:  description,
	})
}

// notifyMaintenanceModeEnter envoie une notification d'entrée en mode maintenance
func (e *Engine) notifyMaintenanceModeEnter(node string, vmsToMove int) {
	e.mu.RLock()
	svc := e.notificationService
	e.mu.RUnlock()

	if svc == nil {
		return
	}

	svc.NotifyMaintenanceMode(notifications.MaintenanceNotificationData{
		Node:      node,
		Action:    "enter",
		VMsToMove: vmsToMove,
	})
}

// notifyMaintenanceModeExit envoie une notification de sortie du mode maintenance
func (e *Engine) notifyMaintenanceModeExit(node string) {
	e.mu.RLock()
	svc := e.notificationService
	e.mu.RUnlock()

	if svc == nil {
		return
	}

	svc.NotifyMaintenanceMode(notifications.MaintenanceNotificationData{
		Node:   node,
		Action: "exit",
	})
}

// notifyEvacuationCompleted envoie une notification de fin d'évacuation
func (e *Engine) notifyEvacuationCompleted(node string, vmsMoved int, duration time.Duration) {
	e.mu.RLock()
	svc := e.notificationService
	e.mu.RUnlock()

	if svc == nil {
		return
	}

	svc.NotifyMaintenanceMode(notifications.MaintenanceNotificationData{
		Node:     node,
		Action:   "evacuate",
		VMsMoved: vmsMoved,
		Duration: duration.Round(time.Second).String(),
	})
}
