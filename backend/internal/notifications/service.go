package notifications

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	"gorm.io/gorm"
)

// Service gère les notifications
type Service struct {
	db             *gorm.DB
	email          *EmailProvider
	templates      *TemplateManager
	templateStore  *TemplateStore
	settings       NotificationSettings
	settingsMutex  sync.RWMutex

	// Queue async
	queue    chan *Notification
	stopChan chan struct{}
	wg       sync.WaitGroup

	// Rate limiting
	sentCount     int
	sentCountLock sync.Mutex
	lastReset     time.Time
}

// NewService crée un nouveau service de notifications
func NewService(db *gorm.DB, settings NotificationSettings) (*Service, error) {
	// Auto-migrate le modèle Notification
	if err := db.AutoMigrate(&Notification{}); err != nil {
		return nil, fmt.Errorf("failed to migrate notification model: %w", err)
	}

	// Créer le provider email
	emailProvider := NewEmailProvider(settings.Email)

	// Créer le gestionnaire de templates
	templates, err := NewTemplateManager("ProxCenter", "", "")
	if err != nil {
		return nil, fmt.Errorf("failed to create template manager: %w", err)
	}

	// Créer le store de templates personnalisés
	templateStore, err := NewTemplateStore(db)
	if err != nil {
		log.Warn().Err(err).Msg("Failed to create template store, using defaults")
	}

	s := &Service{
		db:            db,
		email:         emailProvider,
		templates:     templates,
		templateStore: templateStore,
		settings:      settings,
		queue:         make(chan *Notification, 100),
		stopChan:      make(chan struct{}),
		lastReset:     time.Now(),
	}

	// Démarrer le worker
	s.wg.Add(1)
	go s.worker()

	log.Info().Msg("Notification service started")

	return s, nil
}

// Stop arrête le service proprement
func (s *Service) Stop() {
	close(s.stopChan)
	s.wg.Wait()
	log.Info().Msg("Notification service stopped")
}

// worker traite les notifications en arrière-plan
func (s *Service) worker() {
	defer s.wg.Done()

	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()

	for {
		select {
		case <-s.stopChan:
			// Traiter les notifications restantes
			for {
				select {
				case n := <-s.queue:
					s.processNotification(n)
				default:
					return
				}
			}

		case n := <-s.queue:
			s.processNotification(n)

		case <-ticker.C:
			// Reset du rate limit
			s.sentCountLock.Lock()
			s.sentCount = 0
			s.lastReset = time.Now()
			s.sentCountLock.Unlock()
		}
	}
}

// processNotification traite une notification
func (s *Service) processNotification(n *Notification) {
	ctx := context.Background()

	// Vérifier le rate limit
	if !s.checkRateLimit() {
		log.Warn().Str("notification_id", n.ID).Msg("Rate limit exceeded, dropping notification")
		n.Status = StatusFailed
		n.Error = "rate limit exceeded"
		s.db.Save(n)
		return
	}

	// Vérifier si le type est activé
	if !s.isTypeEnabled(n.Type) {
		log.Debug().Str("type", string(n.Type)).Msg("Notification type disabled, skipping")
		return
	}

	// Vérifier la sévérité minimale
	if !s.meetsSeverityThreshold(n.Severity) {
		log.Debug().Str("severity", string(n.Severity)).Msg("Below severity threshold, skipping")
		return
	}

	// Envoyer l'email si configuré
	if s.email.IsEnabled() {
		if err := s.sendEmail(ctx, n); err != nil {
			log.Error().Err(err).Str("notification_id", n.ID).Msg("Failed to send email")
			n.Status = StatusFailed
			n.Error = err.Error()
		} else {
			now := time.Now()
			n.Status = StatusSent
			n.SentAt = &now
			s.incrementSentCount()
			log.Info().Str("notification_id", n.ID).Str("title", n.Title).Msg("Notification sent successfully")
		}
	} else {
		log.Debug().Str("notification_id", n.ID).Msg("Email not enabled, notification saved but not sent")
		n.Status = StatusPending
	}

	// Sauvegarder le statut
	s.db.Save(n)
}

