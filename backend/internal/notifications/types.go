package notifications

import (
	"time"
)

// NotificationType représente le type de notification
type NotificationType string

const (
	NotificationTypeAlert       NotificationType = "alert"
	NotificationTypeEvent       NotificationType = "event"
	NotificationTypeMigration   NotificationType = "migration"
	NotificationTypeBackup      NotificationType = "backup"
	NotificationTypeMaintenance NotificationType = "maintenance"
	NotificationTypeReport      NotificationType = "report"
	NotificationTypeTest        NotificationType = "test"
)

// NotificationSeverity représente la sévérité de la notification
type NotificationSeverity string

const (
	SeverityInfo     NotificationSeverity = "info"
	SeveritySuccess  NotificationSeverity = "success"
	SeverityWarning  NotificationSeverity = "warning"
	SeverityCritical NotificationSeverity = "critical"
)

// NotificationStatus représente le statut d'envoi
type NotificationStatus string

const (
	StatusPending NotificationStatus = "pending"
	StatusSent    NotificationStatus = "sent"
	StatusFailed  NotificationStatus = "failed"
)

// Notification représente une notification à envoyer
type Notification struct {
	ID         string               `json:"id" gorm:"primaryKey"`
	Type       NotificationType     `json:"type"`
	Severity   NotificationSeverity `json:"severity"`
	Title      string               `json:"title"`
	Message    string               `json:"message"`
	Data       map[string]any       `json:"data" gorm:"serializer:json"`
	Recipients []string             `json:"recipients" gorm:"serializer:json"`
	Status     NotificationStatus   `json:"status"`
	SentAt     *time.Time           `json:"sent_at,omitempty"`
	Error      string               `json:"error,omitempty"`
	CreatedAt  time.Time            `json:"created_at"`
	UpdatedAt  time.Time            `json:"updated_at"`
}

// EmailConfig représente la configuration SMTP
type EmailConfig struct {
	Enabled           bool     `json:"enabled" yaml:"enabled"`
	SMTPHost          string   `json:"smtp_host" yaml:"smtp_host"`
	SMTPPort          int      `json:"smtp_port" yaml:"smtp_port"`
	SMTPUser          string   `json:"smtp_user" yaml:"smtp_user"`
	SMTPPassword      string   `json:"smtp_password" yaml:"smtp_password"`
	SMTPFrom          string   `json:"smtp_from" yaml:"smtp_from"`
	SMTPFromName      string   `json:"smtp_from_name" yaml:"smtp_from_name"`
	UseTLS            bool     `json:"use_tls" yaml:"use_tls"`
	UseStartTLS       bool     `json:"use_starttls" yaml:"use_starttls"`
	SkipVerify        bool     `json:"skip_verify" yaml:"skip_verify"`
	DefaultRecipients []string `json:"default_recipients" yaml:"default_recipients"`
}

// NotificationSettings représente les paramètres de notifications
type NotificationSettings struct {
	Email EmailConfig `json:"email" yaml:"email"`

	// Filtres par type de notification
	EnableAlerts      bool `json:"enable_alerts" yaml:"enable_alerts"`
	EnableMigrations  bool `json:"enable_migrations" yaml:"enable_migrations"`
	EnableBackups     bool `json:"enable_backups" yaml:"enable_backups"`
	EnableMaintenance bool `json:"enable_maintenance" yaml:"enable_maintenance"`
	EnableReports     bool `json:"enable_reports" yaml:"enable_reports"`

	// Filtres par sévérité
	MinSeverity NotificationSeverity `json:"min_severity" yaml:"min_severity"`

	// Rate limiting
	RateLimitPerHour int `json:"rate_limit_per_hour" yaml:"rate_limit_per_hour"`

	// Grouping
	GroupSimilar     bool          `json:"group_similar" yaml:"group_similar"`
	GroupingInterval time.Duration `json:"grouping_interval" yaml:"grouping_interval"`
}

// DefaultNotificationSettings retourne les paramètres par défaut
func DefaultNotificationSettings() NotificationSettings {
	return NotificationSettings{
		Email: EmailConfig{
			Enabled:      false,
			SMTPPort:     587,
			UseTLS:       false,
			UseStartTLS:  true,
			SkipVerify:   false,
			SMTPFromName: "ProxCenter",
		},
		EnableAlerts:      true,
		EnableMigrations:  true,
		EnableBackups:     true,
		EnableMaintenance: true,
		EnableReports:     true,
		MinSeverity:       SeverityWarning,
		RateLimitPerHour:  100,
		GroupSimilar:      true,
		GroupingInterval:  5 * time.Minute,
	}
}

