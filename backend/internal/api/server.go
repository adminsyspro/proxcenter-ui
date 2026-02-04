package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/rs/zerolog/log"

	"github.com/proxcenter/orchestrator/internal/alerts"
	"github.com/proxcenter/orchestrator/internal/config"
	"github.com/proxcenter/orchestrator/internal/drs"
	"github.com/proxcenter/orchestrator/internal/firewall"
	"github.com/proxcenter/orchestrator/internal/license"
	"github.com/proxcenter/orchestrator/internal/metrics"
	"github.com/proxcenter/orchestrator/internal/notifications"
	"github.com/proxcenter/orchestrator/internal/proxmox"
	"github.com/proxcenter/orchestrator/internal/reports"
	"github.com/proxcenter/orchestrator/internal/rolling"
	"github.com/proxcenter/orchestrator/internal/storage"
)

// Server represents the API server
type Server struct {
	config            config.APIConfig
	router            *chi.Mux
	server            *http.Server
	pve               *proxmox.Manager
	drs               *drs.Engine
	metrics           *metrics.Collector
	db                *storage.Database
	notifications     *notifications.Service
	alerts            *alerts.Service
	firewall          *firewall.Service
	rolling           *rolling.Service
	reports           *reports.Service
	reportsHandler    *reports.Handler
	licenseValidator  *license.Validator
	licenseHandler    *license.Handler
	licenseMiddleware *license.Middleware
}

// NewServer creates a new API server
func NewServer(cfg config.APIConfig, pve *proxmox.Manager, drs *drs.Engine, metrics *metrics.Collector, db *storage.Database) *Server {
	s := &Server{
		config:   cfg,
		pve:      pve,
		drs:      drs,
		metrics:  metrics,
		db:       db,
		firewall: firewall.NewService(pve),
		rolling:  rolling.NewService(pve, db),
	}

	// Initialize rolling update database table
	if s.rolling != nil {
		s.rolling.InitDB()
	}

	// Note: Router setup is deferred to Start() to allow setting license validator first
	return s
}

// SetNotificationService sets the notification service
func (s *Server) SetNotificationService(svc *notifications.Service) {
	s.notifications = svc
}

// SetAlertService sets the alert service
func (s *Server) SetAlertService(svc *alerts.Service) {
	s.alerts = svc
}

// SetLicenseValidator sets the license validator and initializes related components
func (s *Server) SetLicenseValidator(validator *license.Validator) {
	s.licenseValidator = validator
	s.licenseHandler = license.NewHandler(validator)
	s.licenseMiddleware = license.NewMiddleware(validator)
}

// SetReportsService sets the reports service
func (s *Server) SetReportsService(svc *reports.Service) {
	s.reports = svc
	s.reportsHandler = reports.NewHandler(svc)
}

// setupRouter configures the HTTP router
func (s *Server) setupRouter() {
	r := chi.NewRouter()

	// Middleware
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(60 * time.Second))
	
	// Disable automatic trailing slash redirect (causes 308 issues with fetch API)
	r.Use(middleware.StripSlashes)

	// CORS
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   s.config.CORSOrigins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-API-Key"},
		ExposedHeaders:   []string{"Link"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	// API key authentication (optional)
	if s.config.APIKey != "" {
		r.Use(s.apiKeyAuth)
	}

	// Routes
	r.Route("/api/v1", func(r chi.Router) {
		// Health check
		r.Get("/health", s.handleHealth)

		// License endpoints (always available)
		if s.licenseHandler != nil {
			s.licenseHandler.RegisterRoutes(r)
		}

		// DRS endpoints (enterprise feature)
		r.Route("/drs", func(r chi.Router) {
			// Apply license middleware if available
			if s.licenseMiddleware != nil {
				r.Use(s.licenseMiddleware.RequireFeature(license.FeatureDRS))
			}
			r.Get("/status", s.handleDRSStatus)
			r.Get("/settings", s.handleGetDRSSettings)
			r.Put("/settings", s.handleUpdateDRSSettings)
			r.Get("/recommendations", s.handleGetRecommendations)
			r.Post("/recommendations/{id}/approve", s.handleApproveRecommendation)
			r.Post("/recommendations/{id}/reject", s.handleRejectRecommendation)
			r.Post("/recommendations/{id}/execute", s.handleExecuteRecommendation)
			r.Get("/migrations", s.handleGetMigrations)
			r.Get("/migrations/active", s.handleGetActiveMigrations)
			r.Get("/migrations/{id}/progress", s.handleMigrationProgress)
			r.Post("/evaluate", s.handleTriggerEvaluation)
			// Storage analysis for migration safety
			r.Get("/storage-analysis", s.handleAnalyzeVMStorage)
			r.Get("/check-migration/{vmid}", s.handleCheckMigration)
			// Maintenance mode endpoints
			r.Post("/maintenance/{node}", s.handleEnterMaintenance)
			r.Delete("/maintenance/{node}", s.handleExitMaintenance)
			r.Post("/maintenance/{node}/evacuate", s.handleEvacuateNode)
		})

		// Affinity rules
		r.Route("/rules", func(r chi.Router) {
			r.Get("/", s.handleGetRules)
			r.Post("/", s.handleCreateRule)
			r.Put("/{id}", s.handleUpdateRule)
			r.Delete("/{id}", s.handleDeleteRule)
		})

		// Metrics
		r.Route("/metrics", func(r chi.Router) {
			r.Get("/", s.handleGetMetrics)
			r.Get("/{connectionId}", s.handleGetConnectionMetrics)
			r.Get("/{connectionId}/history", s.handleGetMetricsHistory)
		})

		// Clusters/Connections
		r.Route("/clusters", func(r chi.Router) {
			r.Get("/", s.handleGetClusters)
			r.Get("/{connectionId}/nodes", s.handleGetNodes)
			r.Get("/{connectionId}/vms", s.handleGetVMs)
		})

		// Notifications
		s.RegisterNotificationRoutes(r)

		// Alerts
		s.RegisterAlertRoutes(r)

		// Firewall
		s.RegisterFirewallRoutes(r)

		// Rolling Update
		s.RegisterRollingUpdateRoutes(r)

		// SSH
		s.RegisterSSHRoutes(r)

		// LDAP Authentication
		s.RegisterLDAPRoutes(r)

		// Reports (enterprise feature)
		s.RegisterReportsRoutes(r)
	})

	s.router = r
}

