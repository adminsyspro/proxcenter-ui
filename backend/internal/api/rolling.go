package api

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/proxcenter/orchestrator/internal/license"
	"github.com/proxcenter/orchestrator/internal/rolling"
)

// RegisterRollingUpdateRoutes registers rolling update API routes
func (s *Server) RegisterRollingUpdateRoutes(r chi.Router) {
	r.Route("/rolling-updates", func(r chi.Router) {
		// Apply license middleware for rolling updates feature
		if s.licenseMiddleware != nil {
			r.Use(s.licenseMiddleware.RequireFeature(license.FeatureRollingUpdates))
		}

		r.Get("/", s.handleListRollingUpdates)
		r.Post("/preflight", s.handlePreflightCheck)
		r.Post("/", s.handleStartRollingUpdate)
		r.Get("/active", s.handleGetActiveUpdates)
		r.Get("/{id}", s.handleGetRollingUpdate)
		r.Post("/{id}/pause", s.handlePauseUpdate)
		r.Post("/{id}/resume", s.handleResumeUpdate)
		r.Post("/{id}/cancel", s.handleCancelUpdate)
		r.Post("/{id}/approve", s.handleApproveNode) // For manual approval mode
	})
}

// handlePreflightCheck performs preflight checks before a rolling update
// POST /api/v1/rolling-updates/preflight
func (s *Server) handlePreflightCheck(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ConnectionID string                     `json:"connection_id"`
		Config       rolling.RollingUpdateConfig `json:"config"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body: "+err.Error())
		return
	}

	if req.ConnectionID == "" {
		respondError(w, http.StatusBadRequest, "connection_id is required")
		return
	}

	// Use default config if not provided
	if req.Config.MigrationTimeout == 0 {
		req.Config = rolling.DefaultConfig()
	}

	result, err := s.rolling.PreflightCheck(r.Context(), req.ConnectionID, &req.Config)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Preflight check failed: "+err.Error())
		return
	}

	respondJSON(w, http.StatusOK, result)
}

// handleStartRollingUpdate starts a new rolling update
// POST /api/v1/rolling-updates
func (s *Server) handleStartRollingUpdate(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ConnectionID string                     `json:"connection_id"`
		Config       rolling.RollingUpdateConfig `json:"config"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body: "+err.Error())
		return
	}

	if req.ConnectionID == "" {
		respondError(w, http.StatusBadRequest, "connection_id is required")
		return
	}

	// Use default config values for unset fields
	if req.Config.MigrationTimeout == 0 {
		req.Config.MigrationTimeout = 600
	}
	if req.Config.RebootTimeout == 0 {
		req.Config.RebootTimeout = 300
	}
	if req.Config.MaxConcurrentMigrations == 0 {
		req.Config.MaxConcurrentMigrations = 2
	}
	if req.Config.MinHealthyNodes == 0 {
		req.Config.MinHealthyNodes = 2
	}

	update, err := s.rolling.StartRollingUpdate(r.Context(), req.ConnectionID, &req.Config)
	if err != nil {
		respondError(w, http.StatusBadRequest, "Failed to start rolling update: "+err.Error())
		return
	}

	respondJSON(w, http.StatusCreated, update)
}

// handleGetRollingUpdate returns a specific rolling update
// GET /api/v1/rolling-updates/{id}
func (s *Server) handleGetRollingUpdate(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	update, err := s.rolling.GetUpdate(id)
	if err != nil {
		respondError(w, http.StatusNotFound, "Rolling update not found")
		return
	}

	respondJSON(w, http.StatusOK, update)
}

// handleListRollingUpdates lists rolling updates for a connection
// GET /api/v1/rolling-updates?connection_id=xxx
func (s *Server) handleListRollingUpdates(w http.ResponseWriter, r *http.Request) {
	connectionID := r.URL.Query().Get("connection_id")

	if connectionID == "" {
		// Return all active updates
		updates := s.rolling.GetActiveUpdates()
		respondJSON(w, http.StatusOK, updates)
		return
	}

	updates, err := s.rolling.GetConnectionUpdates(connectionID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to get updates: "+err.Error())
		return
	}

	respondJSON(w, http.StatusOK, updates)
}

// handleGetActiveUpdates returns all active rolling updates
// GET /api/v1/rolling-updates/active
func (s *Server) handleGetActiveUpdates(w http.ResponseWriter, r *http.Request) {
	updates := s.rolling.GetActiveUpdates()
	respondJSON(w, http.StatusOK, updates)
}

// handlePauseUpdate pauses a rolling update
// POST /api/v1/rolling-updates/{id}/pause
func (s *Server) handlePauseUpdate(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	if err := s.rolling.PauseUpdate(id); err != nil {
		respondError(w, http.StatusBadRequest, "Failed to pause update: "+err.Error())
		return
	}

	respondJSON(w, http.StatusOK, map[string]string{
		"status":  "paused",
		"message": "Rolling update paused",
	})
}

// handleResumeUpdate resumes a paused rolling update
// POST /api/v1/rolling-updates/{id}/resume
func (s *Server) handleResumeUpdate(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	if err := s.rolling.ResumeUpdate(id); err != nil {
		respondError(w, http.StatusBadRequest, "Failed to resume update: "+err.Error())
		return
	}

	respondJSON(w, http.StatusOK, map[string]string{
		"status":  "running",
		"message": "Rolling update resumed",
	})
}

// handleCancelUpdate cancels an active rolling update
// POST /api/v1/rolling-updates/{id}/cancel
func (s *Server) handleCancelUpdate(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	if err := s.rolling.CancelUpdate(id); err != nil {
		respondError(w, http.StatusBadRequest, "Failed to cancel update: "+err.Error())
		return
	}

	respondJSON(w, http.StatusOK, map[string]string{
		"status":  "cancelled",
		"message": "Rolling update cancelled",
	})
}

// handleApproveNode approves the next node in manual approval mode
// POST /api/v1/rolling-updates/{id}/approve
func (s *Server) handleApproveNode(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	// Resume is used for both pausing/resuming and manual approval
	if err := s.rolling.ResumeUpdate(id); err != nil {
		respondError(w, http.StatusBadRequest, "Failed to approve: "+err.Error())
		return
	}

	respondJSON(w, http.StatusOK, map[string]string{
		"status":  "approved",
		"message": "Node update approved, proceeding...",
	})
}
