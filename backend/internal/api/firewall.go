package api

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/proxcenter/orchestrator/internal/firewall"
	"github.com/proxcenter/orchestrator/internal/license"
)

// RegisterFirewallRoutes registers firewall API routes
func (s *Server) RegisterFirewallRoutes(r chi.Router) {
	r.Route("/firewall", func(r chi.Router) {
		// Apply license middleware for firewall feature
		if s.licenseMiddleware != nil {
			r.Use(s.licenseMiddleware.RequireFeature(license.FeatureFirewall))
		}

		// Status
		r.Get("/status/{connectionId}", s.handleFirewallStatus)
		r.Get("/macros/{connectionId}", s.handleGetMacros)

		// Aliases
		r.Get("/aliases/{connectionId}", s.handleGetAliases)
		r.Post("/aliases/{connectionId}", s.handleCreateAlias)
		r.Put("/aliases/{connectionId}/{name}", s.handleUpdateAlias)
		r.Delete("/aliases/{connectionId}/{name}", s.handleDeleteAlias)

		// IP Sets
		r.Get("/ipsets/{connectionId}", s.handleGetIPSets)
		r.Post("/ipsets/{connectionId}", s.handleCreateIPSet)
		r.Delete("/ipsets/{connectionId}/{name}", s.handleDeleteIPSet)
		r.Post("/ipsets/{connectionId}/{name}/entries", s.handleAddIPSetEntry)
		r.Delete("/ipsets/{connectionId}/{name}/entries/{cidr}", s.handleDeleteIPSetEntry)

		// Security Groups
		r.Get("/groups/{connectionId}", s.handleGetSecurityGroups)
		r.Post("/groups/{connectionId}", s.handleCreateSecurityGroup)
		r.Delete("/groups/{connectionId}/{name}", s.handleDeleteSecurityGroup)
		r.Post("/groups/{connectionId}/{name}/rules", s.handleAddSecurityGroupRule)
		r.Put("/groups/{connectionId}/{name}/rules/{pos}", s.handleUpdateSecurityGroupRule)
		r.Delete("/groups/{connectionId}/{name}/rules/{pos}", s.handleDeleteSecurityGroupRule)

		// Cluster-level rules & options
		r.Get("/cluster/{connectionId}/rules", s.handleGetClusterRules)
		r.Post("/cluster/{connectionId}/rules", s.handleAddClusterRule)
		r.Get("/cluster/{connectionId}/options", s.handleGetClusterOptions)
		r.Put("/cluster/{connectionId}/options", s.handleUpdateClusterOptions)

		// Node-level firewall
		r.Get("/nodes/{connectionId}/{node}/options", s.handleGetNodeOptions)
		r.Put("/nodes/{connectionId}/{node}/options", s.handleUpdateNodeOptions)
		r.Get("/nodes/{connectionId}/{node}/rules", s.handleGetNodeRules)
		r.Post("/nodes/{connectionId}/{node}/rules", s.handleAddNodeRule)

		// VM/CT-level firewall
		r.Get("/vms/{connectionId}/{node}/{vmType}/{vmid}/options", s.handleGetVMOptions)
		r.Put("/vms/{connectionId}/{node}/{vmType}/{vmid}/options", s.handleUpdateVMOptions)
		r.Get("/vms/{connectionId}/{node}/{vmType}/{vmid}/rules", s.handleGetVMRules)
		r.Post("/vms/{connectionId}/{node}/{vmType}/{vmid}/rules", s.handleAddVMRule)
		r.Put("/vms/{connectionId}/{node}/{vmType}/{vmid}/rules/{pos}", s.handleUpdateVMRule)
		r.Delete("/vms/{connectionId}/{node}/{vmType}/{vmid}/rules/{pos}", s.handleDeleteVMRule)
		r.Get("/vms/{connectionId}/{node}/{vmType}/{vmid}/log", s.handleGetVMFirewallLog)

		// Micro-segmentation
		r.Get("/microseg/{connectionId}/analyze", s.handleAnalyzeMicroseg)
		r.Post("/microseg/{connectionId}/generate-base", s.handleGenerateBaseSGs)
		r.Get("/microseg/{connectionId}/vms", s.handleListVMsForSegmentation)
		r.Get("/microseg/{connectionId}/vm/{node}/{vmType}/{vmid}", s.handleGetVMSegmentationStatus)
		r.Get("/microseg/{connectionId}/vm/{node}/{vmType}/{vmid}/simulate", s.handleSimulateIsolation)
		r.Post("/microseg/{connectionId}/vm/{node}/{vmType}/{vmid}/isolate", s.handleIsolateVM)
	})
}