// RegisterReportsRoutes registers report routes
func (s *Server) RegisterReportsRoutes(r chi.Router) {
	if s.reportsHandler == nil {
		return
	}

	r.Group(func(r chi.Router) {
		// Apply license middleware if available
		if s.licenseMiddleware != nil {
			r.Use(s.licenseMiddleware.RequireFeature(license.FeatureReports))
		}
		s.reportsHandler.RegisterRoutes(r)
	})
}

// apiKeyAuth middleware for API key authentication
func (s *Server) apiKeyAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		apiKey := r.Header.Get("X-API-Key")
		if apiKey != s.config.APIKey {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// Start starts the API server
func (s *Server) Start() error {
	// Setup routes now that all services have been configured
	s.setupRouter()

	s.server = &http.Server{
		Addr:         s.config.Address,
		Handler:      s.router,
		ReadTimeout:  s.config.ReadTimeout,
		WriteTimeout: s.config.WriteTimeout,
	}

	log.Info().Str("address", s.config.Address).Msg("Starting API server")
	return s.server.ListenAndServe()
}

// Shutdown gracefully shuts down the server
func (s *Server) Shutdown(ctx context.Context) error {
	return s.server.Shutdown(ctx)
}

// Helper functions

func respondJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func respondError(w http.ResponseWriter, status int, message string) {
	respondJSON(w, status, map[string]string{"error": message})
}

// Handlers

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	// Collect health information from all components
	status := "healthy"
	components := make(map[string]interface{})

	// Check DRS status
	drsConfig := s.drs.GetConfig()
	drsMigrations := s.drs.GetActiveMigrations()
	components["drs"] = map[string]interface{}{
		"enabled":           drsConfig.Enabled,
		"mode":              drsConfig.Mode,
		"active_migrations": len(drsMigrations),
	}

	// Check Proxmox connections
	clients := s.pve.GetAllClients()
	connectedCount := 0
	totalCount := len(clients)
	connectionDetails := make([]map[string]interface{}, 0)

	for id, client := range clients {
		connStatus := "disconnected"
		
		// First check if we have recent metrics (fast path)
		metrics := s.metrics.GetLatestMetrics(id)
		if metrics != nil {
			connStatus = "connected"
			connectedCount++
		} else {
			// No metrics yet - try a quick API call to verify connection
			// Use a short timeout context
			ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
			_, err := client.GetNodes(ctx)
			cancel()
			
			if err == nil {
				connStatus = "connected"
				connectedCount++
			}
		}
		
		connectionDetails = append(connectionDetails, map[string]interface{}{
			"id":     id,
			"status": connStatus,
		})
	}

	components["connections"] = map[string]interface{}{
		"total":     totalCount,
		"connected": connectedCount,
		"details":   connectionDetails,
	}

	// Check alerts
	if s.alerts != nil {
		activeAlerts, err := s.alerts.GetActiveAlerts("")
		if err == nil {
			criticalCount := 0
			warningCount := 0
			for _, alert := range activeAlerts {
				if alert.Severity == "critical" {
					criticalCount++
				} else if alert.Severity == "warning" {
					warningCount++
				}
			}
			components["alerts"] = map[string]interface{}{
				"active":   len(activeAlerts),
				"critical": criticalCount,
				"warning":  warningCount,
			}

			// Degrade status if there are critical alerts
			if criticalCount > 0 {
				status = "degraded"
			}
		}
	}

	// Check database
	if s.db != nil {
		components["database"] = map[string]interface{}{
			"status": "connected",
		}
	}

	// Overall status logic
	if totalCount > 0 && connectedCount == 0 {
		status = "error"
	} else if totalCount > 0 && connectedCount < totalCount {
		status = "degraded"
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"status":     status,
		"time":       time.Now().Format(time.RFC3339),
		"version":    "1.0.0",
		"components": components,
	})
}