// sendEmail envoie la notification par email
func (s *Service) sendEmail(ctx context.Context, n *Notification) error {
	// Déterminer les destinataires
	recipients := n.Recipients
	if len(recipients) == 0 {
		s.settingsMutex.RLock()
		recipients = s.settings.Email.DefaultRecipients
		s.settingsMutex.RUnlock()
	}

	if len(recipients) == 0 {
		return fmt.Errorf("no recipients configured")
	}

	var subject, html, text string
	var err error

	// Log pour debug
	log.Debug().
		Str("notification_type", string(n.Type)).
		Bool("has_template_store", s.templateStore != nil).
		Msg("Processing notification email")

	// Pour les événements, utiliser les templates personnalisés
	if n.Type == NotificationTypeEvent && s.templateStore != nil {
		log.Debug().Msg("Using custom event template")
		subject, html, text, err = s.renderEventTemplate(n)
		if err != nil {
			log.Warn().Err(err).Msg("Failed to render custom template, falling back to default")
			// Fallback au template par défaut
			html, text, err = s.templates.RenderNotification(n)
			if err != nil {
				return fmt.Errorf("failed to render template: %w", err)
			}
			subject = fmt.Sprintf("[ProxCenter] %s %s", GetSeverityIcon(n.Severity), n.Title)
		}
	} else {
		log.Debug().Msg("Using default template")
		// Rendre le template standard
		html, text, err = s.templates.RenderNotification(n)
		if err != nil {
			return fmt.Errorf("failed to render template: %w", err)
		}
		subject = fmt.Sprintf("[ProxCenter] %s %s", GetSeverityIcon(n.Severity), n.Title)
	}

	// Envoyer
	return s.email.Send(recipients, subject, html, text)
}

// renderEventTemplate rend un template d'événement personnalisé
func (s *Service) renderEventTemplate(n *Notification) (subject, html, text string, err error) {
	// Récupérer le template "event" depuis la DB
	tpl, err := s.templateStore.Get("event")
	if err != nil {
		return "", "", "", fmt.Errorf("template 'event' not found: %w", err)
	}

	// Construire les données du template à partir des données de la notification
	data := s.buildTemplateDataFromNotification(n)

	// Rendre le sujet
	subject = RenderTemplate(tpl.Subject, data)

	// Rendre le corps HTML
	bodyHTML := RenderTemplate(tpl.Body, data)

	// Construire l'email complet avec header/footer ProxCenter
	html = s.wrapEmailTemplate(bodyHTML, data)

	// Version texte simple
	text = fmt.Sprintf("%s\n\n%s\n\nNœud: %s\nCluster: %s\nUtilisateur: %s\nStatut: %s",
		data.Event.TypeLabel,
		data.Event.Message,
		data.Node.Name,
		data.Cluster.Name,
		data.Event.User,
		data.Event.Status,
	)

	return subject, html, text, nil
}

// buildTemplateDataFromNotification construit TemplateData depuis une Notification
func (s *Service) buildTemplateDataFromNotification(n *Notification) *TemplateData {
	data := &TemplateData{}

	// Extraire les données de n.Data
	if n.Data != nil {
		if v, ok := n.Data["type"].(string); ok {
			data.Event.Type = v
		}
		if v, ok := n.Data["type_label"].(string); ok {
			data.Event.TypeLabel = v
		}
		if v, ok := n.Data["entity"].(string); ok {
			data.Event.Entity = v
		}
		if v, ok := n.Data["status"].(string); ok {
			data.Event.Status = v
		}
		if v, ok := n.Data["user"].(string); ok {
			data.Event.User = v
		}
		if v, ok := n.Data["node"].(string); ok {
			data.Node.Name = v
		}
		if v, ok := n.Data["connection_name"].(string); ok {
			data.Cluster.Name = v
		}
		if v, ok := n.Data["connection_id"].(string); ok {
			data.Cluster.ID = v
		}
		if v, ok := n.Data["rule_name"].(string); ok {
			data.Rule.Name = v
		}
		if v, ok := n.Data["rule_id"].(string); ok {
			data.Rule.ID = v
		}
	}

	// Message
	data.Event.Message = n.Message
	data.Event.Timestamp = time.Now().Format("02/01/2006 15:04:05")

	// Sévérité
	data.Alert.Severity = string(n.Severity)
	data.Alert.SeverityIcon, data.Alert.SeverityColor = getSeverityIconAndColor(n.Severity)

	// App
	data.App.Name = "ProxCenter"
	data.App.Version = "1.0.0"

	// Date
	data.Date.Now = time.Now().Format("02/01/2006")
	data.Date.Time = time.Now().Format("15:04:05")

	return data
}