// ================================================================================
// STATUS & MACROS
// ================================================================================

func (s *Server) handleFirewallStatus(w http.ResponseWriter, r *http.Request) {
	connectionID := chi.URLParam(r, "connectionId")

	status, err := s.firewall.GetFirewallStatus(r.Context(), connectionID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, status)
}

func (s *Server) handleGetMacros(w http.ResponseWriter, r *http.Request) {
	connectionID := chi.URLParam(r, "connectionId")

	macros, err := s.firewall.GetMacros(r.Context(), connectionID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, macros)
}

// ================================================================================
// ALIASES
// ================================================================================

func (s *Server) handleGetAliases(w http.ResponseWriter, r *http.Request) {
	connectionID := chi.URLParam(r, "connectionId")

	aliases, err := s.firewall.GetAliases(r.Context(), connectionID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, aliases)
}

func (s *Server) handleCreateAlias(w http.ResponseWriter, r *http.Request) {
	connectionID := chi.URLParam(r, "connectionId")

	var req firewall.CreateAliasRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}

	if err := s.firewall.CreateAlias(r.Context(), connectionID, req); err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusCreated, map[string]string{"status": "created"})
}

func (s *Server) handleDeleteAlias(w http.ResponseWriter, r *http.Request) {
	connectionID := chi.URLParam(r, "connectionId")
	name := chi.URLParam(r, "name")

	if err := s.firewall.DeleteAlias(r.Context(), connectionID, name); err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (s *Server) handleUpdateAlias(w http.ResponseWriter, r *http.Request) {
	connectionID := chi.URLParam(r, "connectionId")
	name := chi.URLParam(r, "name")

	var req firewall.UpdateAliasRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}

	if err := s.firewall.UpdateAlias(r.Context(), connectionID, name, req); err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, map[string]string{"status": "updated"})
}

// ================================================================================
// IP SETS
// ================================================================================

func (s *Server) handleGetIPSets(w http.ResponseWriter, r *http.Request) {
	connectionID := chi.URLParam(r, "connectionId")

	ipsets, err := s.firewall.GetIPSets(r.Context(), connectionID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, ipsets)
}

func (s *Server) handleCreateIPSet(w http.ResponseWriter, r *http.Request) {
	connectionID := chi.URLParam(r, "connectionId")

	var req firewall.CreateIPSetRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}

	if err := s.firewall.CreateIPSet(r.Context(), connectionID, req); err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusCreated, map[string]string{"status": "created"})
}

func (s *Server) handleDeleteIPSet(w http.ResponseWriter, r *http.Request) {
	connectionID := chi.URLParam(r, "connectionId")
	name := chi.URLParam(r, "name")

	if err := s.firewall.DeleteIPSet(r.Context(), connectionID, name); err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (s *Server) handleAddIPSetEntry(w http.ResponseWriter, r *http.Request) {
	connectionID := chi.URLParam(r, "connectionId")
	name := chi.URLParam(r, "name")

	var req firewall.AddIPSetEntryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}

	if err := s.firewall.AddIPSetEntry(r.Context(), connectionID, name, req); err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusCreated, map[string]string{"status": "created"})
}