func (s *Server) handleDRSStatus(w http.ResponseWriter, r *http.Request) {
	recommendations := s.drs.GetRecommendations()
	migrations := s.drs.GetActiveMigrations()
	cfg := s.drs.GetConfig()

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"enabled":           cfg.Enabled,
		"mode":              cfg.Mode,
		"recommendations":   len(recommendations),
		"active_migrations": len(migrations),
		"pending_count":     countByStatus(recommendations, "pending"),
		"approved_count":    countByStatus(recommendations, "approved"),
	})
}

// DRSSettingsResponse represents the DRS settings for API response
// This structure matches what the frontend expects
type DRSSettingsResponse struct {
	Enabled                 bool     `json:"enabled"`
	Mode                    string   `json:"mode"`
	BalancingMethod         string   `json:"balancing_method"`
	BalancingMode           string   `json:"balancing_mode"`
	BalanceTypes            []string `json:"balance_types"`
	MaintenanceNodes        []string `json:"maintenance_nodes"`
	IgnoreNodes             []string `json:"ignore_nodes"`
	CPUHighThreshold        float64  `json:"cpu_high_threshold"`
	CPULowThreshold         float64  `json:"cpu_low_threshold"`
	MemoryHighThreshold     float64  `json:"memory_high_threshold"`
	MemoryLowThreshold      float64  `json:"memory_low_threshold"`
	StorageHighThreshold    float64  `json:"storage_high_threshold"`
	ImbalanceThreshold      float64  `json:"imbalance_threshold"`
	CPUWeight               float64  `json:"cpu_weight"`
	MemoryWeight            float64  `json:"memory_weight"`
	StorageWeight           float64  `json:"storage_weight"`
	MaxConcurrentMigrations int      `json:"max_concurrent_migrations"`
	MigrationCooldown       string   `json:"migration_cooldown"`
	BalanceLargerFirst      bool     `json:"balance_larger_first"`
	PreventOverprovisioning bool     `json:"prevent_overprovisioning"`
	EnableAffinityRules     bool     `json:"enable_affinity_rules"`
	EnforceAffinity         bool     `json:"enforce_affinity"`
}

func (s *Server) handleGetDRSSettings(w http.ResponseWriter, r *http.Request) {
	cfg := s.drs.GetConfig()

	// Ensure slice fields are never nil (return empty arrays instead)
	balanceTypes := cfg.BalanceTypes
	if balanceTypes == nil {
		balanceTypes = []string{"vm", "ct"}
	}

	maintenanceNodes := cfg.MaintenanceNodes
	if maintenanceNodes == nil {
		maintenanceNodes = []string{}
	}

	ignoreNodes := cfg.IgnoreNodes
	if ignoreNodes == nil {
		ignoreNodes = []string{}
	}

	response := DRSSettingsResponse{
		Enabled:                 cfg.Enabled,
		Mode:                    string(cfg.Mode),
		BalancingMethod:         string(cfg.BalancingMethod),
		BalancingMode:           string(cfg.BalancingMode),
		BalanceTypes:            balanceTypes,
		MaintenanceNodes:        maintenanceNodes,
		IgnoreNodes:             ignoreNodes,
		CPUHighThreshold:        cfg.CPUHighThreshold,
		CPULowThreshold:         cfg.CPULowThreshold,
		MemoryHighThreshold:     cfg.MemoryHighThreshold,
		MemoryLowThreshold:      cfg.MemoryLowThreshold,
		StorageHighThreshold:    cfg.StorageHighThreshold,
		ImbalanceThreshold:      cfg.ImbalanceThreshold,
		CPUWeight:               cfg.CPUWeight,
		MemoryWeight:            cfg.MemoryWeight,
		StorageWeight:           cfg.StorageWeight,
		MaxConcurrentMigrations: cfg.MaxConcurrentMigrations,
		MigrationCooldown:       cfg.MigrationCooldown.String(),
		BalanceLargerFirst:      cfg.BalanceLargerFirst,
		PreventOverprovisioning: cfg.PreventOverprovisioning,
		EnableAffinityRules:     cfg.EnableAffinityRules,
		EnforceAffinity:         cfg.EnforceAffinity,
	}

	respondJSON(w, http.StatusOK, response)
}

// DRSSettingsUpdateRequest represents the update request for DRS settings
type DRSSettingsUpdateRequest struct {
	Enabled                 *bool     `json:"enabled,omitempty"`
	Mode                    *string   `json:"mode,omitempty"`
	BalancingMethod         *string   `json:"balancing_method,omitempty"`
	BalancingMode           *string   `json:"balancing_mode,omitempty"`
	BalanceTypes            []string  `json:"balance_types,omitempty"`
	MaintenanceNodes        []string  `json:"maintenance_nodes,omitempty"`
	IgnoreNodes             []string  `json:"ignore_nodes,omitempty"`
	CPUHighThreshold        *float64  `json:"cpu_high_threshold,omitempty"`
	CPULowThreshold         *float64  `json:"cpu_low_threshold,omitempty"`
	MemoryHighThreshold     *float64  `json:"memory_high_threshold,omitempty"`
	MemoryLowThreshold      *float64  `json:"memory_low_threshold,omitempty"`
	StorageHighThreshold    *float64  `json:"storage_high_threshold,omitempty"`
	ImbalanceThreshold      *float64  `json:"imbalance_threshold,omitempty"`
	CPUWeight               *float64  `json:"cpu_weight,omitempty"`
	MemoryWeight            *float64  `json:"memory_weight,omitempty"`
	StorageWeight           *float64  `json:"storage_weight,omitempty"`
	MaxConcurrentMigrations *int      `json:"max_concurrent_migrations,omitempty"`
	BalanceLargerFirst      *bool     `json:"balance_larger_first,omitempty"`
	PreventOverprovisioning *bool     `json:"prevent_overprovisioning,omitempty"`
	EnableAffinityRules     *bool     `json:"enable_affinity_rules,omitempty"`
	EnforceAffinity         *bool     `json:"enforce_affinity,omitempty"`
}