// EmailTemplateData représente les données pour le rendu des templates
type EmailTemplateData struct {
	// Informations de base
	Title     string
	Message   string
	Severity  NotificationSeverity
	Type      NotificationType
	Timestamp time.Time

	// Données spécifiques au type
	Data map[string]any

	// Branding
	LogoURL      string
	AppName      string
	AppURL       string
	SupportEmail string

	// Couleurs selon sévérité
	AccentColor string
	BgColor     string
}

// GetSeverityColors retourne les couleurs associées à une sévérité
func GetSeverityColors(severity NotificationSeverity) (accent, bg string) {
	switch severity {
	case SeverityCritical:
		return "#dc2626", "#fef2f2" // Red
	case SeverityWarning:
		return "#f59e0b", "#fffbeb" // Amber
	case SeveritySuccess:
		return "#10b981", "#ecfdf5" // Green
	default: // Info
		return "#3b82f6", "#eff6ff" // Blue
	}
}

// GetSeverityIcon retourne l'icône associée à une sévérité
func GetSeverityIcon(severity NotificationSeverity) string {
	switch severity {
	case SeverityCritical:
		return "🚨"
	case SeverityWarning:
		return "⚠️"
	case SeveritySuccess:
		return "✅"
	default:
		return "ℹ️"
	}
}

// MigrationNotificationData données pour les notifications de migration
type MigrationNotificationData struct {
	VMID       int    `json:"vmid"`
	VMName     string `json:"vm_name"`
	SourceNode string `json:"source_node"`
	TargetNode string `json:"target_node"`
	Reason     string `json:"reason"`
	Duration   string `json:"duration,omitempty"`
	Status     string `json:"status"`
	Error      string `json:"error,omitempty"`
}

// BackupNotificationData données pour les notifications de backup
type BackupNotificationData struct {
	JobID        string    `json:"job_id"`
	JobName      string    `json:"job_name"`
	VMCount      int       `json:"vm_count"`
	SuccessCount int       `json:"success_count"`
	FailedCount  int       `json:"failed_count"`
	TotalSize    string    `json:"total_size"`
	Duration     string    `json:"duration"`
	StartTime    time.Time `json:"start_time"`
	EndTime      time.Time `json:"end_time"`
	Errors       []string  `json:"errors,omitempty"`
}

// AlertNotificationData données pour les notifications d'alerte
type AlertNotificationData struct {
	AlertID      string  `json:"alert_id"`
	AlertName    string  `json:"alert_name"`
	Resource     string  `json:"resource"`
	Node         string  `json:"node"`
	CurrentValue float64 `json:"current_value"`
	Threshold    float64 `json:"threshold"`
	Unit         string  `json:"unit"`
	Description  string  `json:"description"`
}

// MaintenanceNotificationData données pour les notifications de maintenance
type MaintenanceNotificationData struct {
	Node      string `json:"node"`
	Action    string `json:"action"` // "enter", "exit", "evacuate"
	VMsToMove int    `json:"vms_to_move,omitempty"`
	VMsMoved  int    `json:"vms_moved,omitempty"`
	Duration  string `json:"duration,omitempty"`
}

// EventNotificationData données pour les notifications d'événements Proxmox
type EventNotificationData struct {
	EventID        string `json:"event_id"`
	RuleID         string `json:"rule_id"`
	RuleName       string `json:"rule_name"`
	Type           string `json:"type"`            // qmsnapshot, vzdump, etc.
	TypeLabel      string `json:"type_label"`      // Label lisible
	Entity         string `json:"entity"`          // VM/CT concerné
	Node           string `json:"node"`
	User           string `json:"user"`
	Status         string `json:"status"`
	Message        string `json:"message"`
	ConnectionID   string `json:"connection_id"`
	ConnectionName string `json:"connection_name"`
	UPID           string `json:"upid,omitempty"`
}

// ReportNotificationData données pour les rapports périodiques
type ReportNotificationData struct {
	Period       string  `json:"period"` // "daily", "weekly", "monthly"
	TotalVMs     int     `json:"total_vms"`
	TotalNodes   int     `json:"total_nodes"`
	Migrations   int     `json:"migrations"`
	Alerts       int     `json:"alerts"`
	Backups      int     `json:"backups"`
	AvgCPU       float64 `json:"avg_cpu"`
	AvgMemory    float64 `json:"avg_memory"`
	TopConsumers []struct {
		Name   string  `json:"name"`
		CPU    float64 `json:"cpu"`
		Memory float64 `json:"memory"`
	} `json:"top_consumers,omitempty"`
}
