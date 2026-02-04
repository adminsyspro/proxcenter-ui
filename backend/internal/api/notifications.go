package api

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog/log"

	"github.com/proxcenter/orchestrator/internal/config"
	"github.com/proxcenter/orchestrator/internal/notifications"
)

// RegisterNotificationRoutes enregistre les routes de notifications
func (s *Server) RegisterNotificationRoutes(r chi.Router) {
	r.Route("/notifications", func(r chi.Router) {
		// Settings
		r.Get("/settings", s.handleGetNotificationSettings)
		r.Put("/settings", s.handleUpdateNotificationSettings)
		
		// Test
		r.Post("/test", s.handleTestNotification)
		r.Post("/test-connection", s.handleTestSMTPConnection)
		
		// History
		r.Get("/history", s.handleGetNotificationHistory)
		r.Get("/history/{id}", s.handleGetNotification)
		
		// Preview
		r.Post("/preview", s.handlePreviewTemplate)

		// Templates
		r.Get("/templates", s.handleGetEmailTemplates)
		r.Post("/templates", s.handleSaveEmailTemplate)
		r.Get("/templates/{id}", s.handleGetEmailTemplate)
		r.Delete("/templates/{id}", s.handleDeleteEmailTemplate)
	})
}

// NotificationSettingsResponse représente la réponse des paramètres
type NotificationSettingsResponse struct {
	Email struct {
		Enabled          bool     `json:"enabled"`
		SMTPHost         string   `json:"smtp_host"`
		SMTPPort         int      `json:"smtp_port"`
		SMTPUser         string   `json:"smtp_user"`
		SMTPPassword     string   `json:"smtp_password,omitempty"` // Masqué en lecture
		SMTPFrom         string   `json:"smtp_from"`
		SMTPFromName     string   `json:"smtp_from_name"`
		UseTLS           bool     `json:"use_tls"`
		UseStartTLS      bool     `json:"use_starttls"`
		SkipVerify       bool     `json:"skip_verify"`
		DefaultRecipients []string `json:"default_recipients"`
	} `json:"email"`
	
	EnableAlerts      bool   `json:"enable_alerts"`
	EnableMigrations  bool   `json:"enable_migrations"`
	EnableBackups     bool   `json:"enable_backups"`
	EnableMaintenance bool   `json:"enable_maintenance"`
	EnableReports     bool   `json:"enable_reports"`
	MinSeverity       string `json:"min_severity"`
	RateLimitPerHour  int    `json:"rate_limit_per_hour"`
}

func (s *Server) handleGetNotificationSettings(w http.ResponseWriter, r *http.Request) {
	if s.notifications == nil {
		respondError(w, http.StatusServiceUnavailable, "Notification service not available")
		return
	}

	settings := s.notifications.GetSettings()
	
	response := NotificationSettingsResponse{
		EnableAlerts:      settings.EnableAlerts,
		EnableMigrations:  settings.EnableMigrations,
		EnableBackups:     settings.EnableBackups,
		EnableMaintenance: settings.EnableMaintenance,
		EnableReports:     settings.EnableReports,
		MinSeverity:       string(settings.MinSeverity),
		RateLimitPerHour:  settings.RateLimitPerHour,
	}
	
	response.Email.Enabled = settings.Email.Enabled
	response.Email.SMTPHost = settings.Email.SMTPHost
	response.Email.SMTPPort = settings.Email.SMTPPort
	response.Email.SMTPUser = settings.Email.SMTPUser
	response.Email.SMTPPassword = "" // Ne jamais renvoyer le mot de passe
	response.Email.SMTPFrom = settings.Email.SMTPFrom
	response.Email.SMTPFromName = settings.Email.SMTPFromName
	response.Email.UseTLS = settings.Email.UseTLS
	response.Email.UseStartTLS = settings.Email.UseStartTLS
	response.Email.SkipVerify = settings.Email.SkipVerify
	response.Email.DefaultRecipients = settings.Email.DefaultRecipients
	
	if response.Email.DefaultRecipients == nil {
		response.Email.DefaultRecipients = []string{}
	}

	respondJSON(w, http.StatusOK, response)
}

// NotificationSettingsUpdateRequest représente la requête de mise à jour
type NotificationSettingsUpdateRequest struct {
	Email *struct {
		Enabled          *bool     `json:"enabled,omitempty"`
		SMTPHost         *string   `json:"smtp_host,omitempty"`
		SMTPPort         *int      `json:"smtp_port,omitempty"`
		SMTPUser         *string   `json:"smtp_user,omitempty"`
		SMTPPassword     *string   `json:"smtp_password,omitempty"`
		SMTPFrom         *string   `json:"smtp_from,omitempty"`
		SMTPFromName     *string   `json:"smtp_from_name,omitempty"`
		UseTLS           *bool     `json:"use_tls,omitempty"`
		UseStartTLS      *bool     `json:"use_starttls,omitempty"`
		SkipVerify       *bool     `json:"skip_verify,omitempty"`
		DefaultRecipients []string `json:"default_recipients,omitempty"`
	} `json:"email,omitempty"`
	
	EnableAlerts      *bool   `json:"enable_alerts,omitempty"`
	EnableMigrations  *bool   `json:"enable_migrations,omitempty"`
	EnableBackups     *bool   `json:"enable_backups,omitempty"`
	EnableMaintenance *bool   `json:"enable_maintenance,omitempty"`
	EnableReports     *bool   `json:"enable_reports,omitempty"`
	MinSeverity       *string `json:"min_severity,omitempty"`
	RateLimitPerHour  *int    `json:"rate_limit_per_hour,omitempty"`
}