func (s *Server) handleUpdateDRSSettings(w http.ResponseWriter, r *http.Request) {
	var req DRSSettingsUpdateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}

	// Get current config
	cfg := s.drs.GetConfig()

	// Apply updates (only non-nil values)
	if req.Enabled != nil {
		cfg.Enabled = *req.Enabled
	}
	if req.Mode != nil {
		cfg.Mode = config.DRSMode(*req.Mode)
	}
	if req.BalancingMethod != nil {
		cfg.BalancingMethod = config.BalancingMethod(*req.BalancingMethod)
	}
	if req.BalancingMode != nil {
		cfg.BalancingMode = config.BalancingMode(*req.BalancingMode)
	}
	if req.BalanceTypes != nil {
		cfg.BalanceTypes = req.BalanceTypes
	}
	if req.MaintenanceNodes != nil {
		cfg.MaintenanceNodes = req.MaintenanceNodes
	}
	if req.IgnoreNodes != nil {
		cfg.IgnoreNodes = req.IgnoreNodes
	}
	if req.CPUHighThreshold != nil {
		cfg.CPUHighThreshold = *req.CPUHighThreshold
	}
	if req.CPULowThreshold != nil {
		cfg.CPULowThreshold = *req.CPULowThreshold
	}
	if req.MemoryHighThreshold != nil {
		cfg.MemoryHighThreshold = *req.MemoryHighThreshold
	}
	if req.MemoryLowThreshold != nil {
		cfg.MemoryLowThreshold = *req.MemoryLowThreshold
	}
	if req.StorageHighThreshold != nil {
		cfg.StorageHighThreshold = *req.StorageHighThreshold
	}
	if req.ImbalanceThreshold != nil {
		cfg.ImbalanceThreshold = *req.ImbalanceThreshold
	}
	if req.CPUWeight != nil {
		cfg.CPUWeight = *req.CPUWeight
	}
	if req.MemoryWeight != nil {
		cfg.MemoryWeight = *req.MemoryWeight
	}
	if req.StorageWeight != nil {
		cfg.StorageWeight = *req.StorageWeight
	}
	if req.MaxConcurrentMigrations != nil {
		cfg.MaxConcurrentMigrations = *req.MaxConcurrentMigrations
	}
	if req.BalanceLargerFirst != nil {
		cfg.BalanceLargerFirst = *req.BalanceLargerFirst
	}
	if req.PreventOverprovisioning != nil {
		cfg.PreventOverprovisioning = *req.PreventOverprovisioning
	}
	if req.EnableAffinityRules != nil {
		cfg.EnableAffinityRules = *req.EnableAffinityRules
	}
	if req.EnforceAffinity != nil {
		cfg.EnforceAffinity = *req.EnforceAffinity
	}

	// Update the engine config
	s.drs.UpdateConfig(cfg)

	// Persist to config file
	if err := config.SaveDRS(cfg); err != nil {
		log.Error().Err(err).Msg("Failed to persist DRS settings to file")
		// Continue anyway - settings are applied in memory
	} else {
		log.Info().Msg("DRS settings persisted to config file")
	}

	log.Info().Msg("DRS settings updated via API")

	// Return updated settings
	s.handleGetDRSSettings(w, r)
}

func (s *Server) handleGetRecommendations(w http.ResponseWriter, r *http.Request) {
	// Check if validation is requested
	validate := r.URL.Query().Get("validate") == "true"
	
	recommendations := s.drs.GetRecommendations()
	
	if validate {
		// Validate each recommendation by checking VM locations
		recommendations = s.validateRecommendations(r.Context(), recommendations)
	}
	
	respondJSON(w, http.StatusOK, recommendations)
}

// validateRecommendations checks if VMs are still on expected nodes
func (s *Server) validateRecommendations(ctx context.Context, recommendations []drs.Recommendation) []drs.Recommendation {
	validated := make([]drs.Recommendation, 0, len(recommendations))
	
	for _, rec := range recommendations {
		if rec.Status != "pending" && rec.Status != "approved" {
			validated = append(validated, rec)
			continue
		}
		
		// Get current VM location
		client, err := s.pve.GetClient(rec.ConnectionID)
		if err != nil {
			rec.Status = "error"
			validated = append(validated, rec)
			continue
		}
		
		currentNode, err := client.GetVMNode(ctx, rec.VMID)
		if err != nil {
			// VM might have been deleted
			rec.Status = "stale"
			validated = append(validated, rec)
			continue
		}
		
		if currentNode != rec.SourceNode {
			// VM has moved
			rec.Status = "stale"
			rec.Reason = fmt.Sprintf("VM moved to %s (was on %s)", currentNode, rec.SourceNode)
		} else if currentNode == rec.TargetNode {
			// Already on target
			rec.Status = "completed"
		}
		
		validated = append(validated, rec)
	}
	
	return validated
}

