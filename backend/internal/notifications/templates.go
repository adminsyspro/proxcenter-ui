package notifications

import (
	"bytes"
	"embed"
	"fmt"
	"html/template"
	"strings"
	"time"
)

//go:embed templates/*.html
var templateFS embed.FS

// TemplateManager gère les templates d'email
type TemplateManager struct {
	templates *template.Template
	appName   string
	appURL    string
	logoURL   string
}

// NewTemplateManager crée un nouveau gestionnaire de templates
func NewTemplateManager(appName, appURL, logoURL string) (*TemplateManager, error) {
	// Fonctions personnalisées pour les templates
	funcMap := template.FuncMap{
		"formatTime": func(t time.Time) string {
			return t.Format("02/01/2006 15:04:05")
		},
		"formatDate": func(t time.Time) string {
			return t.Format("02/01/2006")
		},
		"upper": strings.ToUpper,
		"lower": strings.ToLower,
		"title": strings.Title,
		"severityColor": func(s NotificationSeverity) string {
			accent, _ := GetSeverityColors(s)
			return accent
		},
		"severityBg": func(s NotificationSeverity) string {
			_, bg := GetSeverityColors(s)
			return bg
		},
		"severityIcon": GetSeverityIcon,
		"percent": func(v float64) string {
			return fmt.Sprintf("%.1f%%", v)
		},
		"bytes": formatBytes,
		"safeHTML": func(s string) template.HTML {
			return template.HTML(s)
		},
	}

	// Parser les templates embarqués
	tmpl, err := template.New("").Funcs(funcMap).ParseFS(templateFS, "templates/*.html")
	if err != nil {
		return nil, fmt.Errorf("failed to parse templates: %w", err)
	}

	return &TemplateManager{
		templates: tmpl,
		appName:   appName,
		appURL:    appURL,
		logoURL:   logoURL,
	}, nil
}

// formatBytes formate les bytes en format lisible
func formatBytes(b int64) string {
	const unit = 1024
	if b < unit {
		return fmt.Sprintf("%d B", b)
	}
	div, exp := int64(unit), 0
	for n := b / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(b)/float64(div), "KMGTPE"[exp])
}

// RenderNotification rend une notification en HTML et texte
func (tm *TemplateManager) RenderNotification(n *Notification) (html, text string, err error) {
	data := EmailTemplateData{
		Title:     n.Title,
		Message:   n.Message,
		Severity:  n.Severity,
		Type:      n.Type,
		Timestamp: n.CreatedAt,
		Data:      n.Data,
		AppName:   tm.appName,
		AppURL:    tm.appURL,
		LogoURL:   tm.logoURL,
	}
	data.AccentColor, data.BgColor = GetSeverityColors(n.Severity)

	// Choisir le template selon le type
	templateName := tm.getTemplateName(n.Type)

	// Rendre le HTML
	var htmlBuf bytes.Buffer
	if err := tm.templates.ExecuteTemplate(&htmlBuf, templateName, data); err != nil {
		return "", "", fmt.Errorf("failed to render HTML template: %w", err)
	}

	// Générer la version texte
	text = tm.generateTextVersion(n)

	return htmlBuf.String(), text, nil
}

// getTemplateName retourne le nom du template selon le type
func (tm *TemplateManager) getTemplateName(t NotificationType) string {
	switch t {
	case NotificationTypeEvent:
		return "event.html"
	case NotificationTypeMigration:
		return "migration.html"
	case NotificationTypeBackup:
		return "backup.html"
	case NotificationTypeMaintenance:
		return "maintenance.html"
	case NotificationTypeReport:
		return "report.html"
	default:
		return "alert.html"
	}
}

// generateTextVersion génère une version texte de la notification
func (tm *TemplateManager) generateTextVersion(n *Notification) string {
	var sb strings.Builder

	sb.WriteString(fmt.Sprintf("%s - %s\n", tm.appName, n.Title))
	sb.WriteString(strings.Repeat("=", 50))
	sb.WriteString("\n\n")
	sb.WriteString(fmt.Sprintf("Sévérité: %s\n", n.Severity))
	sb.WriteString(fmt.Sprintf("Date: %s\n\n", n.CreatedAt.Format("02/01/2006 15:04:05")))
	sb.WriteString(n.Message)
	sb.WriteString("\n\n")

	// Ajouter les détails selon le type
	if n.Data != nil {
		sb.WriteString("Détails:\n")
		sb.WriteString(strings.Repeat("-", 30))
		sb.WriteString("\n")
		for k, v := range n.Data {
			sb.WriteString(fmt.Sprintf("  %s: %v\n", k, v))
		}
	}

	sb.WriteString("\n")
	sb.WriteString(strings.Repeat("-", 50))
	sb.WriteString("\n")
	sb.WriteString(fmt.Sprintf("Cet email a été envoyé par %s\n", tm.appName))
	if tm.appURL != "" {
		sb.WriteString(tm.appURL)
	}

	return sb.String()
}

// RenderTestEmail rend un email de test
func (tm *TemplateManager) RenderTestEmail(recipient string) (html, text string, err error) {
	n := &Notification{
		Type:     NotificationTypeTest,
		Severity: SeverityInfo,
		Title:    "Test de notification",
		Message:  fmt.Sprintf("Ceci est un email de test envoyé à %s. Si vous recevez cet email, la configuration SMTP est correcte.", recipient),
		Data: map[string]any{
			"test":      true,
			"recipient": recipient,
			"timestamp": time.Now().Format(time.RFC3339),
		},
		CreatedAt: time.Now(),
	}

	return tm.RenderNotification(n)
}