func (s *Server) handleDeleteIPSetEntry(w http.ResponseWriter, r *http.Request) {
	connectionID := chi.URLParam(r, "connectionId")
	name := chi.URLParam(r, "name")
	cidr := chi.URLParam(r, "cidr")

	if err := s.firewall.DeleteIPSetEntry(r.Context(), connectionID, name, cidr); err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// ================================================================================
// SECURITY GROUPS
// ================================================================================

func (s *Server) handleGetSecurityGroups(w http.ResponseWriter, r *http.Request) {
	connectionID := chi.URLParam(r, "connectionId")

	groups, err := s.firewall.GetSecurityGroups(r.Context(), connectionID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, groups)
}

func (s *Server) handleCreateSecurityGroup(w http.ResponseWriter, r *http.Request) {
	connectionID := chi.URLParam(r, "connectionId")

	var req firewall.CreateSecurityGroupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}

	if err := s.firewall.CreateSecurityGroup(r.Context(), connectionID, req); err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusCreated, map[string]string{"status": "created"})
}

func (s *Server) handleDeleteSecurityGroup(w http.ResponseWriter, r *http.Request) {
	connectionID := chi.URLParam(r, "connectionId")
	name := chi.URLParam(r, "name")

	if err := s.firewall.DeleteSecurityGroup(r.Context(), connectionID, name); err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (s *Server) handleAddSecurityGroupRule(w http.ResponseWriter, r *http.Request) {
	connectionID := chi.URLParam(r, "connectionId")
	name := chi.URLParam(r, "name")

	var req firewall.CreateRuleRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}

	if err := s.firewall.AddSecurityGroupRule(r.Context(), connectionID, name, req); err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusCreated, map[string]string{"status": "created"})
}

func (s *Server) handleDeleteSecurityGroupRule(w http.ResponseWriter, r *http.Request) {
	connectionID := chi.URLParam(r, "connectionId")
	name := chi.URLParam(r, "name")
	posStr := chi.URLParam(r, "pos")

	pos, err := strconv.Atoi(posStr)
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid position")
		return
	}

	if err := s.firewall.DeleteSecurityGroupRule(r.Context(), connectionID, name, pos); err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (s *Server) handleUpdateSecurityGroupRule(w http.ResponseWriter, r *http.Request) {
	connectionID := chi.URLParam(r, "connectionId")
	name := chi.URLParam(r, "name")
	posStr := chi.URLParam(r, "pos")

	pos, err := strconv.Atoi(posStr)
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid position")
		return
	}

	var req firewall.UpdateRuleRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}

	if err := s.firewall.UpdateSecurityGroupRule(r.Context(), connectionID, name, pos, req); err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, map[string]string{"status": "updated"})
}

// ================================================================================
// CLUSTER-LEVEL
// ================================================================================

func (s *Server) handleGetClusterRules(w http.ResponseWriter, r *http.Request) {
	connectionID := chi.URLParam(r, "connectionId")

	rules, err := s.firewall.GetClusterRules(r.Context(), connectionID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, rules)
}

func (s *Server) handleAddClusterRule(w http.ResponseWriter, r *http.Request) {
	connectionID := chi.URLParam(r, "connectionId")

	var req firewall.CreateRuleRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}

	if err := s.firewall.AddClusterRule(r.Context(), connectionID, req); err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusCreated, map[string]string{"status": "created"})
}

func (s *Server) handleGetClusterOptions(w http.ResponseWriter, r *http.Request) {
	connectionID := chi.URLParam(r, "connectionId")

	options, err := s.firewall.GetClusterOptions(r.Context(), connectionID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, options)
}

func (s *Server) handleUpdateClusterOptions(w http.ResponseWriter, r *http.Request) {
	connectionID := chi.URLParam(r, "connectionId")

	var req firewall.UpdateOptionsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}

	if err := s.firewall.UpdateClusterOptions(r.Context(), connectionID, req); err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, map[string]string{"status": "updated"})
}

// ================================================================================
// NODE-LEVEL
// ================================================================================

func (s *Server) handleGetNodeOptions(w http.ResponseWriter, r *http.Request) {
	connectionID := chi.URLParam(r, "connectionId")
	node := chi.URLParam(r, "node")

	options, err := s.firewall.GetNodeOptions(r.Context(), connectionID, node)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, options)
}

func (s *Server) handleUpdateNodeOptions(w http.ResponseWriter, r *http.Request) {
	connectionID := chi.URLParam(r, "connectionId")
	node := chi.URLParam(r, "node")

	var req firewall.UpdateOptionsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}

	if err := s.firewall.UpdateNodeOptions(r.Context(), connectionID, node, req); err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, map[string]string{"status": "updated"})
}