func (s *Server) handleApproveRecommendation(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := s.drs.ApproveRecommendation(id); err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}
	respondJSON(w, http.StatusOK, map[string]string{"status": "approved"})
}

func (s *Server) handleRejectRecommendation(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := s.drs.RejectRecommendation(id); err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}
	respondJSON(w, http.StatusOK, map[string]string{"status": "rejected"})
}

func (s *Server) handleExecuteRecommendation(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	recommendations := s.drs.GetRecommendations()
	var rec *drs.Recommendation
	for i := range recommendations {
		if recommendations[i].ID == id {
			rec = &recommendations[i]
			break
		}
	}

	if rec == nil {
		respondError(w, http.StatusNotFound, "Recommendation not found")
		return
	}

	if err := s.drs.ExecuteMigration(r.Context(), rec); err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, map[string]string{"status": "executing"})
}

func (s *Server) handleGetMigrations(w http.ResponseWriter, r *http.Request) {
	// Get all migrations (not filtered by connection)
	migrations, err := s.db.GetAllMigrations(100)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}
	respondJSON(w, http.StatusOK, migrations)
}

func (s *Server) handleGetActiveMigrations(w http.ResponseWriter, r *http.Request) {
	migrations := s.drs.GetActiveMigrations()
	respondJSON(w, http.StatusOK, migrations)
}

// MigrationProgressResponse represents the progress of a migration
type MigrationProgressResponse struct {
	MigrationID string  `json:"migration_id"`
	VMID        int     `json:"vmid"`
	VMName      string  `json:"vm_name"`
	SourceNode  string  `json:"source_node"`
	TargetNode  string  `json:"target_node"`
	Status      string  `json:"status"`
	Progress    float64 `json:"progress"`
	Message     string  `json:"message"`
	StartedAt   string  `json:"started_at"`
}

func (s *Server) handleMigrationProgress(w http.ResponseWriter, r *http.Request) {
	migrationID := chi.URLParam(r, "id")

	// Get migration from active migrations
	migrations := s.drs.GetActiveMigrations()
	var migration *drs.Migration
	for _, m := range migrations {
		if m.ID == migrationID {
			migration = m
			break
		}
	}

	// If not found in active, try to find in recent migrations from DB
	if migration == nil {
		dbMigrations, err := s.db.GetAllMigrations(50)
		if err == nil {
			for i := range dbMigrations {
				if dbMigrations[i].ID == migrationID {
					// Convert to drs.Migration type for consistency
					migration = &drs.Migration{
						ID:           dbMigrations[i].ID,
						ConnectionID: dbMigrations[i].ConnectionID,
						VMID:         dbMigrations[i].VMID,
						VMName:       dbMigrations[i].VMName,
						SourceNode:   dbMigrations[i].SourceNode,
						TargetNode:   dbMigrations[i].TargetNode,
						TaskID:       dbMigrations[i].TaskID,
						StartedAt:    dbMigrations[i].StartedAt,
						Status:       dbMigrations[i].Status,
					}
					break
				}
			}
		}
	}

	if migration == nil {
		respondError(w, http.StatusNotFound, "Migration not found")
		return
	}

	// If migration is already completed/failed, return stored status
	if migration.Status == "completed" || migration.Status == "failed" {
		response := MigrationProgressResponse{
			MigrationID: migration.ID,
			VMID:        migration.VMID,
			VMName:      migration.VMName,
			SourceNode:  migration.SourceNode,
			TargetNode:  migration.TargetNode,
			Status:      migration.Status,
			Progress:    100,
			Message:     "Migration terminée",
			StartedAt:   migration.StartedAt.Format("2006-01-02T15:04:05Z07:00"),
		}
		if migration.Status == "failed" {
			response.Message = "Migration échouée"
			if migration.Error != "" {
				response.Message = migration.Error
			}
		}
		respondJSON(w, http.StatusOK, response)
		return
	}

	// Get client for this connection
	client, err := s.pve.GetClient(migration.ConnectionID)
	if err != nil {
		respondError(w, http.StatusNotFound, fmt.Sprintf("Connection not found: %s", err.Error()))
		return
	}

	// If no task ID, migration hasn't started properly
	if migration.TaskID == "" {
		respondJSON(w, http.StatusOK, MigrationProgressResponse{
			MigrationID: migration.ID,
			VMID:        migration.VMID,
			VMName:      migration.VMName,
			SourceNode:  migration.SourceNode,
			TargetNode:  migration.TargetNode,
			Status:      "pending",
			Progress:    0,
			Message:     "En attente de démarrage...",
			StartedAt:   migration.StartedAt.Format("2006-01-02T15:04:05Z07:00"),
		})
		return
	}

	// Get task details from Proxmox
	details, err := client.GetTaskDetails(r.Context(), migration.SourceNode, migration.TaskID)
	if err != nil {
		log.Warn().Err(err).Str("migration_id", migrationID).Msg("Failed to get task details")
		// Return what we have
		respondJSON(w, http.StatusOK, MigrationProgressResponse{
			MigrationID: migration.ID,
			VMID:        migration.VMID,
			VMName:      migration.VMName,
			SourceNode:  migration.SourceNode,
			TargetNode:  migration.TargetNode,
			Status:      migration.Status,
			Progress:    0,
			Message:     "Récupération du statut...",
			StartedAt:   migration.StartedAt.Format("2006-01-02T15:04:05Z07:00"),
		})
		return
	}

	response := MigrationProgressResponse{
		MigrationID: migration.ID,
		VMID:        migration.VMID,
		VMName:      migration.VMName,
		SourceNode:  migration.SourceNode,
		TargetNode:  migration.TargetNode,
		Status:      details.Status,
		Progress:    details.Progress,
		Message:     details.Message,
		StartedAt:   migration.StartedAt.Format("2006-01-02T15:04:05Z07:00"),
	}

	respondJSON(w, http.StatusOK, response)
}

