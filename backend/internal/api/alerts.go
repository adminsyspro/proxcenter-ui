package api

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/proxcenter/orchestrator/internal/alerts"
)

// RegisterAlertRoutes enregistre les routes pour les alertes
func (s *Server) RegisterAlertRoutes(r chi.Router) {
	r.Route("/alerts", func(r chi.Router) {
		// Alertes
		r.Get("/", s.handleGetAlerts)
		r.Delete("/", s.handleClearAlerts)
		r.Get("/active", s.handleGetActiveAlerts)
		r.Get("/summary", s.handleGetAlertSummary)
		r.Get("/thresholds", s.handleGetThresholds)
		r.Put("/thresholds", s.handleUpdateThresholds)

		// Single alert actions
		r.Get("/{id}", s.handleGetAlert)
		r.Post("/{id}/acknowledge", s.handleAcknowledgeAlert)
		r.Post("/{id}/resolve", s.handleResolveAlert)

		// Event Rules
		r.Get("/rules", s.handleGetEventRules)
		r.Post("/rules", s.handleCreateEventRule)
		r.Get("/rules/{id}", s.handleGetEventRule)
		r.Put("/rules/{id}", s.handleUpdateEventRule)
		r.Delete("/rules/{id}", s.handleDeleteEventRule)
		r.Post("/rules/{id}/toggle", s.handleToggleEventRule)

		// Process events (appelé par le frontend)
		r.Post("/events", s.handleProcessEvents)
	})
}

// ==========================================
// Alertes
// ==========================================

func (s *Server) handleGetAlerts(w http.ResponseWriter, r *http.Request) {
	if s.alerts == nil {
		respondError(w, http.StatusServiceUnavailable, "Alert service not available")
		return
	}

	connectionID := r.URL.Query().Get("connection_id")
	status := alerts.AlertStatus(r.URL.Query().Get("status"))
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))

	if limit <= 0 {
		limit = 100
	}

	alertsList, total, err := s.alerts.GetAllAlerts(connectionID, status, limit, offset)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"data":   alertsList,
		"total":  total,
		"limit":  limit,
		"offset": offset,
	})
}

func (s *Server) handleGetActiveAlerts(w http.ResponseWriter, r *http.Request) {
	if s.alerts == nil {
		respondJSON(w, http.StatusOK, []interface{}{})
		return
	}

	connectionID := r.URL.Query().Get("connection_id")

	alertsList, err := s.alerts.GetActiveAlerts(connectionID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, alertsList)
}

func (s *Server) handleGetAlertSummary(w http.ResponseWriter, r *http.Request) {
	if s.alerts == nil {
		respondJSON(w, http.StatusOK, map[string]int{
			"total_active":   0,
			"critical":       0,
			"warning":        0,
			"info":           0,
			"acknowledged":   0,
			"resolved_today": 0,
		})
		return
	}

	connectionID := r.URL.Query().Get("connection_id")

	summary, err := s.alerts.GetAlertSummary(connectionID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, summary)
}

func (s *Server) handleGetThresholds(w http.ResponseWriter, r *http.Request) {
	if s.alerts == nil {
		respondJSON(w, http.StatusOK, alerts.DefaultThresholds())
		return
	}

	thresholds := s.alerts.GetThresholds()
	respondJSON(w, http.StatusOK, thresholds)
}

func (s *Server) handleUpdateThresholds(w http.ResponseWriter, r *http.Request) {
	if s.alerts == nil {
		respondError(w, http.StatusServiceUnavailable, "Alert service not available")
		return
	}

	var thresholds alerts.AlertThresholds
	if err := json.NewDecoder(r.Body).Decode(&thresholds); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}

	s.alerts.SetThresholds(thresholds)
	respondJSON(w, http.StatusOK, thresholds)
}