func (s *Server) handleGetNodeRules(w http.ResponseWriter, r *http.Request) {
	connectionID := chi.URLParam(r, "connectionId")
	node := chi.URLParam(r, "node")

	rules, err := s.firewall.GetNodeRules(r.Context(), connectionID, node)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, rules)
}

func (s *Server) handleAddNodeRule(w http.ResponseWriter, r *http.Request) {
	connectionID := chi.URLParam(r, "connectionId")
	node := chi.URLParam(r, "node")

	var req firewall.CreateRuleRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}

	if err := s.firewall.AddNodeRule(r.Context(), connectionID, node, req); err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusCreated, map[string]string{"status": "created"})
}

// ================================================================================
// VM/CT-LEVEL
// ================================================================================

func (s *Server) handleGetVMOptions(w http.ResponseWriter, r *http.Request) {
	connectionID := chi.URLParam(r, "connectionId")
	node := chi.URLParam(r, "node")
	vmType := chi.URLParam(r, "vmType")
	vmidStr := chi.URLParam(r, "vmid")

	vmid, err := strconv.Atoi(vmidStr)
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid vmid")
		return
	}

	options, err := s.firewall.GetVMOptions(r.Context(), connectionID, node, vmid, vmType)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, options)
}

func (s *Server) handleUpdateVMOptions(w http.ResponseWriter, r *http.Request) {
	connectionID := chi.URLParam(r, "connectionId")
	node := chi.URLParam(r, "node")
	vmType := chi.URLParam(r, "vmType")
	vmidStr := chi.URLParam(r, "vmid")

	vmid, err := strconv.Atoi(vmidStr)
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid vmid")
		return
	}

	var req firewall.UpdateOptionsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}

	if err := s.firewall.UpdateVMOptions(r.Context(), connectionID, node, vmid, vmType, req); err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, map[string]string{"status": "updated"})
}

func (s *Server) handleGetVMRules(w http.ResponseWriter, r *http.Request) {
	connectionID := chi.URLParam(r, "connectionId")
	node := chi.URLParam(r, "node")
	vmType := chi.URLParam(r, "vmType")
	vmidStr := chi.URLParam(r, "vmid")

	vmid, err := strconv.Atoi(vmidStr)
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid vmid")
		return
	}

	rules, err := s.firewall.GetVMRules(r.Context(), connectionID, node, vmid, vmType)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, rules)
}

func (s *Server) handleAddVMRule(w http.ResponseWriter, r *http.Request) {
	connectionID := chi.URLParam(r, "connectionId")
	node := chi.URLParam(r, "node")
	vmType := chi.URLParam(r, "vmType")
	vmidStr := chi.URLParam(r, "vmid")

	vmid, err := strconv.Atoi(vmidStr)
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid vmid")
		return
	}

	var req firewall.CreateRuleRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}

	if err := s.firewall.AddVMRule(r.Context(), connectionID, node, vmid, vmType, req); err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusCreated, map[string]string{"status": "created"})
}

func (s *Server) handleDeleteVMRule(w http.ResponseWriter, r *http.Request) {
	connectionID := chi.URLParam(r, "connectionId")
	node := chi.URLParam(r, "node")
	vmType := chi.URLParam(r, "vmType")
	vmidStr := chi.URLParam(r, "vmid")
	posStr := chi.URLParam(r, "pos")

	vmid, err := strconv.Atoi(vmidStr)
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid vmid")
		return
	}

	pos, err := strconv.Atoi(posStr)
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid position")
		return
	}

	if err := s.firewall.DeleteVMRule(r.Context(), connectionID, node, vmid, vmType, pos); err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (s *Server) handleUpdateVMRule(w http.ResponseWriter, r *http.Request) {
	connectionID := chi.URLParam(r, "connectionId")
	node := chi.URLParam(r, "node")
	vmType := chi.URLParam(r, "vmType")
	vmidStr := chi.URLParam(r, "vmid")
	posStr := chi.URLParam(r, "pos")

	vmid, err := strconv.Atoi(vmidStr)
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid vmid")
		return
	}

	pos, err := strconv.Atoi(posStr)
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid position")
		return
	}

	var req firewall.UpdateRuleRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}

	if err := s.firewall.UpdateVMRule(r.Context(), connectionID, node, vmid, vmType, pos, req); err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, map[string]string{"status": "updated"})
}

