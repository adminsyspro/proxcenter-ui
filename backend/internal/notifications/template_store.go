package notifications

import (
	"fmt"
	"regexp"
	"strings"
	"time"

	"gorm.io/gorm"
)

// EmailTemplate représente un template d'email personnalisable
type EmailTemplate struct {
	ID        string    `json:"id" gorm:"primaryKey"`
	Name      string    `json:"name"`
	Subject   string    `json:"subject"`
	Body      string    `json:"body" gorm:"type:text"`
	IsDefault bool      `json:"is_default" gorm:"default:false"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// TemplateData représente les données disponibles pour les macros
type TemplateData struct {
	Event struct {
		Type      string `json:"type"`
		TypeLabel string `json:"type_label"`
		Entity    string `json:"entity"`
		Status    string `json:"status"`
		Message   string `json:"message"`
		User      string `json:"user"`
		Timestamp string `json:"timestamp"`
	} `json:"event"`
	Node struct {
		Name string `json:"name"`
		IP   string `json:"ip"`
	} `json:"node"`
	Cluster struct {
		Name string `json:"name"`
		ID   string `json:"id"`
	} `json:"cluster"`
	Datacenter string `json:"datacenter"`
	Alert      struct {
		Severity      string `json:"severity"`
		SeverityIcon  string `json:"severity_icon"`
		SeverityColor string `json:"severity_color"`
	} `json:"alert"`
	Rule struct {
		Name string `json:"name"`
		ID   string `json:"id"`
	} `json:"rule"`
	App struct {
		Name    string `json:"name"`
		URL     string `json:"url"`
		Version string `json:"version"`
	} `json:"app"`
	Date struct {
		Now  string `json:"now"`
		Time string `json:"time"`
	} `json:"date"`
}

// DefaultTemplates retourne les templates par défaut
func DefaultTemplates() []EmailTemplate {
	return []EmailTemplate{
		{
			ID:        "event",
			Name:      "Événement Proxmox",
			IsDefault: true,
			Subject:   "[{{alert.severity}}] {{event.type_label}} - {{event.entity}}",
			Body: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family: Arial, sans-serif;">
  <!-- Titre événement avec bordure orange -->
  <tr>
    <td style="border-left: 4px solid #F29221; padding: 15px 20px; background-color: #f8fafc;">
      <h1 style="margin: 0; font-size: 20px; color: #0f172a; font-weight: bold;">{{event.type_label}}</h1>
      <p style="margin: 5px 0 0 0; font-size: 14px; color: #64748b;">{{event.message}}</p>
    </td>
  </tr>
  
  <!-- Espacement -->
  <tr><td style="height: 20px;"></td></tr>
  
  <!-- Grille d'informations -->
  <tr>
    <td>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td width="48%" style="background-color: #f1f5f9; padding: 12px 15px; border-radius: 6px;">
            <p style="margin: 0; font-size: 11px; color: #64748b; text-transform: uppercase;">Nœud</p>
            <p style="margin: 4px 0 0 0; font-size: 15px; color: #0f172a; font-weight: bold;">{{node.name}}</p>
          </td>
          <td width="4%"></td>
          <td width="48%" style="background-color: #f1f5f9; padding: 12px 15px; border-radius: 6px;">
            <p style="margin: 0; font-size: 11px; color: #64748b; text-transform: uppercase;">Cluster</p>
            <p style="margin: 4px 0 0 0; font-size: 15px; color: #0f172a; font-weight: bold;">{{cluster.name}}</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
  
  <!-- Espacement -->
  <tr><td style="height: 10px;"></td></tr>
  
  <tr>
    <td>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td width="48%" style="background-color: #f1f5f9; padding: 12px 15px; border-radius: 6px;">
            <p style="margin: 0; font-size: 11px; color: #64748b; text-transform: uppercase;">Utilisateur</p>
            <p style="margin: 4px 0 0 0; font-size: 15px; color: #0f172a; font-weight: bold;">{{event.user}}</p>
          </td>
          <td width="4%"></td>
          <td width="48%" style="background-color: #ecfdf5; padding: 12px 15px; border-radius: 6px; border: 1px solid #10b981;">
            <p style="margin: 0; font-size: 11px; color: #059669; text-transform: uppercase;">Statut</p>
            <p style="margin: 4px 0 0 0; font-size: 15px; color: #047857; font-weight: bold;">{{event.status}}</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
  
  <!-- Espacement -->
  <tr><td style="height: 20px;"></td></tr>
  
  <!-- Règle déclenchée -->
  <tr>
    <td style="background-color: #0f172a; padding: 12px 15px; border-radius: 6px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td>
            <p style="margin: 0; font-size: 11px; color: #94a3b8; text-transform: uppercase;">Règle déclenchée</p>
            <p style="margin: 4px 0 0 0; font-size: 14px; color: #F29221; font-weight: bold;">{{rule.name}}</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`,
		},
		{
			ID:        "backup",
			Name:      "Backup",
			IsDefault: true,
			Subject:   "[Backup] {{event.entity}} - {{event.status}}",
			Body: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family: Arial, sans-serif;">
  <!-- Titre -->
  <tr>
    <td style="border-left: 4px solid #F29221; padding: 15px 20px; background-color: #f8fafc;">
      <h1 style="margin: 0; font-size: 20px; color: #0f172a; font-weight: bold;">Backup terminé</h1>
      <p style="margin: 5px 0 0 0; font-size: 14px; color: #64748b;">{{event.entity}} sur {{node.name}}</p>
    </td>
  </tr>
  
  <!-- Espacement -->
  <tr><td style="height: 20px;"></td></tr>
  
  <!-- Statut central -->
  <tr>
    <td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" style="background-color: #ecfdf5; border: 2px solid #10b981; border-radius: 8px; padding: 20px 40px;">
        <tr>
          <td align="center">
            <p style="margin: 0; font-size: 12px; color: #059669; text-transform: uppercase; letter-spacing: 1px;">Résultat</p>
            <p style="margin: 8px 0 0 0; font-size: 28px; color: #047857; font-weight: bold;">{{event.status}}</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
  
  <!-- Espacement -->
  <tr><td style="height: 20px;"></td></tr>
  
  <!-- Informations -->
  <tr>
    <td style="background-color: #f1f5f9; padding: 12px 15px; border-radius: 6px;">
      <p style="margin: 0; font-size: 11px; color: #64748b; text-transform: uppercase;">Cluster</p>
      <p style="margin: 4px 0 0 0; font-size: 15px; color: #0f172a; font-weight: bold;">{{cluster.name}}</p>
    </td>
  </tr>
  <tr><td style="height: 8px;"></td></tr>
  <tr>
    <td style="background-color: #f1f5f9; padding: 12px 15px; border-radius: 6px;">
      <p style="margin: 0; font-size: 11px; color: #64748b; text-transform: uppercase;">Date</p>
      <p style="margin: 4px 0 0 0; font-size: 15px; color: #0f172a; font-weight: bold;">{{event.timestamp}}</p>
    </td>
  </tr>
</table>`,
		},
		{
			ID:        "migration",
			Name:      "Migration",
			IsDefault: true,
			Subject:   "[Migration] {{event.entity}} - {{event.status}}",
			Body: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family: Arial, sans-serif;">
  <!-- Titre -->
  <tr>
    <td style="border-left: 4px solid #F29221; padding: 15px 20px; background-color: #f8fafc;">
      <h1 style="margin: 0; font-size: 20px; color: #0f172a; font-weight: bold;">Migration terminée</h1>
      <p style="margin: 5px 0 0 0; font-size: 14px; color: #64748b;">{{event.entity}}</p>
    </td>
  </tr>
  
  <!-- Espacement -->
  <tr><td style="height: 20px;"></td></tr>
  
  <!-- Visualisation migration -->
  <tr>
    <td>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td width="42%" align="center" style="background-color: #eff6ff; padding: 15px; border-radius: 6px;">
            <p style="margin: 0; font-size: 11px; color: #3b82f6; text-transform: uppercase;">Source</p>
            <p style="margin: 8px 0 0 0; font-size: 16px; color: #1e40af; font-weight: bold;">{{node.name}}</p>
          </td>
          <td width="16%" align="center" style="color: #F29221; font-size: 24px; font-weight: bold;">→</td>
          <td width="42%" align="center" style="background-color: #ecfdf5; padding: 15px; border-radius: 6px;">
            <p style="margin: 0; font-size: 11px; color: #10b981; text-transform: uppercase;">Statut</p>
            <p style="margin: 8px 0 0 0; font-size: 16px; color: #047857; font-weight: bold;">{{event.status}}</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
  
  <!-- Espacement -->
  <tr><td style="height: 20px;"></td></tr>
  
  <!-- Informations -->
  <tr>
    <td style="background-color: #f1f5f9; padding: 12px 15px; border-radius: 6px;">
      <p style="margin: 0; font-size: 11px; color: #64748b; text-transform: uppercase;">Cluster</p>
      <p style="margin: 4px 0 0 0; font-size: 15px; color: #0f172a; font-weight: bold;">{{cluster.name}}</p>
    </td>
  </tr>
  <tr><td style="height: 8px;"></td></tr>
  <tr>
    <td style="background-color: #f1f5f9; padding: 12px 15px; border-radius: 6px;">
      <p style="margin: 0; font-size: 11px; color: #64748b; text-transform: uppercase;">Utilisateur</p>
      <p style="margin: 4px 0 0 0; font-size: 15px; color: #0f172a; font-weight: bold;">{{event.user}}</p>
    </td>
  </tr>
</table>`,
		},
		{
			ID:        "alert",
			Name:      "Alerte système",
			IsDefault: true,
			Subject:   "[{{alert.severity}}] {{rule.name}}",
			Body: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family: Arial, sans-serif;">
  <!-- Alerte avec bordure colorée -->
  <tr>
    <td style="border-left: 4px solid {{alert.severity_color}}; padding: 15px 20px; background-color: #fef2f2;">
      <h1 style="margin: 0; font-size: 20px; color: {{alert.severity_color}}; font-weight: bold;">{{alert.severity_icon}} {{rule.name}}</h1>
      <p style="margin: 8px 0 0 0; font-size: 14px; color: #991b1b;">{{event.message}}</p>
    </td>
  </tr>
  
  <!-- Espacement -->
  <tr><td style="height: 20px;"></td></tr>
  
  <!-- Titre section -->
  <tr>
    <td>
      <p style="margin: 0 0 10px 0; font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 1px; font-weight: bold;">Détails de la ressource</p>
    </td>
  </tr>
  
  <!-- Informations -->
  <tr>
    <td style="background-color: #f1f5f9; padding: 12px 15px; border-radius: 6px;">
      <p style="margin: 0; font-size: 11px; color: #64748b; text-transform: uppercase;">Ressource</p>
      <p style="margin: 4px 0 0 0; font-size: 15px; color: #0f172a; font-weight: bold;">{{event.entity}}</p>
    </td>
  </tr>
  <tr><td style="height: 8px;"></td></tr>
  <tr>
    <td style="background-color: #f1f5f9; padding: 12px 15px; border-radius: 6px;">
      <p style="margin: 0; font-size: 11px; color: #64748b; text-transform: uppercase;">Nœud</p>
      <p style="margin: 4px 0 0 0; font-size: 15px; color: #0f172a; font-weight: bold;">{{node.name}}</p>
    </td>
  </tr>
  <tr><td style="height: 8px;"></td></tr>
  <tr>
    <td style="background-color: #f1f5f9; padding: 12px 15px; border-radius: 6px;">
      <p style="margin: 0; font-size: 11px; color: #64748b; text-transform: uppercase;">Cluster</p>
      <p style="margin: 4px 0 0 0; font-size: 15px; color: #0f172a; font-weight: bold;">{{cluster.name}}</p>
    </td>
  </tr>
</table>`,
		},
	}
}

// TemplateStore gère le stockage des templates
type TemplateStore struct {
	db *gorm.DB
}

// NewTemplateStore crée un nouveau store de templates
func NewTemplateStore(db *gorm.DB) (*TemplateStore, error) {
	// Auto-migrate
	if err := db.AutoMigrate(&EmailTemplate{}); err != nil {
		return nil, fmt.Errorf("failed to migrate email_templates: %w", err)
	}

	store := &TemplateStore{db: db}

	// Insérer les templates par défaut s'ils n'existent pas
	store.ensureDefaults()

	return store, nil
}

// ensureDefaults s'assure que les templates par défaut existent
func (s *TemplateStore) ensureDefaults() {
	defaults := DefaultTemplates()
	for _, tpl := range defaults {
		var existing EmailTemplate
		if err := s.db.First(&existing, "id = ?", tpl.ID).Error; err != nil {
			// N'existe pas, créer
			tpl.CreatedAt = time.Now()
			tpl.UpdatedAt = time.Now()
			s.db.Create(&tpl)
		}
	}
}

// GetAll retourne tous les templates
func (s *TemplateStore) GetAll() ([]EmailTemplate, error) {
	var templates []EmailTemplate
	if err := s.db.Order("name ASC").Find(&templates).Error; err != nil {
		return nil, err
	}
	return templates, nil
}

// Get retourne un template par ID
func (s *TemplateStore) Get(id string) (*EmailTemplate, error) {
	var tpl EmailTemplate
	if err := s.db.First(&tpl, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &tpl, nil
}

// Save crée ou met à jour un template
func (s *TemplateStore) Save(tpl *EmailTemplate) error {
	tpl.UpdatedAt = time.Now()
	
	var existing EmailTemplate
	if err := s.db.First(&existing, "id = ?", tpl.ID).Error; err == nil {
		// Existe, mettre à jour
		return s.db.Model(&existing).Updates(tpl).Error
	}
	
	// N'existe pas, créer
	tpl.CreatedAt = time.Now()
	return s.db.Create(tpl).Error
}

// Delete supprime un template (sauf les défauts)
func (s *TemplateStore) Delete(id string) error {
	return s.db.Delete(&EmailTemplate{}, "id = ? AND is_default = ?", id, false).Error
}

// RenderTemplate remplace les macros dans un template
func RenderTemplate(template string, data *TemplateData) string {
	if template == "" || data == nil {
		return template
	}

	result := template

	// Macro regex: {{category.field}}
	macroRegex := regexp.MustCompile(`\{\{(\w+)\.(\w+)\}\}`)

	result = macroRegex.ReplaceAllStringFunc(result, func(match string) string {
		parts := macroRegex.FindStringSubmatch(match)
		if len(parts) != 3 {
			return match
		}
		category := parts[1]
		field := parts[2]

		switch category {
		case "event":
			switch field {
			case "type":
				return data.Event.Type
			case "type_label":
				return data.Event.TypeLabel
			case "entity":
				return data.Event.Entity
			case "status":
				return data.Event.Status
			case "message":
				return data.Event.Message
			case "user":
				return data.Event.User
			case "timestamp":
				return data.Event.Timestamp
			}
		case "node":
			switch field {
			case "name":
				return data.Node.Name
			case "ip":
				return data.Node.IP
			}
		case "cluster":
			switch field {
			case "name":
				return data.Cluster.Name
			case "id":
				return data.Cluster.ID
			}
		case "alert":
			switch field {
			case "severity":
				return data.Alert.Severity
			case "severity_icon":
				return data.Alert.SeverityIcon
			case "severity_color":
				return data.Alert.SeverityColor
			}
		case "rule":
			switch field {
			case "name":
				return data.Rule.Name
			case "id":
				return data.Rule.ID
			}
		case "app":
			switch field {
			case "name":
				return data.App.Name
			case "url":
				return data.App.URL
			case "version":
				return data.App.Version
			}
		case "date":
			switch field {
			case "now":
				return data.Date.Now
			case "time":
				return data.Date.Time
			}
		case "datacenter":
			return data.Datacenter
		}

		return match // Retourner la macro non résolue si pas trouvée
	})

	// Gérer aussi {{datacenter}} sans sous-champ
	result = strings.ReplaceAll(result, "{{datacenter}}", data.Datacenter)

	return result
}

// BuildTemplateData construit les données de template à partir des données d'événement
func BuildTemplateData(eventData EventNotificationData, severity NotificationSeverity, appName, appURL string) *TemplateData {
	data := &TemplateData{}

	// Event
	data.Event.Type = eventData.Type
	data.Event.TypeLabel = eventData.TypeLabel
	data.Event.Entity = eventData.Entity
	data.Event.Status = eventData.Status
	data.Event.Message = eventData.Message
	data.Event.User = eventData.User
	data.Event.Timestamp = time.Now().Format("02/01/2006 15:04:05")

	// Node
	data.Node.Name = eventData.Node
	data.Node.IP = "" // Pas toujours disponible

	// Cluster
	data.Cluster.Name = eventData.ConnectionName
	data.Cluster.ID = eventData.ConnectionID

	// Alert
	data.Alert.Severity = string(severity)
	data.Alert.SeverityIcon, data.Alert.SeverityColor = getSeverityIconAndColor(severity)

	// Rule
	data.Rule.Name = eventData.RuleName
	data.Rule.ID = eventData.RuleID

	// App
	data.App.Name = appName
	data.App.URL = appURL
	data.App.Version = "1.0.0"

	// Date
	data.Date.Now = time.Now().Format("02/01/2006")
	data.Date.Time = time.Now().Format("15:04:05")

	return data
}

func getSeverityIconAndColor(severity NotificationSeverity) (icon, color string) {
	switch severity {
	case SeverityCritical:
		return "🚨", "#dc2626"
	case SeverityWarning:
		return "⚠️", "#f59e0b"
	case SeveritySuccess:
		return "✅", "#10b981"
	default:
		return "ℹ️", "#3b82f6"
	}
}