func (s *Server) handleClearAlerts(w http.ResponseWriter, r *http.Request) {
	if s.alerts == nil {
		respondError(w, http.StatusServiceUnavailable, "Alert service not available")
		return
	}

	connectionID := r.URL.Query().Get("connection_id")

	if err := s.alerts.ClearAllAlerts(connectionID); err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleGetAlert(w http.ResponseWriter, r *http.Request) {
	if s.alerts == nil {
		respondError(w, http.StatusServiceUnavailable, "Alert service not available")
		return
	}

	alertID := chi.URLParam(r, "id")

	alert, err := s.alerts.GetAlert(alertID)
	if err != nil {
		respondError(w, http.StatusNotFound, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, alert)
}

func (s *Server) handleAcknowledgeAlert(w http.ResponseWriter, r *http.Request) {
	if s.alerts == nil {
		respondError(w, http.StatusServiceUnavailable, "Alert service not available")
		return
	}

	alertID := chi.URLParam(r, "id")

	var body struct {
		AcknowledgedBy string `json:"acknowledged_by"`
	}
	json.NewDecoder(r.Body).Decode(&body)

	if body.AcknowledgedBy == "" {
		body.AcknowledgedBy = "unknown"
	}

	if err := s.alerts.AcknowledgeAlert(alertID, body.AcknowledgedBy); err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleResolveAlert(w http.ResponseWriter, r *http.Request) {
	if s.alerts == nil {
		respondError(w, http.StatusServiceUnavailable, "Alert service not available")
		return
	}

	alertID := chi.URLParam(r, "id")

	if err := s.alerts.ResolveAlertManually(alertID); err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// ==========================================
// Event Rules
// ==========================================

func (s *Server) handleGetEventRules(w http.ResponseWriter, r *http.Request) {
	if s.alerts == nil {
		respondJSON(w, http.StatusOK, []interface{}{})
		return
	}

	rules, err := s.alerts.GetEventRules()
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, rules)
}

func (s *Server) handleCreateEventRule(w http.ResponseWriter, r *http.Request) {
	if s.alerts == nil {
		respondError(w, http.StatusServiceUnavailable, "Alert service not available")
		return
	}

	var rule alerts.EventRule
	if err := json.NewDecoder(r.Body).Decode(&rule); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}

	if err := s.alerts.CreateEventRule(&rule); err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusCreated, rule)
}

func (s *Server) handleGetEventRule(w http.ResponseWriter, r *http.Request) {
	if s.alerts == nil {
		respondError(w, http.StatusServiceUnavailable, "Alert service not available")
		return
	}

	ruleID := chi.URLParam(r, "id")

	rule, err := s.alerts.GetEventRule(ruleID)
	if err != nil {
		respondError(w, http.StatusNotFound, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, rule)
}

func (s *Server) handleUpdateEventRule(w http.ResponseWriter, r *http.Request) {
	if s.alerts == nil {
		respondError(w, http.StatusServiceUnavailable, "Alert service not available")
		return
	}

	ruleID := chi.URLParam(r, "id")

	var rule alerts.EventRule
	if err := json.NewDecoder(r.Body).Decode(&rule); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}

	if err := s.alerts.UpdateEventRule(ruleID, &rule); err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleDeleteEventRule(w http.ResponseWriter, r *http.Request) {
	if s.alerts == nil {
		respondError(w, http.StatusServiceUnavailable, "Alert service not available")
		return
	}

	ruleID := chi.URLParam(r, "id")

	if err := s.alerts.DeleteEventRule(ruleID); err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleToggleEventRule(w http.ResponseWriter, r *http.Request) {
	if s.alerts == nil {
		respondError(w, http.StatusServiceUnavailable, "Alert service not available")
		return
	}

	ruleID := chi.URLParam(r, "id")

	if err := s.alerts.ToggleEventRule(ruleID); err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// ==========================================
// Process Events
// ==========================================

func (s *Server) handleProcessEvents(w http.ResponseWriter, r *http.Request) {
	if s.alerts == nil {
		respondJSON(w, http.StatusOK, map[string]interface{}{
			"status": "skipped",
			"reason": "alert service not available",
		})
		return
	}

	var events []alerts.ProxmoxEvent
	if err := json.NewDecoder(r.Body).Decode(&events); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}

	if err := s.alerts.ProcessEvents(events); err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"status":    "ok",
		"processed": len(events),
	})
}