func (s *Server) handleTriggerEvaluation(w http.ResponseWriter, r *http.Request) {
	go func() {
		if err := s.drs.Evaluate(context.Background()); err != nil {
			log.Error().Err(err).Msg("Manual DRS evaluation failed")
		}
	}()
	respondJSON(w, http.StatusAccepted, map[string]string{"status": "evaluation_started"})
}

// Storage analysis endpoint

func (s *Server) handleAnalyzeVMStorage(w http.ResponseWriter, r *http.Request) {
	connectionID := r.URL.Query().Get("connection_id")
	node := r.URL.Query().Get("node")
	vmidStr := r.URL.Query().Get("vmid")
	vmName := r.URL.Query().Get("name")
	vmType := r.URL.Query().Get("type") // "qemu" or "lxc"

	if connectionID == "" || node == "" || vmidStr == "" {
		respondError(w, http.StatusBadRequest, "connection_id, node, and vmid are required")
		return
	}

	var vmid int
	if _, err := fmt.Sscanf(vmidStr, "%d", &vmid); err != nil {
		respondError(w, http.StatusBadRequest, "invalid vmid")
		return
	}

	client, err := s.pve.GetClient(connectionID)
	if err != nil {
		respondError(w, http.StatusNotFound, err.Error())
		return
	}

	var analysis *proxmox.VMStorageAnalysis
	if vmType == "lxc" {
		analysis, err = client.AnalyzeLXCStorage(r.Context(), node, vmid, vmName)
	} else {
		analysis, err = client.AnalyzeVMStorage(r.Context(), node, vmid, vmName)
	}

	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, analysis)
}

// Maintenance mode handlers

type MaintenanceRequest struct {
	ConnectionID string `json:"connection_id"`
}

func (s *Server) handleEnterMaintenance(w http.ResponseWriter, r *http.Request) {
	node := chi.URLParam(r, "node")

	var req MaintenanceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}

	if err := s.drs.EnterMaintenanceMode(req.ConnectionID, node); err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, map[string]string{"status": "maintenance_enabled", "node": node})
}

func (s *Server) handleExitMaintenance(w http.ResponseWriter, r *http.Request) {
	node := chi.URLParam(r, "node")
	connectionID := r.URL.Query().Get("connection_id")

	if err := s.drs.ExitMaintenanceMode(connectionID, node); err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, map[string]string{"status": "maintenance_disabled", "node": node})
}

type EvacuateRequest struct {
	ConnectionID string `json:"connection_id"`
	TargetNode   string `json:"target_node,omitempty"`
}

func (s *Server) handleEvacuateNode(w http.ResponseWriter, r *http.Request) {
	node := chi.URLParam(r, "node")

	var req EvacuateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}

	count, err := s.drs.EvacuateNode(r.Context(), req.ConnectionID, node, req.TargetNode)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"status":           "evacuation_started",
		"node":             node,
		"migrations_count": count,
	})
}

// CheckMigrationResponse represents the response for migration check
type CheckMigrationResponse struct {
	CanMigrate      bool               `json:"can_migrate"`
	MigrationSafe   bool               `json:"migration_safe"`
	Reason          string             `json:"reason,omitempty"`
	Warning         string             `json:"warning,omitempty"`
	LocalDisks      []DiskInfo         `json:"local_disks,omitempty"`
	SharedDisks     []DiskInfo         `json:"shared_disks,omitempty"`
	TotalLocalSize  int64              `json:"total_local_size"`
	TotalSharedSize int64              `json:"total_shared_size"`
	EstimatedTime   string             `json:"estimated_time,omitempty"`
	TargetStorage   *TargetStorageInfo `json:"target_storage,omitempty"`
}

type DiskInfo struct {
	Device      string `json:"device"`
	Storage     string `json:"storage"`
	Volume      string `json:"volume"`
	Size        int64  `json:"size"`
	SizeStr     string `json:"size_str,omitempty"`
	IsShared    bool   `json:"is_shared"`
	StorageType string `json:"storage_type,omitempty"`
}

