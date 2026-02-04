package alerts

import (
	"time"
)

// AlertType représente le type d'alerte
type AlertType string

const (
	AlertTypeCPU     AlertType = "cpu"
	AlertTypeMemory  AlertType = "memory"
	AlertTypeStorage AlertType = "storage"
	AlertTypeNode    AlertType = "node_down"
	AlertTypeVM      AlertType = "vm_down"
	AlertTypeEvent   AlertType = "event" // Nouveau: alerte basée sur événement
	AlertTypeCustom  AlertType = "custom"
)

// AlertSeverity représente la sévérité d'une alerte
type AlertSeverity string

const (
	SeverityInfo     AlertSeverity = "info"
	SeverityWarning  AlertSeverity = "warning"
	SeverityCritical AlertSeverity = "critical"
)

// AlertStatus représente le statut d'une alerte
type AlertStatus string

const (
	StatusActive       AlertStatus = "active"
	StatusAcknowledged AlertStatus = "acknowledged"
	StatusResolved     AlertStatus = "resolved"
)

// Alert représente une alerte
type Alert struct {
	ID             string        `json:"id" gorm:"primaryKey"`
	ConnectionID   string        `json:"connection_id" gorm:"index"`
	Type           AlertType     `json:"type" gorm:"index"`
	Severity       AlertSeverity `json:"severity" gorm:"index"`
	Status         AlertStatus   `json:"status" gorm:"index"`
	Resource       string        `json:"resource"`       // node name ou VM name
	ResourceType   string        `json:"resource_type"`  // "node" ou "vm"
	ResourceID     int           `json:"resource_id"`    // VMID si applicable
	Message        string        `json:"message"`
	CurrentValue   float64       `json:"current_value"`
	Threshold      float64       `json:"threshold"`
	Unit           string        `json:"unit"`
	Occurrences    int           `json:"occurrences" gorm:"default:1"`
	FirstSeenAt    time.Time     `json:"first_seen_at"`
	LastSeenAt     time.Time     `json:"last_seen_at" gorm:"index"`
	AcknowledgedAt *time.Time    `json:"acknowledged_at,omitempty"`
	AcknowledgedBy string        `json:"acknowledged_by,omitempty"`
	ResolvedAt     *time.Time    `json:"resolved_at,omitempty"`
	NotifiedAt     *time.Time    `json:"notified_at,omitempty"`
	RuleID         string        `json:"rule_id,omitempty" gorm:"index"` // ID de la règle qui a déclenché l'alerte
	EventID        string        `json:"event_id,omitempty"`             // ID de l'événement source (pour alertes event)
	CreatedAt      time.Time     `json:"created_at"`
	UpdatedAt      time.Time     `json:"updated_at"`
}

// AlertThresholds contient les seuils configurables pour les métriques
type AlertThresholds struct {
	CPUWarning      float64 `json:"cpu_warning" yaml:"cpu_warning"`
	CPUCritical     float64 `json:"cpu_critical" yaml:"cpu_critical"`
	MemoryWarning   float64 `json:"memory_warning" yaml:"memory_warning"`
	MemoryCritical  float64 `json:"memory_critical" yaml:"memory_critical"`
	StorageWarning  float64 `json:"storage_warning" yaml:"storage_warning"`
	StorageCritical float64 `json:"storage_critical" yaml:"storage_critical"`
}

// DefaultThresholds retourne les seuils par défaut
func DefaultThresholds() AlertThresholds {
	return AlertThresholds{
		CPUWarning:      80.0,
		CPUCritical:     95.0,
		MemoryWarning:   85.0,
		MemoryCritical:  95.0,
		StorageWarning:  80.0,
		StorageCritical: 90.0,
	}
}

// AlertSummary pour l'affichage dans le dashboard
type AlertSummary struct {
	TotalActive   int `json:"total_active"`
	Critical      int `json:"critical"`
	Warning       int `json:"warning"`
	Info          int `json:"info"`
	Acknowledged  int `json:"acknowledged"`
	ResolvedToday int `json:"resolved_today"`
}

// =====================================================
// Event Rules - Règles d'alertes sur événements Proxmox
// =====================================================

// EventCategory catégorie d'événement Proxmox
type EventCategory string

const (
	EventCategoryTask EventCategory = "task"
	EventCategoryLog  EventCategory = "log"
	EventCategoryAll  EventCategory = "all"
)

// EventLevel niveau d'événement
type EventLevel string

const (
	EventLevelError   EventLevel = "error"
	EventLevelWarning EventLevel = "warning"
	EventLevelInfo    EventLevel = "info"
	EventLevelAll     EventLevel = "all"
)

// EventRule règle d'alerte basée sur les événements Proxmox
type EventRule struct {
	ID          string        `json:"id" gorm:"primaryKey"`
	Name        string        `json:"name"`
	Description string        `json:"description"`
	Enabled     bool          `json:"enabled" gorm:"default:true"`

	// Filtres sur les événements
	Category  EventCategory `json:"category"`                          // task, log, all
	Level     EventLevel    `json:"level"`                             // error, warning, info, all
	TaskTypes string        `json:"task_types"`                        // Types de tâches séparés par virgule (qmstart,vzdump,etc.)
	Pattern   string        `json:"pattern"`                           // Regex sur le message (optionnel)

	// Scope
	ConnectionID string `json:"connection_id,omitempty"` // Vide = toutes les connexions
	NodePattern  string `json:"node_pattern,omitempty"`  // Regex sur le nom du node (optionnel)

	// Action
	Severity    AlertSeverity `json:"severity"`                    // Sévérité de l'alerte générée
	NotifyEmail bool          `json:"notify_email" gorm:"default:true"` // Envoyer un email

	// Metadata
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// ProxmoxEvent représente un événement Proxmox reçu du frontend
type ProxmoxEvent struct {
	ID             string `json:"id"`
	Timestamp      string `json:"ts"`
	Level          string `json:"level"`          // error, warning, info
	Category       string `json:"category"`       // task, log
	Type           string `json:"type"`           // Type de tâche (qmstart, vzdump, etc.)
	TypeLabel      string `json:"typeLabel"`      // Label lisible
	Entity         string `json:"entity"`         // Entité concernée (VM, etc.)
	Node           string `json:"node"`           // Nom du node
	User           string `json:"user"`           // Utilisateur
	Status         string `json:"status"`         // Statut de la tâche (OK, error, running)
	Message        string `json:"message"`        // Message de l'événement
	ConnectionID   string `json:"connectionId"`   // ID de la connexion
	ConnectionName string `json:"connectionName"` // Nom de la connexion
}

// AlertKey génère une clé unique pour identifier une alerte (pour la déduplication)
func AlertKey(connectionID string, alertType AlertType, resource string) string {
	return connectionID + ":" + string(alertType) + ":" + resource
}

// EventAlertKey génère une clé unique pour une alerte basée sur un événement
func EventAlertKey(ruleID string, eventID string) string {
	return "event:" + ruleID + ":" + eventID
}