// wrapEmailTemplate enveloppe le contenu dans le template email ProxCenter
func (s *Service) wrapEmailTemplate(bodyHTML string, data *TemplateData) string {
	// Couleur de fond du bandeau selon sévérité
	bannerBg := data.Alert.SeverityColor

	return fmt.Sprintf(`<!DOCTYPE html>
<html lang="fr" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <title>ProxCenter Alert</title>
    <!--[if mso]>
    <style type="text/css">
        table { border-collapse: collapse; }
        td, th { font-family: Arial, sans-serif; }
    </style>
    <![endif]-->
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f5; font-family: Arial, 'Helvetica Neue', Helvetica, sans-serif;">
    <table role="presentation" width="100%%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f5;">
        <tr>
            <td align="center" style="padding: 30px 15px;">
                
                <!-- Container principal -->
                <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
                    
                    <!-- HEADER PROXCENTER -->
                    <tr>
                        <td style="background-color: #0f172a; padding: 20px 30px; text-align: center;">
                            <table role="presentation" cellpadding="0" cellspacing="0" align="center">
                                <tr>
                                    <td style="color: #ffffff; font-size: 22px; font-weight: bold; font-family: Arial, sans-serif; letter-spacing: 1px;">PROX</td>
                                    <td style="color: #F29221; font-size: 22px; font-weight: normal; font-family: Arial, sans-serif; letter-spacing: 1px;">CENTER</td>
                                </tr>
                            </table>
                            <p style="margin: 8px 0 0 0; color: #94a3b8; font-size: 12px; font-family: Arial, sans-serif;">Proxmox Management Platform</p>
                        </td>
                    </tr>
                    
                    <!-- BANDEAU SEVERITE -->
                    <tr>
                        <td style="background-color: %s; padding: 12px 30px;">
                            <table role="presentation" width="100%%" cellpadding="0" cellspacing="0">
                                <tr>
                                    <td style="color: #ffffff; font-size: 15px; font-weight: bold; font-family: Arial, sans-serif; text-transform: uppercase; letter-spacing: 1px;">
                                        %s %s
                                    </td>
                                    <td align="right" style="color: #ffffff; font-size: 13px; font-family: Arial, sans-serif;">
                                        %s
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    
                    <!-- CONTENU -->
                    <tr>
                        <td style="padding: 25px 30px; background-color: #ffffff;">
                            %s
                        </td>
                    </tr>
                    
                    <!-- SEPARATEUR -->
                    <tr>
                        <td style="padding: 0 30px;">
                            <table role="presentation" width="100%%" cellpadding="0" cellspacing="0">
                                <tr>
                                    <td style="border-top: 2px solid #F29221; font-size: 0; line-height: 0;">&nbsp;</td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    
                    <!-- FOOTER -->
                    <tr>
                        <td style="background-color: #1e293b; padding: 20px 30px; text-align: center;">
                            <p style="margin: 0 0 5px 0; color: #94a3b8; font-size: 12px; font-family: Arial, sans-serif;">
                                Notification générée automatiquement par
                            </p>
                            <p style="margin: 0; color: #ffffff; font-size: 14px; font-weight: bold; font-family: Arial, sans-serif;">
                                ProxCenter
                            </p>
                            <p style="margin: 10px 0 0 0; color: #64748b; font-size: 11px; font-family: Arial, sans-serif;">
                                © 2026 ProxCenter - Proxmox Management Platform
                            </p>
                        </td>
                    </tr>
                    
                </table>
                
            </td>
        </tr>
    </table>
</body>
</html>`,
		bannerBg,
		data.Alert.SeverityIcon,
		data.Alert.Severity,
		data.Event.Timestamp,
		bodyHTML,
	)
}

// getSeverityGradientEnd n'est plus utilisé mais gardé pour compatibilité
func getSeverityGradientEnd(color string) string {
	switch color {
	case "#dc2626":
		return "#991b1b"
	case "#f59e0b":
		return "#d97706"
	case "#10b981":
		return "#059669"
	default:
		return "#1d4ed8"
	}
}