func (s *Server) handleGetVMFirewallLog(w http.ResponseWriter, r *http.Request) {
	connectionID := chi.URLParam(r, "connectionId")
	node := chi.URLParam(r, "node")
	vmType := chi.URLParam(r, "vmType")
	vmidStr := chi.URLParam(r, "vmid")

	vmid, err := strconv.Atoi(vmidStr)
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid vmid")
		return
	}

	// Get limit from query params, default 50
	limitStr := r.URL.Query().Get("limit")
	limit := 50
	if limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l > 0 {
			limit = l
		}
	}

	logs, err := s.firewall.GetVMFirewallLog(r.Context(), connectionID, node, vmid, vmType, limit)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, logs)
}

// ================================================================================
// MICRO-SEGMENTATION
// ================================================================================

func (s *Server) handleAnalyzeMicroseg(w http.ResponseWriter, r *http.Request) {
	connectionID := chi.URLParam(r, "connectionId")

	// Get gateway offset from query params, default 254
	gatewayOffset := 254
	if offsetStr := r.URL.Query().Get("gateway_offset"); offsetStr != "" {
		if offset, err := strconv.Atoi(offsetStr); err == nil && offset > 0 && offset < 255 {
			gatewayOffset = offset
		}
	}

	analysis, err := s.firewall.AnalyzeMicrosegmentation(r.Context(), connectionID, gatewayOffset)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, analysis)
}

func (s *Server) handleGenerateBaseSGs(w http.ResponseWriter, r *http.Request) {
	connectionID := chi.URLParam(r, "connectionId")

	var req firewall.GenerateBaseSGsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		// Si pas de body, utiliser les valeurs par défaut
		req.DryRun = false
	}

	result, err := s.firewall.GenerateBaseSGs(r.Context(), connectionID, req)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, result)
}

func (s *Server) handleListVMsForSegmentation(w http.ResponseWriter, r *http.Request) {
	connectionID := chi.URLParam(r, "connectionId")

	// Get optional network filter
	networkFilter := r.URL.Query().Get("network")

	result, err := s.firewall.ListVMsForSegmentation(r.Context(), connectionID, networkFilter)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, result)
}

func (s *Server) handleSimulateIsolation(w http.ResponseWriter, r *http.Request) {
	connectionID := chi.URLParam(r, "connectionId")
	node := chi.URLParam(r, "node")
	vmType := chi.URLParam(r, "vmType")
	vmidStr := chi.URLParam(r, "vmid")

	vmid, err := strconv.Atoi(vmidStr)
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid vmid")
		return
	}

	simulation, err := s.firewall.SimulateIsolation(r.Context(), connectionID, node, vmid, vmType)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, simulation)
}

func (s *Server) handleGetVMSegmentationStatus(w http.ResponseWriter, r *http.Request) {
	connectionID := chi.URLParam(r, "connectionId")
	node := chi.URLParam(r, "node")
	vmType := chi.URLParam(r, "vmType")
	vmidStr := chi.URLParam(r, "vmid")

	vmid, err := strconv.Atoi(vmidStr)
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid vmid")
		return
	}

	status, err := s.firewall.GetVMSegmentationStatus(r.Context(), connectionID, node, vmid, vmType)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, status)
}

func (s *Server) handleIsolateVM(w http.ResponseWriter, r *http.Request) {
	connectionID := chi.URLParam(r, "connectionId")
	node := chi.URLParam(r, "node")
	vmType := chi.URLParam(r, "vmType")
	vmidStr := chi.URLParam(r, "vmid")

	vmid, err := strconv.Atoi(vmidStr)
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid vmid")
		return
	}

	var req firewall.IsolateVMRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}

	result, err := s.firewall.IsolateVM(r.Context(), connectionID, node, vmid, vmType, req)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, result)
}
