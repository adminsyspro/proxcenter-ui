package alerts

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	"gorm.io/gorm"

	"github.com/proxcenter/orchestrator/internal/metrics"
	"github.com/proxcenter/orchestrator/internal/notifications"
)

// NotificationService interface pour découpler des notifications
type NotificationService interface {
	NotifyAlert(data notifications.AlertNotificationData)
	NotifyEvent(data notifications.EventNotificationData, severity notifications.NotificationSeverity)
}

// Service gère les alertes
type Service struct {
	db         *gorm.DB
	thresholds AlertThresholds
	notifier   NotificationService

	// Cache des alertes actives pour la déduplication
	activeAlerts map[string]*Alert // alertKey -> Alert
	mu           sync.RWMutex

	// Cache des événements déjà traités (pour éviter les doublons)
	processedEvents map[string]time.Time // eventID -> processedAt
	eventsMu        sync.RWMutex
}

// NewService crée un nouveau service d'alertes
func NewService(db *gorm.DB, thresholds AlertThresholds) (*Service, error) {
	// Auto-migrate les modèles
	if err := db.AutoMigrate(&Alert{}, &EventRule{}); err != nil {
		return nil, fmt.Errorf("failed to migrate alert models: %w", err)
	}

	s := &Service{
		db:              db,
		thresholds:      thresholds,
		activeAlerts:    make(map[string]*Alert),
		processedEvents: make(map[string]time.Time),
	}

	// Charger les alertes actives depuis la DB
	if err := s.loadActiveAlerts(); err != nil {
		log.Error().Err(err).Msg("Failed to load active alerts from database")
	}

	// Nettoyer le cache des événements périodiquement
	go s.cleanupProcessedEventsCache()

	return s, nil
}

// SetNotificationService configure le service de notifications
func (s *Service) SetNotificationService(notifier NotificationService) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.notifier = notifier
}

// SetThresholds met à jour les seuils
func (s *Service) SetThresholds(thresholds AlertThresholds) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.thresholds = thresholds
}

// GetThresholds retourne les seuils actuels
func (s *Service) GetThresholds() AlertThresholds {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.thresholds
}