// TargetStorageInfo contains information about the target node's local storage
type TargetStorageInfo struct {
	Storage       string  `json:"storage"`         // storage name (e.g., "local")
	Node          string  `json:"node"`            // target node name
	TotalSize     int64   `json:"total_size"`      // total size in bytes
	UsedSize      int64   `json:"used_size"`       // used space in bytes
	AvailSize     int64   `json:"avail_size"`      // available space in bytes
	UsagePercent  float64 `json:"usage_percent"`   // current usage percentage
	UsedAfter     int64   `json:"used_after"`      // used space after migration
	AvailAfter    int64   `json:"avail_after"`     // available space after migration
	UsageAfterPct float64 `json:"usage_after_pct"` // usage percentage after migration
	WillExceed    bool    `json:"will_exceed"`     // true if migration will exceed capacity
	WarningLevel  string  `json:"warning_level"`   // "ok", "warning", "critical", "full"
}

func (s *Server) handleCheckMigration(w http.ResponseWriter, r *http.Request) {
	vmidStr := chi.URLParam(r, "vmid")
	connectionID := r.URL.Query().Get("connection_id")
	node := r.URL.Query().Get("node")
	targetNode := r.URL.Query().Get("target_node") // Target node for storage check
	vmName := r.URL.Query().Get("name")
	vmType := r.URL.Query().Get("type") // "qemu" or "lxc"

	if connectionID == "" || node == "" {
		respondError(w, http.StatusBadRequest, "connection_id and node query parameters are required")
		return
	}

	var vmid int
	if _, err := fmt.Sscanf(vmidStr, "%d", &vmid); err != nil {
		respondError(w, http.StatusBadRequest, "invalid vmid")
		return
	}

	client, err := s.pve.GetClient(connectionID)
	if err != nil {
		respondError(w, http.StatusNotFound, err.Error())
		return
	}

	// Use the appropriate analysis method based on VM type
	var analysis *proxmox.VMStorageAnalysis
	if vmType == "lxc" {
		analysis, err = client.AnalyzeLXCStorage(r.Context(), node, vmid, vmName)
	} else {
		analysis, err = client.AnalyzeVMStorage(r.Context(), node, vmid, vmName)
	}

	if err != nil {
		log.Error().
			Err(err).
			Str("connection_id", connectionID).
			Str("node", node).
			Int("vmid", vmid).
			Str("type", vmType).
			Msg("Failed to analyze VM storage")
		respondError(w, http.StatusInternalServerError, fmt.Sprintf("Failed to analyze storage for %s %d on %s: %v", vmType, vmid, node, err))
		return
	}

	// Build response
	response := CheckMigrationResponse{
		CanMigrate:      true, // Can always migrate, but with warnings for local disks
		MigrationSafe:   analysis.MigrationSafe,
		TotalLocalSize:  analysis.TotalLocalSize,
		TotalSharedSize: analysis.TotalSharedSize,
	}

	if analysis.HasLocalDisks {
		response.Warning = analysis.MigrationWarning
		// Estimate migration time: ~50MB/s for local disk copy
		if analysis.TotalLocalSize > 0 {
			seconds := analysis.TotalLocalSize / (50 * 1024 * 1024)
			if seconds < 60 {
				response.EstimatedTime = "< 1 minute"
			} else if seconds < 3600 {
				response.EstimatedTime = fmt.Sprintf("%d minutes", seconds/60)
			} else {
				hours := seconds / 3600
				mins := (seconds % 3600) / 60
				response.EstimatedTime = fmt.Sprintf("%dh %dm", hours, mins)
			}
		}

		// Check target node storage if target_node is provided and we have local disks
		if targetNode != "" && analysis.TotalLocalSize > 0 {
			targetStorageInfo := s.checkTargetStorage(r.Context(), client, targetNode, analysis)
			if targetStorageInfo != nil {
				response.TargetStorage = targetStorageInfo
				// Update can_migrate based on target storage capacity
				if targetStorageInfo.WillExceed {
					response.CanMigrate = false
					response.Reason = "Insufficient space on target node"
				}
			}
		}
	} else {
		response.Reason = "All disks are on shared storage - live migration will be fast"
		response.EstimatedTime = "< 1 minute (live migration)"
	}

	// Convert disks to response format
	for _, disk := range analysis.Disks {
		info := DiskInfo{
			Device:      disk.Device,
			Storage:     disk.Storage,
			Volume:      disk.Volume,
			Size:        disk.Size,
			SizeStr:     disk.SizeStr,
			IsShared:    disk.IsShared,
			StorageType: disk.StorageType,
		}
		if disk.IsShared {
			response.SharedDisks = append(response.SharedDisks, info)
		} else {
			response.LocalDisks = append(response.LocalDisks, info)
		}
	}

	respondJSON(w, http.StatusOK, response)
}