// checkRateLimit vérifie si on peut envoyer une notification
func (s *Service) checkRateLimit() bool {
	s.settingsMutex.RLock()
	limit := s.settings.RateLimitPerHour
	s.settingsMutex.RUnlock()

	if limit <= 0 {
		return true
	}

	s.sentCountLock.Lock()
	defer s.sentCountLock.Unlock()

	// Reset si plus d'une heure
	if time.Since(s.lastReset) > time.Hour {
		s.sentCount = 0
		s.lastReset = time.Now()
	}

	return s.sentCount < limit
}

// incrementSentCount incrémente le compteur d'envois
func (s *Service) incrementSentCount() {
	s.sentCountLock.Lock()
	s.sentCount++
	s.sentCountLock.Unlock()
}

// isTypeEnabled vérifie si un type de notification est activé
func (s *Service) isTypeEnabled(t NotificationType) bool {
	s.settingsMutex.RLock()
	defer s.settingsMutex.RUnlock()

	switch t {
	case NotificationTypeAlert:
		return s.settings.EnableAlerts
	case NotificationTypeMigration:
		return s.settings.EnableMigrations
	case NotificationTypeBackup:
		return s.settings.EnableBackups
	case NotificationTypeMaintenance:
		return s.settings.EnableMaintenance
	case NotificationTypeReport:
		return s.settings.EnableReports
	case NotificationTypeTest:
		return true // Toujours autoriser les tests
	default:
		return true
	}
}

// meetsSeverityThreshold vérifie si la sévérité atteint le seuil
func (s *Service) meetsSeverityThreshold(severity NotificationSeverity) bool {
	s.settingsMutex.RLock()
	minSeverity := s.settings.MinSeverity
	s.settingsMutex.RUnlock()

	severityOrder := map[NotificationSeverity]int{
		SeverityInfo:     0,
		SeveritySuccess:  1,
		SeverityWarning:  2,
		SeverityCritical: 3,
	}

	return severityOrder[severity] >= severityOrder[minSeverity]
}

// ==========================================
// API publique
// ==========================================

// Send envoie une notification (async)
func (s *Service) Send(n *Notification) {
	if n.ID == "" {
		n.ID = uuid.New().String()
	}
	n.Status = StatusPending
	n.CreatedAt = time.Now()
	n.UpdatedAt = time.Now()

	// Sauvegarder en DB
	s.db.Create(n)

	// Ajouter à la queue
	select {
	case s.queue <- n:
		log.Debug().Str("notification_id", n.ID).Msg("Notification queued")
	default:
		log.Warn().Str("notification_id", n.ID).Msg("Notification queue full, dropping")
		n.Status = StatusFailed
		n.Error = "queue full"
		s.db.Save(n)
	}
}

// SendSync envoie une notification de manière synchrone
func (s *Service) SendSync(ctx context.Context, n *Notification) error {
	if n.ID == "" {
		n.ID = uuid.New().String()
	}
	n.Status = StatusPending
	n.CreatedAt = time.Now()
	n.UpdatedAt = time.Now()

	// Sauvegarder en DB
	s.db.Create(n)

	// Traiter immédiatement
	s.processNotification(n)

	if n.Status == StatusFailed {
		return fmt.Errorf(n.Error)
	}
	return nil
}

// SendTest envoie un email de test
func (s *Service) SendTest(ctx context.Context, recipient string) error {
	html, text, err := s.templates.RenderTestEmail(recipient)
	if err != nil {
		return fmt.Errorf("failed to render test email: %w", err)
	}

	subject := "[ProxCenter] 🧪 Test de configuration email"
	return s.email.Send([]string{recipient}, subject, html, text)
}

// TestConnection teste la connexion SMTP
func (s *Service) TestConnection() error {
	return s.email.TestConnection()
}

// GetSettings retourne les paramètres actuels
func (s *Service) GetSettings() NotificationSettings {
	s.settingsMutex.RLock()
	defer s.settingsMutex.RUnlock()
	return s.settings
}

// UpdateSettings met à jour les paramètres
func (s *Service) UpdateSettings(settings NotificationSettings) {
	s.settingsMutex.Lock()
	s.settings = settings
	s.settingsMutex.Unlock()

	// Mettre à jour le provider email
	s.email.UpdateConfig(settings.Email)

	log.Info().Bool("email_enabled", settings.Email.Enabled).Msg("Notification settings updated")
}