// loadActiveAlerts charge les alertes actives depuis la DB
func (s *Service) loadActiveAlerts() error {
	var alerts []Alert
	if err := s.db.Where("status = ?", StatusActive).Find(&alerts).Error; err != nil {
		return err
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	for i := range alerts {
		key := AlertKey(alerts[i].ConnectionID, alerts[i].Type, alerts[i].Resource)
		s.activeAlerts[key] = &alerts[i]
	}

	log.Info().Int("count", len(alerts)).Msg("Loaded active alerts from database")
	return nil
}

// cleanupProcessedEventsCache nettoie le cache des événements traités
func (s *Service) cleanupProcessedEventsCache() {
	ticker := time.NewTicker(10 * time.Minute)
	defer ticker.Stop()

	for range ticker.C {
		s.eventsMu.Lock()
		cutoff := time.Now().Add(-1 * time.Hour)
		for eventID, processedAt := range s.processedEvents {
			if processedAt.Before(cutoff) {
				delete(s.processedEvents, eventID)
			}
		}
		s.eventsMu.Unlock()
	}
}

// ProcessMetrics analyse les métriques et génère des alertes
func (s *Service) ProcessMetrics(ctx context.Context, clusterMetrics *metrics.ClusterMetrics) error {
	if clusterMetrics == nil {
		return nil
	}

	s.mu.RLock()
	thresholds := s.thresholds
	s.mu.RUnlock()

	// Vérifier les métriques de chaque nœud
	for _, node := range clusterMetrics.Nodes {
		// Alerte CPU
		s.checkNodeMetric(
			clusterMetrics.ConnectionID,
			node.Node,
			AlertTypeCPU,
			node.CPUUsage,
			thresholds.CPUWarning,
			thresholds.CPUCritical,
			"%",
		)

		// Alerte Mémoire
		s.checkNodeMetric(
			clusterMetrics.ConnectionID,
			node.Node,
			AlertTypeMemory,
			node.MemoryUsage,
			thresholds.MemoryWarning,
			thresholds.MemoryCritical,
			"%",
		)

		// Alerte Stockage
		s.checkNodeMetric(
			clusterMetrics.ConnectionID,
			node.Node,
			AlertTypeStorage,
			node.DiskUsage,
			thresholds.StorageWarning,
			thresholds.StorageCritical,
			"%",
		)

		// Alerte Node Down
		if node.Status != "online" {
			s.createOrUpdateAlert(
				clusterMetrics.ConnectionID,
				AlertTypeNode,
				SeverityCritical,
				node.Node,
				"node",
				0,
				fmt.Sprintf("Node %s is %s", node.Node, node.Status),
				0, 0, "",
				"", "", // pas de ruleID ni eventID
			)
		} else {
			// Résoudre l'alerte si le nœud est revenu online
			s.resolveAlert(clusterMetrics.ConnectionID, AlertTypeNode, node.Node)
		}
	}

	return nil
}

// checkNodeMetric vérifie une métrique et crée/résout les alertes
func (s *Service) checkNodeMetric(
	connectionID string,
	nodeName string,
	alertType AlertType,
	currentValue float64,
	warningThreshold float64,
	criticalThreshold float64,
	unit string,
) {
	var severity AlertSeverity
	var threshold float64

	if currentValue >= criticalThreshold {
		severity = SeverityCritical
		threshold = criticalThreshold
	} else if currentValue >= warningThreshold {
		severity = SeverityWarning
		threshold = warningThreshold
	} else {
		// Sous le seuil - résoudre l'alerte existante si elle existe
		s.resolveAlert(connectionID, alertType, nodeName)
		return
	}

	// Créer le message
	typeLabel := map[AlertType]string{
		AlertTypeCPU:     "CPU",
		AlertTypeMemory:  "RAM",
		AlertTypeStorage: "Stockage",
	}

	message := fmt.Sprintf("Node %s : %s %s (%.1f%s)",
		nodeName,
		typeLabel[alertType],
		severity,
		currentValue,
		unit,
	)

	s.createOrUpdateAlert(
		connectionID,
		alertType,
		severity,
		nodeName,
		"node",
		0,
		message,
		currentValue,
		threshold,
		unit,
		"", "", // pas de ruleID ni eventID
	)
}

// createOrUpdateAlert crée ou met à jour une alerte
func (s *Service) createOrUpdateAlert(
	connectionID string,
	alertType AlertType,
	severity AlertSeverity,
	resource string,
	resourceType string,
	resourceID int,
	message string,
	currentValue float64,
	threshold float64,
	unit string,
	ruleID string,
	eventID string,
) {
	key := AlertKey(connectionID, alertType, resource)

	s.mu.Lock()
	existing, exists := s.activeAlerts[key]
	s.mu.Unlock()

	now := time.Now()

	if exists {
		// Mettre à jour l'alerte existante
		existing.LastSeenAt = now
		existing.Occurrences++
		existing.CurrentValue = currentValue
		existing.Message = message
		existing.Severity = severity // La sévérité peut changer
		existing.UpdatedAt = now

		s.db.Save(existing)

		log.Debug().
			Str("alert_id", existing.ID).
			Str("resource", resource).
			Int("occurrences", existing.Occurrences).
			Msg("Alert occurrence updated")
		
		// PAS de re-notification - on notifie uniquement à la création
	} else {
		// Créer une nouvelle alerte
		alert := &Alert{
			ID:           uuid.New().String(),
			ConnectionID: connectionID,
			Type:         alertType,
			Severity:     severity,
			Status:       StatusActive,
			Resource:     resource,
			ResourceType: resourceType,
			ResourceID:   resourceID,
			Message:      message,
			CurrentValue: currentValue,
			Threshold:    threshold,
			Unit:         unit,
			Occurrences:  1,
			FirstSeenAt:  now,
			LastSeenAt:   now,
			RuleID:       ruleID,
			EventID:      eventID,
			CreatedAt:    now,
			UpdatedAt:    now,
		}

		s.db.Create(alert)

		s.mu.Lock()
		s.activeAlerts[key] = alert
		s.mu.Unlock()

		log.Info().
			Str("alert_id", alert.ID).
			Str("type", string(alertType)).
			Str("severity", string(severity)).
			Str("resource", resource).
			Msg("New alert created")

		// Notifier UNIQUEMENT pour les nouvelles alertes
		s.sendNotification(alert)
	}
}

// resolveAlert résout une alerte
func (s *Service) resolveAlert(connectionID string, alertType AlertType, resource string) {
	key := AlertKey(connectionID, alertType, resource)

	s.mu.Lock()
	alert, exists := s.activeAlerts[key]
	if exists {
		delete(s.activeAlerts, key)
	}
	s.mu.Unlock()

	if !exists {
		return
	}

	now := time.Now()
	alert.Status = StatusResolved
	alert.ResolvedAt = &now
	alert.UpdatedAt = now

	s.db.Save(alert)

	log.Info().
		Str("alert_id", alert.ID).
		Str("resource", resource).
		Msg("Alert resolved")
}

// sendNotification envoie une notification pour une alerte
func (s *Service) sendNotification(alert *Alert) {
	s.mu.RLock()
	notifier := s.notifier
	s.mu.RUnlock()

	if notifier == nil {
		return
	}

	notifier.NotifyAlert(notifications.AlertNotificationData{
		AlertID:      alert.ID,
		AlertName:    alert.Message,
		Resource:     alert.Resource,
		Node:         alert.Resource,
		CurrentValue: alert.CurrentValue,
		Threshold:    alert.Threshold,
		Unit:         alert.Unit,
		Description:  fmt.Sprintf("Alerte %s sur %s", alert.Severity, alert.Resource),
	})

	// Marquer comme notifié
	now := time.Now()
	alert.NotifiedAt = &now
	s.db.Save(alert)

	log.Info().
		Str("alert_id", alert.ID).
		Str("resource", alert.Resource).
		Msg("Alert notification sent")
}

// ==========================================
// Event Rules - Traitement des événements
// ==========================================

// ProcessEvent traite un événement Proxmox et génère des alertes si nécessaire
func (s *Service) ProcessEvent(event ProxmoxEvent) error {
	// Vérifier si l'événement a déjà été traité
	s.eventsMu.RLock()
	_, alreadyProcessed := s.processedEvents[event.ID]
	s.eventsMu.RUnlock()

	if alreadyProcessed {
		return nil
	}

	// Marquer comme traité
	s.eventsMu.Lock()
	s.processedEvents[event.ID] = time.Now()
	s.eventsMu.Unlock()

	// Charger les règles actives
	var rules []EventRule
	if err := s.db.Where("enabled = ?", true).Find(&rules).Error; err != nil {
		return fmt.Errorf("failed to load event rules: %w", err)
	}

	// Vérifier chaque règle
	for _, rule := range rules {
		if s.eventMatchesRule(event, rule) {
			s.createEventAlert(event, rule)
		}
	}

	return nil
}

// ProcessEvents traite plusieurs événements
func (s *Service) ProcessEvents(events []ProxmoxEvent) error {
	for _, event := range events {
		if err := s.ProcessEvent(event); err != nil {
			log.Error().Err(err).Str("event_id", event.ID).Msg("Failed to process event")
		}
	}
	return nil
}

// eventMatchesRule vérifie si un événement correspond à une règle
func (s *Service) eventMatchesRule(event ProxmoxEvent, rule EventRule) bool {
	// Filtre sur la catégorie
	if rule.Category != EventCategoryAll && string(rule.Category) != event.Category {
		return false
	}

	// Filtre sur le niveau
	if rule.Level != EventLevelAll && string(rule.Level) != event.Level {
		return false
	}

	// Filtre sur la connexion
	if rule.ConnectionID != "" && rule.ConnectionID != event.ConnectionID {
		return false
	}

	// Filtre sur les types de tâches
	if rule.TaskTypes != "" {
		taskTypes := strings.Split(rule.TaskTypes, ",")
		found := false
		for _, t := range taskTypes {
			if strings.TrimSpace(t) == event.Type {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}

	// Filtre sur le pattern du message
	if rule.Pattern != "" {
		re, err := regexp.Compile(rule.Pattern)
		if err != nil {
			log.Warn().Err(err).Str("rule_id", rule.ID).Msg("Invalid regex pattern")
			return false
		}
		if !re.MatchString(event.Message) {
			return false
		}
	}

	// Filtre sur le pattern du node
	if rule.NodePattern != "" {
		re, err := regexp.Compile(rule.NodePattern)
		if err != nil {
			log.Warn().Err(err).Str("rule_id", rule.ID).Msg("Invalid node pattern")
			return false
		}
		if !re.MatchString(event.Node) {
			return false
		}
	}

	return true
}

// createEventAlert crée une alerte à partir d'un événement
func (s *Service) createEventAlert(event ProxmoxEvent, rule EventRule) {
	// Utiliser l'entité ou le node comme ressource
	resource := event.Entity
	if resource == "" {
		resource = event.Node
	}

	// Créer le message
	message := fmt.Sprintf("[%s] %s", rule.Name, event.Message)

	// Créer l'alerte dans la DB
	s.createOrUpdateAlert(
		event.ConnectionID,
		AlertTypeEvent,
		rule.Severity,
		resource,
		"event",
		0,
		message,
		0, 0, "",
		rule.ID,
		event.ID,
	)

	// Envoyer une notification si configuré
	if rule.NotifyEmail {
		s.mu.RLock()
		notifier := s.notifier
		s.mu.RUnlock()

		if notifier != nil {
			// Mapper la sévérité
			var severity notifications.NotificationSeverity
			switch rule.Severity {
			case SeverityCritical:
				severity = notifications.SeverityCritical
			case SeverityWarning:
				severity = notifications.SeverityWarning
			default:
				severity = notifications.SeverityInfo
			}

			notifier.NotifyEvent(notifications.EventNotificationData{
				EventID:        event.ID,
				RuleID:         rule.ID,
				RuleName:       rule.Name,
				Type:           event.Type,
				TypeLabel:      event.TypeLabel,
				Entity:         event.Entity,
				Node:           event.Node,
				User:           event.User,
				Status:         event.Status,
				Message:        event.Message,
				ConnectionID:   event.ConnectionID,
				ConnectionName: event.ConnectionName,
				UPID:           event.ID, // L'ID est souvent le UPID
			}, severity)
		}
	}

	log.Info().
		Str("rule_id", rule.ID).
		Str("rule_name", rule.Name).
		Str("event_id", event.ID).
		Msg("Event alert created")
}

// ==========================================
// Event Rules CRUD
// ==========================================

// GetEventRules retourne toutes les règles d'événements
func (s *Service) GetEventRules() ([]EventRule, error) {
	var rules []EventRule
	if err := s.db.Order("created_at DESC").Find(&rules).Error; err != nil {
		return nil, err
	}
	return rules, nil
}

// GetEventRule retourne une règle par ID
func (s *Service) GetEventRule(id string) (*EventRule, error) {
	var rule EventRule
	if err := s.db.First(&rule, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &rule, nil
}

// CreateEventRule crée une nouvelle règle
func (s *Service) CreateEventRule(rule *EventRule) error {
	rule.ID = uuid.New().String()
	rule.CreatedAt = time.Now()
	rule.UpdatedAt = time.Now()

	if err := s.db.Create(rule).Error; err != nil {
		return err
	}

	log.Info().
		Str("rule_id", rule.ID).
		Str("rule_name", rule.Name).
		Msg("Event rule created")

	return nil
}

// UpdateEventRule met à jour une règle
func (s *Service) UpdateEventRule(id string, updates *EventRule) error {
	var rule EventRule
	if err := s.db.First(&rule, "id = ?", id).Error; err != nil {
		return err
	}

	// Mettre à jour les champs
	rule.Name = updates.Name
	rule.Description = updates.Description
	rule.Enabled = updates.Enabled
	rule.Category = updates.Category
	rule.Level = updates.Level
	rule.TaskTypes = updates.TaskTypes
	rule.Pattern = updates.Pattern
	rule.ConnectionID = updates.ConnectionID
	rule.NodePattern = updates.NodePattern
	rule.Severity = updates.Severity
	rule.NotifyEmail = updates.NotifyEmail
	rule.UpdatedAt = time.Now()

	if err := s.db.Save(&rule).Error; err != nil {
		return err
	}

	log.Info().
		Str("rule_id", rule.ID).
		Str("rule_name", rule.Name).
		Msg("Event rule updated")

	return nil
}

// DeleteEventRule supprime une règle
func (s *Service) DeleteEventRule(id string) error {
	if err := s.db.Delete(&EventRule{}, "id = ?", id).Error; err != nil {
		return err
	}

	log.Info().Str("rule_id", id).Msg("Event rule deleted")
	return nil
}

// ToggleEventRule active/désactive une règle
func (s *Service) ToggleEventRule(id string) error {
	var rule EventRule
	if err := s.db.First(&rule, "id = ?", id).Error; err != nil {
		return err
	}

	rule.Enabled = !rule.Enabled
	rule.UpdatedAt = time.Now()

	if err := s.db.Save(&rule).Error; err != nil {
		return err
	}

	log.Info().
		Str("rule_id", rule.ID).
		Bool("enabled", rule.Enabled).
		Msg("Event rule toggled")

	return nil
}

// ==========================================
// API publique - Alertes
// ==========================================

// GetActiveAlerts retourne les alertes actives
func (s *Service) GetActiveAlerts(connectionID string) ([]Alert, error) {
	var alerts []Alert
	query := s.db.Where("status = ?", StatusActive).Order("severity DESC, last_seen_at DESC")

	if connectionID != "" {
		query = query.Where("connection_id = ?", connectionID)
	}

	if err := query.Find(&alerts).Error; err != nil {
		return nil, err
	}
	return alerts, nil
}

// GetAllAlerts retourne toutes les alertes avec filtres
func (s *Service) GetAllAlerts(connectionID string, status AlertStatus, limit, offset int) ([]Alert, int64, error) {
	var alerts []Alert
	var total int64

	query := s.db.Model(&Alert{})

	if connectionID != "" {
		query = query.Where("connection_id = ?", connectionID)
	}
	if status != "" {
		query = query.Where("status = ?", status)
	}

	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	if err := query.Order("last_seen_at DESC").Limit(limit).Offset(offset).Find(&alerts).Error; err != nil {
		return nil, 0, err
	}

	return alerts, total, nil
}

// GetAlertSummary retourne un résumé des alertes
func (s *Service) GetAlertSummary(connectionID string) (*AlertSummary, error) {
	summary := &AlertSummary{}

	baseQuery := s.db.Model(&Alert{})
	if connectionID != "" {
		baseQuery = baseQuery.Where("connection_id = ?", connectionID)
	}

	// Actives par sévérité
	var criticalCount, warningCount, infoCount int64
	baseQuery.Where("status = ? AND severity = ?", StatusActive, SeverityCritical).Count(&criticalCount)
	
	baseQuery2 := s.db.Model(&Alert{})
	if connectionID != "" {
		baseQuery2 = baseQuery2.Where("connection_id = ?", connectionID)
	}
	baseQuery2.Where("status = ? AND severity = ?", StatusActive, SeverityWarning).Count(&warningCount)
	
	baseQuery3 := s.db.Model(&Alert{})
	if connectionID != "" {
		baseQuery3 = baseQuery3.Where("connection_id = ?", connectionID)
	}
	baseQuery3.Where("status = ? AND severity = ?", StatusActive, SeverityInfo).Count(&infoCount)

	// Acknowledged
	var acknowledgedCount int64
	baseQuery4 := s.db.Model(&Alert{})
	if connectionID != "" {
		baseQuery4 = baseQuery4.Where("connection_id = ?", connectionID)
	}
	baseQuery4.Where("status = ?", StatusAcknowledged).Count(&acknowledgedCount)

	// Résolues aujourd'hui
	var resolvedTodayCount int64
	today := time.Now().Truncate(24 * time.Hour)
	baseQuery5 := s.db.Model(&Alert{})
	if connectionID != "" {
		baseQuery5 = baseQuery5.Where("connection_id = ?", connectionID)
	}
	baseQuery5.Where("status = ? AND resolved_at >= ?", StatusResolved, today).Count(&resolvedTodayCount)

	summary.Critical = int(criticalCount)
	summary.Warning = int(warningCount)
	summary.Info = int(infoCount)
	summary.TotalActive = summary.Critical + summary.Warning + summary.Info
	summary.Acknowledged = int(acknowledgedCount)
	summary.ResolvedToday = int(resolvedTodayCount)

	return summary, nil
}

// AcknowledgeAlert acquitte une alerte
func (s *Service) AcknowledgeAlert(alertID string, acknowledgedBy string) error {
	var alert Alert
	if err := s.db.First(&alert, "id = ?", alertID).Error; err != nil {
		return err
	}

	now := time.Now()
	alert.Status = StatusAcknowledged
	alert.AcknowledgedAt = &now
	alert.AcknowledgedBy = acknowledgedBy
	alert.UpdatedAt = now

	if err := s.db.Save(&alert).Error; err != nil {
		return err
	}

	// Retirer du cache des alertes actives
	key := AlertKey(alert.ConnectionID, alert.Type, alert.Resource)
	s.mu.Lock()
	delete(s.activeAlerts, key)
	s.mu.Unlock()

	return nil
}

// ResolveAlertManually résout manuellement une alerte
func (s *Service) ResolveAlertManually(alertID string) error {
	var alert Alert
	if err := s.db.First(&alert, "id = ?", alertID).Error; err != nil {
		return err
	}

	now := time.Now()
	alert.Status = StatusResolved
	alert.ResolvedAt = &now
	alert.UpdatedAt = now

	if err := s.db.Save(&alert).Error; err != nil {
		return err
	}

	// Retirer du cache des alertes actives
	key := AlertKey(alert.ConnectionID, alert.Type, alert.Resource)
	s.mu.Lock()
	delete(s.activeAlerts, key)
	s.mu.Unlock()

	return nil
}

// ClearAllAlerts supprime toutes les alertes (pour le bouton "Vider tout")
func (s *Service) ClearAllAlerts(connectionID string) error {
	query := s.db.Where("status = ?", StatusActive)
	if connectionID != "" {
		query = query.Where("connection_id = ?", connectionID)
	}

	now := time.Now()
	if err := query.Model(&Alert{}).Updates(map[string]interface{}{
		"status":      StatusResolved,
		"resolved_at": now,
		"updated_at":  now,
	}).Error; err != nil {
		return err
	}

	// Vider le cache
	s.mu.Lock()
	if connectionID == "" {
		s.activeAlerts = make(map[string]*Alert)
	} else {
		for key, alert := range s.activeAlerts {
			if alert.ConnectionID == connectionID {
				delete(s.activeAlerts, key)
			}
		}
	}
	s.mu.Unlock()

	return nil
}

// GetAlert retourne une alerte par ID
func (s *Service) GetAlert(alertID string) (*Alert, error) {
	var alert Alert
	if err := s.db.First(&alert, "id = ?", alertID).Error; err != nil {
		return nil, err
	}
	return &alert, nil
}
