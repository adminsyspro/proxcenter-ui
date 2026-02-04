package license

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog/log"
)

// Handler provides HTTP handlers for license management
type Handler struct {
	validator *Validator
}

// NewHandler creates a new license handler
func NewHandler(validator *Validator) *Handler {
	return &Handler{
		validator: validator,
	}
}

// RegisterRoutes registers license routes on the router
func (h *Handler) RegisterRoutes(r chi.Router) {
	r.Route("/license", func(r chi.Router) {
		r.Get("/status", h.handleGetStatus)
		r.Post("/activate", h.handleActivate)
		r.Delete("/deactivate", h.handleDeactivate)
		r.Get("/features", h.handleGetFeatures)
	})
}

// handleGetStatus returns the current license status
func (h *Handler) handleGetStatus(w http.ResponseWriter, r *http.Request) {
	status := h.validator.GetStatus()
	respondJSON(w, http.StatusOK, status)
}

// handleActivate activates a new license
func (h *Handler) handleActivate(w http.ResponseWriter, r *http.Request) {
	var req ActivateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondJSON(w, http.StatusBadRequest, ActivateResponse{
			Success: false,
			Error:   "Invalid request body",
		})
		return
	}

	if req.License == "" {
		respondJSON(w, http.StatusBadRequest, ActivateResponse{
			Success: false,
			Error:   "License content is required",
		})
		return
	}

	license, err := h.validator.Activate(req.License)
	if err != nil {
		log.Warn().Err(err).Msg("License activation failed")
		respondJSON(w, http.StatusBadRequest, ActivateResponse{
			Success: false,
			Error:   err.Error(),
		})
		return
	}

	log.Info().
		Str("license_id", license.Payload.LicenseID).
		Str("edition", string(license.Payload.Edition)).
		Str("customer", license.Payload.Customer.Name).
		Msg("License activated successfully")

	respondJSON(w, http.StatusOK, ActivateResponse{
		Success: true,
		Status:  license.ToStatus(),
	})
}

// handleDeactivate removes the current license
func (h *Handler) handleDeactivate(w http.ResponseWriter, r *http.Request) {
	currentLicense := h.validator.GetLicense()
	if currentLicense != nil {
		log.Info().
			Str("license_id", currentLicense.Payload.LicenseID).
			Msg("Deactivating license")
	}

	if err := h.validator.Deactivate(); err != nil {
		log.Error().Err(err).Msg("Failed to deactivate license")
		respondJSON(w, http.StatusInternalServerError, map[string]interface{}{
			"success": false,
			"error":   err.Error(),
		})
		return
	}

	log.Info().Msg("License deactivated successfully")
	respondJSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"status":  h.validator.GetStatus(),
	})
}

// FeatureInfo represents information about a feature
type FeatureInfo struct {
	ID          Feature `json:"id"`
	Name        string  `json:"name"`
	Description string  `json:"description"`
	Enabled     bool    `json:"enabled"`
}

// FeaturesResponse is the response for the features endpoint
type FeaturesResponse struct {
	Edition  Edition       `json:"edition"`
	Features []FeatureInfo `json:"features"`
}

// handleGetFeatures returns all features and their current status
func (h *Handler) handleGetFeatures(w http.ResponseWriter, r *http.Request) {
	status := h.validator.GetStatus()

	// Define all features with their metadata
	allFeatures := []FeatureInfo{
		{
			ID:          FeatureDRS,
			Name:        "DRS (Distributed Resource Scheduler)",
			Description: "Automatic VM load balancing and resource optimization",
			Enabled:     h.validator.HasFeature(FeatureDRS),
		},
		{
			ID:          FeatureFirewall,
			Name:        "Firewall Management",
			Description: "Centralized firewall rule management across clusters",
			Enabled:     h.validator.HasFeature(FeatureFirewall),
		},
		{
			ID:          FeatureMicrosegmentation,
			Name:        "Microsegmentation",
			Description: "Fine-grained network segmentation for VMs",
			Enabled:     h.validator.HasFeature(FeatureMicrosegmentation),
		},
		{
			ID:          FeatureRollingUpdates,
			Name:        "Rolling Updates",
			Description: "Automated rolling updates for cluster nodes",
			Enabled:     h.validator.HasFeature(FeatureRollingUpdates),
		},
		{
			ID:          FeatureAIInsights,
			Name:        "AI Insights",
			Description: "AI-powered recommendations and anomaly detection",
			Enabled:     h.validator.HasFeature(FeatureAIInsights),
		},
		{
			ID:          FeaturePredictiveAlerts,
			Name:        "Predictive Alerts",
			Description: "Predictive alerting based on trend analysis",
			Enabled:     h.validator.HasFeature(FeaturePredictiveAlerts),
		},
		{
			ID:          FeatureGreenMetrics,
			Name:        "Green Metrics",
			Description: "Energy consumption and carbon footprint tracking",
			Enabled:     h.validator.HasFeature(FeatureGreenMetrics),
		},
		{
			ID:          FeatureCrossClusterMigration,
			Name:        "Cross-Cluster Migration",
			Description: "VM migration between different Proxmox clusters",
			Enabled:     h.validator.HasFeature(FeatureCrossClusterMigration),
		},
		{
			ID:          FeatureCephReplication,
			Name:        "Ceph Replication",
			Description: "Automated Ceph storage replication management",
			Enabled:     h.validator.HasFeature(FeatureCephReplication),
		},
		{
			ID:          FeatureLDAP,
			Name:        "LDAP / Active Directory",
			Description: "LDAP and Active Directory authentication integration",
			Enabled:     h.validator.HasFeature(FeatureLDAP),
		},
		{
			ID:          FeatureReports,
			Name:        "PDF Reports",
			Description: "Generate and schedule PDF reports for infrastructure, alerts, and utilization",
			Enabled:     h.validator.HasFeature(FeatureReports),
		},
	}

	respondJSON(w, http.StatusOK, FeaturesResponse{
		Edition:  status.Edition,
		Features: allFeatures,
	})
}

// Helper function
func respondJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}