func (s *Server) handleUpdateNotificationSettings(w http.ResponseWriter, r *http.Request) {
	if s.notifications == nil {
		respondError(w, http.StatusServiceUnavailable, "Notification service not available")
		return
	}

	var req NotificationSettingsUpdateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body: "+err.Error())
		return
	}

	// Récupérer les settings actuels
	settings := s.notifications.GetSettings()

	// Appliquer les modifications
	if req.Email != nil {
		if req.Email.Enabled != nil {
			settings.Email.Enabled = *req.Email.Enabled
		}
		if req.Email.SMTPHost != nil {
			settings.Email.SMTPHost = *req.Email.SMTPHost
		}
		if req.Email.SMTPPort != nil {
			settings.Email.SMTPPort = *req.Email.SMTPPort
		}
		if req.Email.SMTPUser != nil {
			settings.Email.SMTPUser = *req.Email.SMTPUser
		}
		if req.Email.SMTPPassword != nil && *req.Email.SMTPPassword != "" {
			settings.Email.SMTPPassword = *req.Email.SMTPPassword
		}
		if req.Email.SMTPFrom != nil {
			settings.Email.SMTPFrom = *req.Email.SMTPFrom
		}
		if req.Email.SMTPFromName != nil {
			settings.Email.SMTPFromName = *req.Email.SMTPFromName
		}
		if req.Email.UseTLS != nil {
			settings.Email.UseTLS = *req.Email.UseTLS
		}
		if req.Email.UseStartTLS != nil {
			settings.Email.UseStartTLS = *req.Email.UseStartTLS
		}
		if req.Email.SkipVerify != nil {
			settings.Email.SkipVerify = *req.Email.SkipVerify
		}
		if req.Email.DefaultRecipients != nil {
			settings.Email.DefaultRecipients = req.Email.DefaultRecipients
		}
	}

	if req.EnableAlerts != nil {
		settings.EnableAlerts = *req.EnableAlerts
	}
	if req.EnableMigrations != nil {
		settings.EnableMigrations = *req.EnableMigrations
	}
	if req.EnableBackups != nil {
		settings.EnableBackups = *req.EnableBackups
	}
	if req.EnableMaintenance != nil {
		settings.EnableMaintenance = *req.EnableMaintenance
	}
	if req.EnableReports != nil {
		settings.EnableReports = *req.EnableReports
	}
	if req.MinSeverity != nil {
		settings.MinSeverity = notifications.NotificationSeverity(*req.MinSeverity)
	}
	if req.RateLimitPerHour != nil {
		settings.RateLimitPerHour = *req.RateLimitPerHour
	}

	// Mettre à jour
	s.notifications.UpdateSettings(settings)

	// Sauvegarder dans config.yaml
	configNotif := config.NotificationsConfig{
		Email: config.EmailConfig{
			Enabled:           settings.Email.Enabled,
			SMTPHost:          settings.Email.SMTPHost,
			SMTPPort:          settings.Email.SMTPPort,
			SMTPUser:          settings.Email.SMTPUser,
			SMTPPassword:      settings.Email.SMTPPassword,
			SMTPFrom:          settings.Email.SMTPFrom,
			SMTPFromName:      settings.Email.SMTPFromName,
			UseTLS:            settings.Email.UseTLS,
			UseStartTLS:       settings.Email.UseStartTLS,
			SkipVerify:        settings.Email.SkipVerify,
			DefaultRecipients: settings.Email.DefaultRecipients,
		},
		EnableAlerts:      settings.EnableAlerts,
		EnableMigrations:  settings.EnableMigrations,
		EnableBackups:     settings.EnableBackups,
		EnableMaintenance: settings.EnableMaintenance,
		EnableReports:     settings.EnableReports,
		MinSeverity:       string(settings.MinSeverity),
		RateLimitPerHour:  settings.RateLimitPerHour,
	}

	if err := config.SaveNotifications(configNotif); err != nil {
		log.Error().Err(err).Msg("Failed to save notification settings to config file")
		// On continue quand même, les settings sont en mémoire
	}

	respondJSON(w, http.StatusOK, map[string]string{"status": "updated"})
}

// TestNotificationRequest représente la requête de test
type TestNotificationRequest struct {
	Recipient string `json:"recipient"`
}