// checkTargetStorage checks the available storage on the target node
func (s *Server) checkTargetStorage(ctx context.Context, client *proxmox.Client, targetNode string, analysis *proxmox.VMStorageAnalysis) *TargetStorageInfo {
	// If no local disks, nothing to check
	if analysis.TotalLocalSize == 0 || len(analysis.LocalStorages) == 0 {
		return nil
	}

	// Get the primary local storage name from the source disks
	localStorageName := "local"
	for _, disk := range analysis.Disks {
		if !disk.IsShared {
			localStorageName = disk.Storage
			break
		}
	}

	// Get storage status on target node
	storageStatus, err := client.GetStorageStatus(ctx, targetNode, localStorageName)
	if err != nil {
		log.Warn().Err(err).Str("node", targetNode).Str("storage", localStorageName).Msg("Failed to get target storage status")
		// Return a warning info instead of nil so the UI can show something
		return &TargetStorageInfo{
			Storage:      localStorageName,
			Node:         targetNode,
			WarningLevel: "unknown",
		}
	}

	// Calculate values
	totalSize := storageStatus.Total
	usedSize := storageStatus.Used
	availSize := storageStatus.Avail

	// If Avail is 0 but Total and Used are set, calculate it
	if availSize == 0 && totalSize > 0 {
		availSize = totalSize - usedSize
	}

	usagePercent := 0.0
	if totalSize > 0 {
		usagePercent = float64(usedSize) / float64(totalSize) * 100
	}

	// Calculate after migration
	usedAfter := usedSize + analysis.TotalLocalSize
	availAfter := totalSize - usedAfter
	if availAfter < 0 {
		availAfter = 0
	}

	usageAfterPct := 0.0
	if totalSize > 0 {
		usageAfterPct = float64(usedAfter) / float64(totalSize) * 100
	}

	// Determine warning level
	willExceed := usedAfter > totalSize
	warningLevel := "ok"
	if willExceed {
		warningLevel = "full"
	} else if usageAfterPct >= 90 {
		warningLevel = "critical"
	} else if usageAfterPct >= 80 {
		warningLevel = "warning"
	}

	return &TargetStorageInfo{
		Storage:       localStorageName,
		Node:          targetNode,
		TotalSize:     totalSize,
		UsedSize:      usedSize,
		AvailSize:     availSize,
		UsagePercent:  usagePercent,
		UsedAfter:     usedAfter,
		AvailAfter:    availAfter,
		UsageAfterPct: usageAfterPct,
		WillExceed:    willExceed,
		WarningLevel:  warningLevel,
	}
}

func (s *Server) handleGetRules(w http.ResponseWriter, r *http.Request) {
	rules, err := s.db.GetAllAffinityRules()
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}
	respondJSON(w, http.StatusOK, rules)
}

func (s *Server) handleCreateRule(w http.ResponseWriter, r *http.Request) {
	var rule drs.AffinityRule
	if err := json.NewDecoder(r.Body).Decode(&rule); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}

	if err := s.db.SaveAffinityRule(rule); err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusCreated, rule)
}

func (s *Server) handleUpdateRule(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	var rule drs.AffinityRule
	if err := json.NewDecoder(r.Body).Decode(&rule); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}
	rule.ID = id

	if err := s.db.SaveAffinityRule(rule); err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, rule)
}

func (s *Server) handleDeleteRule(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	if err := s.db.DeleteAffinityRule(id); err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (s *Server) handleGetMetrics(w http.ResponseWriter, r *http.Request) {
	allMetrics := s.metrics.GetAllLatestMetrics()
	respondJSON(w, http.StatusOK, allMetrics)
}

func (s *Server) handleGetConnectionMetrics(w http.ResponseWriter, r *http.Request) {
	connectionID := chi.URLParam(r, "connectionId")

	metrics := s.metrics.GetLatestMetrics(connectionID)
	if metrics == nil {
		respondError(w, http.StatusNotFound, "No metrics found for connection")
		return
	}

	respondJSON(w, http.StatusOK, metrics)
}

func (s *Server) handleGetMetricsHistory(w http.ResponseWriter, r *http.Request) {
	connectionID := chi.URLParam(r, "connectionId")

	// Parse time range from query params
	fromStr := r.URL.Query().Get("from")
	toStr := r.URL.Query().Get("to")

	from := time.Now().Add(-24 * time.Hour) // Default: last 24 hours
	to := time.Now()

	if fromStr != "" {
		if parsed, err := time.Parse(time.RFC3339, fromStr); err == nil {
			from = parsed
		}
	}
	if toStr != "" {
		if parsed, err := time.Parse(time.RFC3339, toStr); err == nil {
			to = parsed
		}
	}

	history, err := s.metrics.GetHistoricalMetrics(connectionID, from, to)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, history)
}

func (s *Server) handleGetClusters(w http.ResponseWriter, r *http.Request) {
	clients := s.pve.GetAllClients()

	clusters := make([]map[string]interface{}, 0)
	for id, client := range clients {
		clusters = append(clusters, map[string]interface{}{
			"id":     id,
			"url":    client.BaseURL,
			"status": "connected",
		})
	}

	respondJSON(w, http.StatusOK, clusters)
}

func (s *Server) handleGetNodes(w http.ResponseWriter, r *http.Request) {
	connectionID := chi.URLParam(r, "connectionId")

	client, err := s.pve.GetClient(connectionID)
	if err != nil {
		respondError(w, http.StatusNotFound, err.Error())
		return
	}

	nodes, err := client.GetNodes(r.Context())
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, nodes)
}

func (s *Server) handleGetVMs(w http.ResponseWriter, r *http.Request) {
	connectionID := chi.URLParam(r, "connectionId")

	client, err := s.pve.GetClient(connectionID)
	if err != nil {
		respondError(w, http.StatusNotFound, err.Error())
		return
	}

	vms, err := client.GetVMs(r.Context())
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, vms)
}

// Helper function to count recommendations by status
func countByStatus(recommendations []drs.Recommendation, status string) int {
	count := 0
	for _, r := range recommendations {
		if r.Status == status {
			count++
		}
	}
	return count
}