// GetHistory retourne l'historique des notifications
func (s *Service) GetHistory(limit, offset int) ([]Notification, int64, error) {
	var notifications []Notification
	var total int64

	// Compter le total
	if err := s.db.Model(&Notification{}).Count(&total).Error; err != nil {
		return nil, 0, err
	}

	// Récupérer avec pagination
	if err := s.db.Order("created_at DESC").Limit(limit).Offset(offset).Find(&notifications).Error; err != nil {
		return nil, 0, err
	}

	return notifications, total, nil
}

// GetNotification retourne une notification par ID
func (s *Service) GetNotification(id string) (*Notification, error) {
	var n Notification
	if err := s.db.First(&n, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &n, nil
}

// ==========================================
// Helpers pour créer des notifications spécifiques
// ==========================================

// NotifyMigrationStarted notifie le début d'une migration
func (s *Service) NotifyMigrationStarted(data MigrationNotificationData) {
	s.Send(&Notification{
		Type:     NotificationTypeMigration,
		Severity: SeverityInfo,
		Title:    fmt.Sprintf("Migration démarrée: %s", data.VMName),
		Message:  fmt.Sprintf("La VM %s (ID: %d) est en cours de migration de %s vers %s.", data.VMName, data.VMID, data.SourceNode, data.TargetNode),
		Data: map[string]any{
			"vmid":        data.VMID,
			"vm_name":     data.VMName,
			"source_node": data.SourceNode,
			"target_node": data.TargetNode,
			"reason":      data.Reason,
			"status":      "started",
		},
	})
}

// NotifyMigrationCompleted notifie la fin d'une migration
func (s *Service) NotifyMigrationCompleted(data MigrationNotificationData) {
	s.Send(&Notification{
		Type:     NotificationTypeMigration,
		Severity: SeveritySuccess,
		Title:    fmt.Sprintf("Migration terminée: %s", data.VMName),
		Message:  fmt.Sprintf("La VM %s a été migrée avec succès de %s vers %s en %s.", data.VMName, data.SourceNode, data.TargetNode, data.Duration),
		Data: map[string]any{
			"vmid":        data.VMID,
			"vm_name":     data.VMName,
			"source_node": data.SourceNode,
			"target_node": data.TargetNode,
			"duration":    data.Duration,
			"status":      "completed",
		},
	})
}

// NotifyMigrationFailed notifie l'échec d'une migration
func (s *Service) NotifyMigrationFailed(data MigrationNotificationData, errMsg string) {
	s.Send(&Notification{
		Type:     NotificationTypeMigration,
		Severity: SeverityCritical,
		Title:    fmt.Sprintf("Échec de migration: %s", data.VMName),
		Message:  fmt.Sprintf("La migration de %s de %s vers %s a échoué: %s", data.VMName, data.SourceNode, data.TargetNode, errMsg),
		Data: map[string]any{
			"vmid":        data.VMID,
			"vm_name":     data.VMName,
			"source_node": data.SourceNode,
			"target_node": data.TargetNode,
			"error":       errMsg,
			"status":      "failed",
		},
	})
}

// NotifyAlert notifie une alerte
func (s *Service) NotifyAlert(data AlertNotificationData) {
	severity := SeverityWarning
	if data.CurrentValue > data.Threshold*1.2 {
		severity = SeverityCritical
	}

	s.Send(&Notification{
		Type:     NotificationTypeAlert,
		Severity: severity,
		Title:    data.AlertName,
		Message:  data.Description,
		Data: map[string]any{
			"alert_id":      data.AlertID,
			"resource":      data.Resource,
			"node":          data.Node,
			"current_value": data.CurrentValue,
			"threshold":     data.Threshold,
			"unit":          data.Unit,
		},
	})
}

// NotifyEvent notifie un événement Proxmox (tâche, log, etc.)
func (s *Service) NotifyEvent(data EventNotificationData, severity NotificationSeverity) {
	// Construire le titre
	title := data.TypeLabel
	if data.Entity != "" {
		title = fmt.Sprintf("%s - %s", data.TypeLabel, data.Entity)
	}

	// Construire le message
	message := data.Message
	if message == "" {
		message = fmt.Sprintf("Événement %s sur le nœud %s", data.TypeLabel, data.Node)
	}

	s.Send(&Notification{
		Type:     NotificationTypeEvent,
		Severity: severity,
		Title:    title,
		Message:  message,
		Data: map[string]any{
			"event_id":        data.EventID,
			"rule_id":         data.RuleID,
			"rule_name":       data.RuleName,
			"type":            data.Type,
			"type_label":      data.TypeLabel,
			"entity":          data.Entity,
			"node":            data.Node,
			"user":            data.User,
			"status":          data.Status,
			"connection_id":   data.ConnectionID,
			"connection_name": data.ConnectionName,
			"upid":            data.UPID,
		},
	})
}

// NotifyBackupCompleted notifie la fin d'un job de backup
func (s *Service) NotifyBackupCompleted(data BackupNotificationData) {
	severity := SeveritySuccess
	if data.FailedCount > 0 {
		if data.FailedCount == data.VMCount {
			severity = SeverityCritical
		} else {
			severity = SeverityWarning
		}
	}

	title := fmt.Sprintf("Backup terminé: %s", data.JobName)
	message := fmt.Sprintf("Job %s terminé: %d/%d VMs sauvegardées (%s) en %s",
		data.JobName, data.SuccessCount, data.VMCount, data.TotalSize, data.Duration)

	s.Send(&Notification{
		Type:     NotificationTypeBackup,
		Severity: severity,
		Title:    title,
		Message:  message,
		Data: map[string]any{
			"job_id":        data.JobID,
			"job_name":      data.JobName,
			"vm_count":      data.VMCount,
			"success_count": data.SuccessCount,
			"failed_count":  data.FailedCount,
			"total_size":    data.TotalSize,
			"duration":      data.Duration,
			"errors":        data.Errors,
		},
	})
}

// NotifyMaintenanceMode notifie un changement de mode maintenance
func (s *Service) NotifyMaintenanceMode(data MaintenanceNotificationData) {
	var title, message string
	severity := SeverityInfo

	switch data.Action {
	case "enter":
		title = fmt.Sprintf("Mode maintenance activé: %s", data.Node)
		message = fmt.Sprintf("Le nœud %s est passé en mode maintenance. %d VMs à déplacer.", data.Node, data.VMsToMove)
		severity = SeverityWarning
	case "exit":
		title = fmt.Sprintf("Mode maintenance désactivé: %s", data.Node)
		message = fmt.Sprintf("Le nœud %s est sorti du mode maintenance.", data.Node)
		severity = SeveritySuccess
	case "evacuate":
		title = fmt.Sprintf("Évacuation terminée: %s", data.Node)
		message = fmt.Sprintf("Évacuation du nœud %s terminée: %d VMs déplacées en %s.", data.Node, data.VMsMoved, data.Duration)
		severity = SeveritySuccess
	}

	s.Send(&Notification{
		Type:     NotificationTypeMaintenance,
		Severity: severity,
		Title:    title,
		Message:  message,
		Data: map[string]any{
			"node":        data.Node,
			"action":      data.Action,
			"vms_to_move": data.VMsToMove,
			"vms_moved":   data.VMsMoved,
			"duration":    data.Duration,
		},
	})
}

// ==========================================
// Email Templates
// ==========================================

// GetTemplates retourne tous les templates email
func (s *Service) GetTemplates() ([]EmailTemplate, error) {
	if s.templateStore == nil {
		// Retourner les templates par défaut
		return DefaultTemplates(), nil
	}
	return s.templateStore.GetAll()
}

// GetTemplate retourne un template par ID
func (s *Service) GetTemplate(id string) (*EmailTemplate, error) {
	if s.templateStore == nil {
		// Chercher dans les défauts
		for _, tpl := range DefaultTemplates() {
			if tpl.ID == id {
				return &tpl, nil
			}
		}
		return nil, fmt.Errorf("template not found: %s", id)
	}
	return s.templateStore.Get(id)
}

// SaveTemplate sauvegarde un template
func (s *Service) SaveTemplate(tpl *EmailTemplate) error {
	if s.templateStore == nil {
		return fmt.Errorf("template store not available")
	}
	return s.templateStore.Save(tpl)
}

// DeleteTemplate supprime un template
func (s *Service) DeleteTemplate(id string) error {
	if s.templateStore == nil {
		return fmt.Errorf("template store not available")
	}
	return s.templateStore.Delete(id)
}