func (s *Server) handleTestNotification(w http.ResponseWriter, r *http.Request) {
	if s.notifications == nil {
		respondError(w, http.StatusServiceUnavailable, "Notification service not available")
		return
	}

	var req TestNotificationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if req.Recipient == "" {
		respondError(w, http.StatusBadRequest, "Recipient email is required")
		return
	}

	// Envoyer l'email de test
	if err := s.notifications.SendTest(r.Context(), req.Recipient); err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to send test email: "+err.Error())
		return
	}

	respondJSON(w, http.StatusOK, map[string]string{
		"status":  "sent",
		"message": "Test email sent to " + req.Recipient,
	})
}

func (s *Server) handleTestSMTPConnection(w http.ResponseWriter, r *http.Request) {
	if s.notifications == nil {
		respondError(w, http.StatusServiceUnavailable, "Notification service not available")
		return
	}

	if err := s.notifications.TestConnection(); err != nil {
		respondJSON(w, http.StatusOK, map[string]interface{}{
			"success": false,
			"error":   err.Error(),
		})
		return
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "SMTP connection successful",
	})
}

func (s *Server) handleGetNotificationHistory(w http.ResponseWriter, r *http.Request) {
	if s.notifications == nil {
		respondError(w, http.StatusServiceUnavailable, "Notification service not available")
		return
	}

	// Pagination
	limit := 20
	offset := 0

	if l := r.URL.Query().Get("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil && parsed > 0 && parsed <= 100 {
			limit = parsed
		}
	}
	if o := r.URL.Query().Get("offset"); o != "" {
		if parsed, err := strconv.Atoi(o); err == nil && parsed >= 0 {
			offset = parsed
		}
	}

	history, total, err := s.notifications.GetHistory(limit, offset)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to get history: "+err.Error())
		return
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"data":   history,
		"total":  total,
		"limit":  limit,
		"offset": offset,
	})
}

func (s *Server) handleGetNotification(w http.ResponseWriter, r *http.Request) {
	if s.notifications == nil {
		respondError(w, http.StatusServiceUnavailable, "Notification service not available")
		return
	}

	id := chi.URLParam(r, "id")
	if id == "" {
		respondError(w, http.StatusBadRequest, "Notification ID is required")
		return
	}

	notification, err := s.notifications.GetNotification(id)
	if err != nil {
		respondError(w, http.StatusNotFound, "Notification not found")
		return
	}

	respondJSON(w, http.StatusOK, notification)
}

// PreviewTemplateRequest représente la requête de prévisualisation
type PreviewTemplateRequest struct {
	Type     string                 `json:"type"`
	Severity string                 `json:"severity"`
	Title    string                 `json:"title"`
	Message  string                 `json:"message"`
	Data     map[string]interface{} `json:"data"`
}

func (s *Server) handlePreviewTemplate(w http.ResponseWriter, r *http.Request) {
	var req PreviewTemplateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	// Pour la preview, on génère juste le HTML sans envoyer
	// Cette fonctionnalité pourrait être étendue pour retourner le HTML rendu
	
	respondJSON(w, http.StatusOK, map[string]string{
		"status":  "ok",
		"message": "Preview functionality - to be implemented in frontend",
	})
}

// ==========================================
// Email Templates
// ==========================================

func (s *Server) handleGetEmailTemplates(w http.ResponseWriter, r *http.Request) {
	if s.notifications == nil {
		respondError(w, http.StatusServiceUnavailable, "Notification service not available")
		return
	}

	templates, err := s.notifications.GetTemplates()
	if err != nil {
		log.Error().Err(err).Msg("Failed to get email templates")
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, templates)
}

func (s *Server) handleGetEmailTemplate(w http.ResponseWriter, r *http.Request) {
	if s.notifications == nil {
		respondError(w, http.StatusServiceUnavailable, "Notification service not available")
		return
	}

	id := chi.URLParam(r, "id")
	
	template, err := s.notifications.GetTemplate(id)
	if err != nil {
		respondError(w, http.StatusNotFound, "Template not found")
		return
	}

	respondJSON(w, http.StatusOK, template)
}

func (s *Server) handleSaveEmailTemplate(w http.ResponseWriter, r *http.Request) {
	if s.notifications == nil {
		respondError(w, http.StatusServiceUnavailable, "Notification service not available")
		return
	}

	var template notifications.EmailTemplate
	if err := json.NewDecoder(r.Body).Decode(&template); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if err := s.notifications.SaveTemplate(&template); err != nil {
		log.Error().Err(err).Msg("Failed to save email template")
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, template)
}

func (s *Server) handleDeleteEmailTemplate(w http.ResponseWriter, r *http.Request) {
	if s.notifications == nil {
		respondError(w, http.StatusServiceUnavailable, "Notification service not available")
		return
	}

	id := chi.URLParam(r, "id")
	
	if err := s.notifications.DeleteTemplate(id); err != nil {
		log.Error().Err(err).Msg("Failed to delete email template")
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
