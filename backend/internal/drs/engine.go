package drs

import (
	"context"
	"fmt"
	"sort"
	"sync"
	"time"

	"github.com/proxcenter/orchestrator/internal/config"
	"github.com/proxcenter/orchestrator/internal/proxmox"
	"github.com/proxcenter/orchestrator/internal/storage"
	"github.com/rs/zerolog/log"
)

// Engine is the DRS decision engine
type Engine struct {
	pveManager *proxmox.Manager
	db         *storage.Database
	config     config.DRSConfig

	// Notifications
	notificationService NotificationService

	// State
	recommendations   []Recommendation
	activeMigrations  map[string]*Migration
	lastMigrationTime map[int]time.Time // VMID -> last migration time
	maintenanceNodes  map[string]map[string]bool // connectionID -> nodeName -> inMaintenance

	mu sync.RWMutex
}

// Recommendation represents a DRS recommendation
type Recommendation struct {
	ID           string    `json:"id"`
	ConnectionID string    `json:"connection_id"`
	VMID         int       `json:"vmid"`
	VMName       string    `json:"vm_name"`
	GuestType    string    `json:"guest_type"` // "qemu" or "lxc"
	SourceNode   string    `json:"source_node"`
	TargetNode   string    `json:"target_node"`
	Reason       string    `json:"reason"`
	Priority     Priority  `json:"priority"`
	Score        float64   `json:"score"` // Improvement score
	CreatedAt    time.Time `json:"created_at"`
	Status       string    `json:"status"` // pending, approved, rejected, executed
}

// Priority levels for recommendations
type Priority int

const (
	PriorityLow Priority = iota
	PriorityMedium
	PriorityHigh
	PriorityCritical
)

func (p Priority) String() string {
	switch p {
	case PriorityLow:
		return "low"
	case PriorityMedium:
		return "medium"
	case PriorityHigh:
		return "high"
	case PriorityCritical:
		return "critical"
	default:
		return "unknown"
	}
}

// Migration represents an active or completed migration
type Migration struct {
	ID               string     `json:"id"`
	RecommendationID string     `json:"recommendation_id,omitempty"`
	ConnectionID     string     `json:"connection_id"`
	VMID             int        `json:"vmid"`
	VMName           string     `json:"vm_name"`
	GuestType        string     `json:"guest_type"` // "qemu" or "lxc"
	SourceNode       string     `json:"source_node"`
	TargetNode       string     `json:"target_node"`
	TaskID           string     `json:"task_id"`
	StartedAt        time.Time  `json:"started_at"`
	CompletedAt      *time.Time `json:"completed_at,omitempty"`
	Status           string     `json:"status"` // running, completed, failed
	Error            string     `json:"error,omitempty"`
}

// NodeScore represents the calculated score for a node
type NodeScore struct {
	Node          string
	CPUUsage      float64
	MemoryUsage   float64
	StorageUsage  float64
	Score         float64 // Lower is better (more capacity)
	VMCount       int
	MaxMem        int64   // Total memory capacity in bytes (for VM impact calculation)
}

// ClusterState represents the current state of a cluster
type ClusterState struct {
	ConnectionID string
	Nodes        []NodeScore
	VMs          []proxmox.VM
	Imbalance    float64 // Standard deviation of node scores
	
	// Homogenization metrics
	AverageLoad  float64 // Average load across all nodes
	MaxLoad      float64 // Highest loaded node
	MinLoad      float64 // Lowest loaded node
	LoadSpread   float64 // Difference between max and min (percentage points)
	
	// Node capacities for VM impact calculation
	NodeMaxMem   map[string]int64 // nodeName -> MaxMem in bytes
	
	// Client reference for storage analysis during DRS
	Client       *proxmox.Client
}

// vmImpact represents a VM and its load impact for homogenization calculations
type vmImpact struct {
	vm     proxmox.VM
	impact float64
}

// NewEngine creates a new DRS engine
func NewEngine(pveManager *proxmox.Manager, db *storage.Database, cfg config.DRSConfig) *Engine {
	return &Engine{
		pveManager:        pveManager,
		db:                db,
		config:            cfg,
		recommendations:   make([]Recommendation, 0),
		activeMigrations:  make(map[string]*Migration),
		lastMigrationTime: make(map[int]time.Time),
		maintenanceNodes:  make(map[string]map[string]bool),
	}
}

// GetConfig returns the current DRS configuration
func (e *Engine) GetConfig() config.DRSConfig {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.config
}

// UpdateConfig updates the DRS configuration at runtime
func (e *Engine) UpdateConfig(cfg config.DRSConfig) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.config = cfg
}

// EnterMaintenanceMode puts a node in maintenance mode
func (e *Engine) EnterMaintenanceMode(connectionID, nodeName string) error {
	e.mu.Lock()
	defer e.mu.Unlock()

	if e.maintenanceNodes == nil {
		e.maintenanceNodes = make(map[string]map[string]bool)
	}
	if e.maintenanceNodes[connectionID] == nil {
		e.maintenanceNodes[connectionID] = make(map[string]bool)
	}
	e.maintenanceNodes[connectionID][nodeName] = true

	log.Info().
		Str("connection", connectionID).
		Str("node", nodeName).
		Msg("Node entered maintenance mode")

	return nil
}

// ExitMaintenanceMode removes a node from maintenance mode
func (e *Engine) ExitMaintenanceMode(connectionID, nodeName string) error {
	e.mu.Lock()
	defer e.mu.Unlock()

	if e.maintenanceNodes != nil && e.maintenanceNodes[connectionID] != nil {
		delete(e.maintenanceNodes[connectionID], nodeName)
	}

	log.Info().
		Str("connection", connectionID).
		Str("node", nodeName).
		Msg("Node exited maintenance mode")

	return nil
}

// IsNodeInMaintenance checks if a node is in maintenance mode
func (e *Engine) IsNodeInMaintenance(connectionID, nodeName string) bool {
	e.mu.RLock()
	defer e.mu.RUnlock()

	if e.maintenanceNodes == nil || e.maintenanceNodes[connectionID] == nil {
		return false
	}
	return e.maintenanceNodes[connectionID][nodeName]
}

// EvacuateNode generates migration recommendations for all VMs on a node
func (e *Engine) EvacuateNode(ctx context.Context, connectionID, nodeName, targetNode string) (int, error) {
	client, err := e.pveManager.GetClient(connectionID)
	if err != nil {
		return 0, err
	}

	vms, err := client.GetVMs(ctx)
	if err != nil {
		return 0, err
	}

	// Get available target nodes
	nodes, err := client.GetNodes(ctx)
	if err != nil {
		return 0, err
	}

	// Find suitable target nodes (online, not in maintenance, not the source)
	var targetNodes []string
	for _, node := range nodes {
		if node.Status == "online" && node.Node != nodeName && !e.IsNodeInMaintenance(connectionID, node.Node) {
			if targetNode == "" || node.Node == targetNode {
				targetNodes = append(targetNodes, node.Node)
			}
		}
	}

	if len(targetNodes) == 0 {
		return 0, fmt.Errorf("no suitable target nodes available")
	}

	count := 0
	for _, vm := range vms {
		if vm.Node != nodeName || vm.Status != "running" || vm.Template == 1 {
			continue
		}

		// Select target node (round-robin for simple distribution)
		target := targetNodes[count%len(targetNodes)]

		// Determine guest type (default to qemu if not set)
		guestType := vm.Type
		if guestType == "" {
			guestType = "qemu"
		}

		rec := Recommendation{
			ID:           generateID(),
			ConnectionID: connectionID,
			VMID:         vm.VMID,
			VMName:       vm.Name,
			GuestType:    guestType,
			SourceNode:   nodeName,
			TargetNode:   target,
			Reason:       "Node evacuation for maintenance",
			Priority:     PriorityHigh,
			Score:        100, // High score for evacuation
			CreatedAt:    time.Now(),
			Status:       "pending",
		}

		e.mu.Lock()
		e.recommendations = append(e.recommendations, rec)
		e.mu.Unlock()

		if err := e.db.SaveRecommendation(&rec); err != nil {
			log.Error().Err(err).Msg("Failed to save evacuation recommendation")
		}

		count++
	}

	log.Info().
		Str("connection", connectionID).
		Str("node", nodeName).
		Int("vms", count).
		Msg("Node evacuation recommendations generated")

	return count, nil
}

// Evaluate analyzes all clusters and generates recommendations
func (e *Engine) Evaluate(ctx context.Context) error {
	if !e.config.Enabled {
		return nil
	}

	log.Debug().Msg("DRS evaluation started")

	clients := e.pveManager.GetAllClients()
	var newRecommendations []Recommendation

	for connID, client := range clients {
		state, err := e.getClusterState(ctx, connID, client)
		if err != nil {
			log.Error().Err(err).Str("connection", connID).Msg("Failed to get cluster state")
			continue
		}

		// Generate recommendations for this cluster
		recommendations := e.analyzeCluster(state)
		newRecommendations = append(newRecommendations, recommendations...)
	}

	e.mu.Lock()
	e.recommendations = newRecommendations
	e.mu.Unlock()

	log.Info().Int("recommendations", len(newRecommendations)).Msg("DRS evaluation completed")

	// Persist recommendations
	for _, rec := range newRecommendations {
		if err := e.db.SaveRecommendation(&rec); err != nil {
			log.Error().Err(err).Msg("Failed to save recommendation")
		}
	}

	return nil
}

// getClusterState collects the current state of a cluster
func (e *Engine) getClusterState(ctx context.Context, connID string, client *proxmox.Client) (*ClusterState, error) {
	nodes, err := client.GetNodes(ctx)
	if err != nil {
		return nil, err
	}

	vms, err := client.GetVMs(ctx)
	if err != nil {
		return nil, err
	}

	// Calculate node scores
	nodeScores := make([]NodeScore, 0, len(nodes))
	for _, node := range nodes {
		if node.Status != "online" {
			continue
		}

		// Skip nodes in maintenance mode
		if e.IsNodeInMaintenance(connID, node.Node) {
			log.Debug().
				Str("connection", connID).
				Str("node", node.Node).
				Msg("Skipping node in maintenance mode")
			continue
		}

		cpuUsage := node.CPU * 100
		memUsage := float64(node.Mem) / float64(node.MaxMem) * 100
		storageUsage := float64(node.Disk) / float64(node.MaxDisk) * 100

		// Count VMs on this node
		vmCount := 0
		for _, vm := range vms {
			if vm.Node == node.Node && vm.Template == 0 {
				vmCount++
			}
		}

		// Calculate weighted score (lower = more capacity available)
		score := (cpuUsage * e.config.CPUWeight) +
			(memUsage * e.config.MemoryWeight) +
			(storageUsage * e.config.StorageWeight)

		nodeScores = append(nodeScores, NodeScore{
			Node:         node.Node,
			CPUUsage:     cpuUsage,
			MemoryUsage:  memUsage,
			StorageUsage: storageUsage,
			Score:        score,
			VMCount:      vmCount,
			MaxMem:       node.MaxMem,
		})
	}

	// Calculate imbalance (standard deviation)
	imbalance := calculateImbalance(nodeScores)

	// Calculate homogenization metrics
	var avgLoad, maxLoad, minLoad float64
	nodeMaxMem := make(map[string]int64)
	if len(nodeScores) > 0 {
		minLoad = nodeScores[0].Score
		for _, ns := range nodeScores {
			avgLoad += ns.Score
			if ns.Score > maxLoad {
				maxLoad = ns.Score
			}
			if ns.Score < minLoad {
				minLoad = ns.Score
			}
			nodeMaxMem[ns.Node] = ns.MaxMem
		}
		avgLoad /= float64(len(nodeScores))
	}
	loadSpread := maxLoad - minLoad

	return &ClusterState{
		ConnectionID: connID,
		Nodes:        nodeScores,
		VMs:          vms,
		Imbalance:    imbalance,
		AverageLoad:  avgLoad,
		MaxLoad:      maxLoad,
		MinLoad:      minLoad,
		LoadSpread:   loadSpread,
		NodeMaxMem:   nodeMaxMem,
		Client:       client,
	}, nil
}

// analyzeCluster generates recommendations for a single cluster
func (e *Engine) analyzeCluster(state *ClusterState) []Recommendation {
	var recommendations []Recommendation

	// Skip if less than 2 nodes
	if len(state.Nodes) < 2 {
		log.Debug().
			Str("connection", state.ConnectionID).
			Int("nodes", len(state.Nodes)).
			Msg("Skipping cluster: less than 2 nodes")
		return recommendations
	}

	// Sort nodes by score (highest load first)
	sort.Slice(state.Nodes, func(i, j int) bool {
		return state.Nodes[i].Score > state.Nodes[j].Score
	})

	// Log cluster state
	log.Info().
		Str("connection", state.ConnectionID).
		Int("total_nodes", len(state.Nodes)).
		Float64("avg_load", state.AverageLoad).
		Float64("max_load", state.MaxLoad).
		Float64("min_load", state.MinLoad).
		Float64("load_spread", state.LoadSpread).
		Float64("max_allowed_spread", e.config.MaxLoadSpread).
		Bool("homogenization_enabled", e.config.HomogenizationEnabled).
		Msg("Cluster analysis")

	// Log each node's status
	for _, node := range state.Nodes {
		deviation := node.Score - state.AverageLoad
		log.Debug().
			Str("node", node.Node).
			Float64("cpu", node.CPUUsage).
			Float64("mem", node.MemoryUsage).
			Float64("score", node.Score).
			Float64("deviation_from_avg", deviation).
			Int("vm_count", node.VMCount).
			Msg("Node status")
	}

	// HOMOGENIZATION MODE
	// This mode actively seeks to equalize load across all nodes
	if e.config.HomogenizationEnabled && state.LoadSpread > e.config.MaxLoadSpread {
		log.Info().
			Str("connection", state.ConnectionID).
			Float64("current_spread", state.LoadSpread).
			Float64("max_allowed", e.config.MaxLoadSpread).
			Msg("Homogenization mode: load spread exceeds threshold, generating recommendations")

		recommendations = e.generateHomogenizationRecommendations(state)
		if len(recommendations) > 0 {
			return recommendations
		}
	}

	// REACTIVE MODE (fallback)
	// Traditional hot/cold node detection
	hotNodes := e.findHotNodes(state.Nodes)
	coldNodes := e.findColdNodes(state.Nodes)

	// If no hot nodes, check for proactive balancing
	if len(hotNodes) == 0 {
		stdDev := sqrtApprox(state.Imbalance)
		if stdDev > e.config.ImbalanceThreshold {
			log.Info().
				Str("connection", state.ConnectionID).
				Float64("std_dev", stdDev).
				Msg("Proactive mode: significant imbalance detected")
			
			// Use nodes above average as sources
			for _, node := range state.Nodes {
				if node.Score > state.AverageLoad {
					hotNodes = append(hotNodes, node)
				}
			}
			// Use nodes below average as targets
			coldNodes = []NodeScore{}
			for _, node := range state.Nodes {
				if node.Score < state.AverageLoad {
					coldNodes = append(coldNodes, node)
				}
			}
		}
	}

	if len(hotNodes) == 0 || len(coldNodes) == 0 {
		log.Debug().
			Str("connection", state.ConnectionID).
			Msg("No balancing needed: cluster is balanced")
		return recommendations
	}

	// Generate recommendations using traditional method
	ctx := context.Background()
	for _, hotNode := range hotNodes {
		for _, vm := range state.VMs {
			if vm.Node != hotNode.Node || vm.Template == 1 || vm.Status != "running" {
				continue
			}

			// Check if VM has only shared storage (Ceph) - skip VMs with local disks
			if state.Client != nil && !e.isVMMigrationSafe(ctx, state.Client, vm) {
				continue
			}

			// Check cooldown
			if lastMigration, ok := e.lastMigrationTime[vm.VMID]; ok {
				if time.Since(lastMigration) < e.config.MigrationCooldown {
					continue
				}
			}

			// Check minimum uptime
			if time.Duration(vm.Uptime)*time.Second < e.config.MinVMUptimeForMigration {
				continue
			}

			// Find best target node
			targetNode, improvement := e.findBestTarget(vm, hotNode, coldNodes, state)
			if targetNode == "" || improvement < 5 {
				continue
			}

			priority := e.calculatePriority(hotNode, improvement)
			reason := e.generateReason(hotNode, targetNode, improvement)

			guestType := vm.Type
			if guestType == "" {
				guestType = "qemu"
			}

			rec := Recommendation{
				ID:           generateID(),
				ConnectionID: state.ConnectionID,
				VMID:         vm.VMID,
				VMName:       vm.Name,
				GuestType:    guestType,
				SourceNode:   hotNode.Node,
				TargetNode:   targetNode,
				Reason:       reason,
				Priority:     priority,
				Score:        improvement,
				CreatedAt:    time.Now(),
				Status:       "pending",
			}

			recommendations = append(recommendations, rec)
		}
	}

	// Sort by priority and score
	sort.Slice(recommendations, func(i, j int) bool {
		if recommendations[i].Priority != recommendations[j].Priority {
			return recommendations[i].Priority > recommendations[j].Priority
		}
		return recommendations[i].Score > recommendations[j].Score
	})

	return recommendations
}

// generateHomogenizationRecommendations creates recommendations to equalize cluster load
func (e *Engine) generateHomogenizationRecommendations(state *ClusterState) []Recommendation {
	var recommendations []Recommendation
	
	// Create a working copy of node scores to simulate migrations
	nodeLoads := make(map[string]float64)
	for _, node := range state.Nodes {
		nodeLoads[node.Node] = node.Score
	}
	
	// Build a map of VMs by node for quick lookup
	// Only include VMs with shared storage (Ceph) for automatic DRS migrations
	ctx := context.Background()
	vmsByNode := make(map[string][]proxmox.VM)
	var skippedLocalStorage int
	for _, vm := range state.VMs {
		if vm.Template == 0 && vm.Status == "running" {
			// Check if VM has only shared storage (Ceph) - skip VMs with local disks
			if state.Client != nil && !e.isVMMigrationSafe(ctx, state.Client, vm) {
				skippedLocalStorage++
				continue
			}
			vmsByNode[vm.Node] = append(vmsByNode[vm.Node], vm)
		}
	}
	
	if skippedLocalStorage > 0 {
		log.Info().
			Int("skipped_local_storage", skippedLocalStorage).
			Msg("Homogenization: VMs with local storage excluded from automatic DRS")
	}
	
	// Calculate VM impacts (how much each VM contributes to node load)
	vmImpacts := make(map[string][]vmImpact)
	var totalVMsWithImpact int
	var totalVMsWithoutMem int
	for nodeName, vms := range vmsByNode {
		nodeMaxMem := state.NodeMaxMem[nodeName]
		for _, vm := range vms {
			impact := e.calculateVMImpactWithNodeCapacity(vm, nodeMaxMem)
			if impact > 0 {
				totalVMsWithImpact++
				vmImpacts[nodeName] = append(vmImpacts[nodeName], vmImpact{vm: vm, impact: impact})
			} else {
				if vm.Mem == 0 {
					totalVMsWithoutMem++
				}
			}
		}
		// Sort VMs by impact (largest first for more efficient balancing)
		sort.Slice(vmImpacts[nodeName], func(i, j int) bool {
			return vmImpacts[nodeName][i].impact > vmImpacts[nodeName][j].impact
		})
	}
	
	log.Info().
		Int("total_vms_with_impact", totalVMsWithImpact).
		Int("total_vms_without_mem", totalVMsWithoutMem).
		Int("total_running_vms", len(state.VMs)).
		Int("eligible_for_drs", len(state.VMs)-skippedLocalStorage).
		Msg("Homogenization: VM impact calculation complete")
	
	// If no VMs have measurable impact, we can't do anything
	if totalVMsWithImpact == 0 {
		log.Warn().Msg("Homogenization: no VMs with measurable resource impact found")
		return recommendations
	}
	
	targetAvg := state.AverageLoad
	maxRecommendations := 10 // Limit recommendations per cluster per cycle
	
	// Build list of potential source nodes (above average) and target nodes (below average)
	type nodeInfo struct {
		name string
		load float64
	}
	
	var sourceNodes, targetNodes []nodeInfo
	
	for nodeName, load := range nodeLoads {
		if load > targetAvg {
			sourceNodes = append(sourceNodes, nodeInfo{nodeName, load})
		} else {
			targetNodes = append(targetNodes, nodeInfo{nodeName, load})
		}
	}
	
	// Sort sources by load (highest first) and targets by load (lowest first)
	sort.Slice(sourceNodes, func(i, j int) bool {
		return sourceNodes[i].load > sourceNodes[j].load
	})
	sort.Slice(targetNodes, func(i, j int) bool {
		return targetNodes[i].load < targetNodes[j].load
	})
	
	log.Info().
		Int("source_nodes_above_avg", len(sourceNodes)).
		Int("target_nodes_below_avg", len(targetNodes)).
		Float64("avg_load", targetAvg).
		Msg("Homogenization: identified source and target nodes")
	
	// Track VMs already recommended for migration
	usedVMs := make(map[int]bool)
	
	// Try each source node
	for srcIdx := range sourceNodes {
		if len(recommendations) >= maxRecommendations {
			break
		}
		
		source := &sourceNodes[srcIdx]
		sourceVMs := vmImpacts[source.name]
		if len(sourceVMs) == 0 {
			continue
		}
		
		// Try each target node for this source
		for tgtIdx := range targetNodes {
			if len(recommendations) >= maxRecommendations {
				break
			}
			
			target := &targetNodes[tgtIdx]
			
			// Skip if spread between this pair is too small
			pairSpread := source.load - target.load
			if pairSpread < e.config.MinSpreadReduction*2 {
				continue
			}
			
			// Find best VM for this source->target pair
			bestVM, bestReduction := e.findBestVMForPair(
				sourceVMs,
				source.name, target.name,
				source.load, target.load,
				targetAvg,
				state,
				usedVMs,
			)
			
			if bestVM == nil || bestReduction < e.config.MinSpreadReduction {
				continue
			}
			
			// Check cooldown
			if lastMigration, ok := e.lastMigrationTime[bestVM.VMID]; ok {
				if time.Since(lastMigration) < e.config.MigrationCooldown {
					continue
				}
			}
			
			// Check minimum uptime
			if time.Duration(bestVM.Uptime)*time.Second < e.config.MinVMUptimeForMigration {
				continue
			}
			
			// Create recommendation
			guestType := bestVM.Type
			if guestType == "" {
				guestType = "qemu"
			}
			
			rec := Recommendation{
				ID:           generateID(),
				ConnectionID: state.ConnectionID,
				VMID:         bestVM.VMID,
				VMName:       bestVM.Name,
				GuestType:    guestType,
				SourceNode:   source.name,
				TargetNode:   target.name,
				Reason:       fmt.Sprintf("Homogenization: reduce load from %.1f%% to %.1f%%", source.load, target.load),
				Priority:     e.calculateHomogenizationPriority(pairSpread),
				Score:        bestReduction,
				CreatedAt:    time.Now(),
				Status:       "pending",
			}
			
			recommendations = append(recommendations, rec)
			usedVMs[bestVM.VMID] = true
			
			// Update simulated loads
			nodeMaxMem := state.NodeMaxMem[source.name]
			vmImpactValue := e.calculateVMImpactWithNodeCapacity(*bestVM, nodeMaxMem)
			source.load -= vmImpactValue
			target.load += vmImpactValue
			nodeLoads[source.name] = source.load
			nodeLoads[target.name] = target.load
			
			log.Debug().
				Str("vm", bestVM.Name).
				Int("vmid", bestVM.VMID).
				Str("from", source.name).
				Str("to", target.name).
				Float64("spread_reduction", bestReduction).
				Msg("Homogenization: migration recommended")
		}
	}
	
	log.Info().
		Int("total_recommendations", len(recommendations)).
		Msg("Homogenization: evaluation complete")
	
	// Sort by score (spread reduction)
	sort.Slice(recommendations, func(i, j int) bool {
		return recommendations[i].Score > recommendations[j].Score
	})
	
	return recommendations
}

// findBestVMForPair finds the best VM to migrate from source to target
func (e *Engine) findBestVMForPair(
	sourceVMs []vmImpact,
	sourceNode, targetNode string,
	sourceLoad, targetLoad float64,
	targetAvg float64,
	state *ClusterState,
	usedVMs map[int]bool,
) (*proxmox.VM, float64) {
	
	var bestVM *proxmox.VM
	var bestReduction float64
	
	currentSpread := sourceLoad - targetLoad
	
	for _, vi := range sourceVMs {
		// Skip if already used
		if usedVMs[vi.vm.VMID] {
			continue
		}
		
		// Simulate migration
		newSourceLoad := sourceLoad - vi.impact
		newTargetLoad := targetLoad + vi.impact
		
		// Skip if this would make target more loaded than source
		if newTargetLoad >= newSourceLoad {
			continue
		}
		
		// Calculate reduction in spread
		newSpread := newSourceLoad - newTargetLoad
		reduction := currentSpread - newSpread
		
		if reduction > bestReduction {
			bestReduction = reduction
			vm := vi.vm // Copy
			bestVM = &vm
		}
	}
	
	return bestVM, bestReduction
}
// calculateVMImpact estimates how much a VM contributes to node load
// The impact is calculated as a percentage of typical node capacity
// This is a fallback when node capacity is not known
func (e *Engine) calculateVMImpact(vm proxmox.VM) float64 {
	// Use a typical node capacity of 256GB as fallback
	const typicalNodeMemBytes int64 = 256 * 1024 * 1024 * 1024
	return e.calculateVMImpactWithNodeCapacity(vm, typicalNodeMemBytes)
}

// calculateVMImpactWithNodeCapacity estimates VM impact relative to actual node capacity
// This is the accurate version that should be used when node capacity is known
func (e *Engine) calculateVMImpactWithNodeCapacity(vm proxmox.VM, nodeMaxMem int64) float64 {
	var cpuImpact, memImpact float64
	
	// CPU impact: actual CPU usage as percentage
	// vm.CPU is typically 0.0-N.0 where N is number of cores used
	if vm.CPU > 0 {
		cpuImpact = vm.CPU * 100
	}
	
	// Memory impact: VM's actual memory usage as percentage of node capacity
	if vm.Mem > 0 && nodeMaxMem > 0 {
		memImpact = float64(vm.Mem) / float64(nodeMaxMem) * 100
	}
	
	// Weighted impact using config weights
	impact := (cpuImpact * e.config.CPUWeight) + (memImpact * e.config.MemoryWeight)
	
	return impact
}

// calculateVMImpactForNode estimates VM impact relative to a specific node's capacity
func (e *Engine) calculateVMImpactForNode(vm proxmox.VM, node NodeScore, nodeMaxMem int64) float64 {
	return e.calculateVMImpactWithNodeCapacity(vm, nodeMaxMem)
}

// findBestVMForHomogenization finds the VM that best reduces spread when migrated
func (e *Engine) findBestVMForHomogenization(
	sourceVMs []vmImpact,
	sourceNode, targetNode string,
	sourceLoad, targetLoad float64,
	targetAvg float64,
	state *ClusterState,
) (*proxmox.VM, float64) {
	
	var bestVM *proxmox.VM
	var bestReduction float64
	
	currentSpread := sourceLoad - targetLoad
	
	log.Debug().
		Str("source_node", sourceNode).
		Str("target_node", targetNode).
		Float64("source_load", sourceLoad).
		Float64("target_load", targetLoad).
		Float64("current_spread", currentSpread).
		Int("candidate_vms", len(sourceVMs)).
		Msg("Homogenization: evaluating migration candidates")
	
	if len(sourceVMs) == 0 {
		log.Warn().
			Str("source_node", sourceNode).
			Msg("Homogenization: no VMs available on source node")
		return nil, 0
	}
	
	// Log first few VM impacts for debugging
	for i, vi := range sourceVMs {
		if i < 3 {
			log.Debug().
				Str("vm", vi.vm.Name).
				Float64("impact", vi.impact).
				Int64("vm_mem_bytes", vi.vm.Mem).
				Msg("Homogenization: candidate VM")
		}
	}
	
	var skippedOverload, skippedAboveAvg, evaluated int
	
	for _, vi := range sourceVMs {
		// Simulate migration
		newSourceLoad := sourceLoad - vi.impact
		newTargetLoad := targetLoad + vi.impact
		
		// Skip if this would make target more loaded than source
		if newTargetLoad >= newSourceLoad {
			skippedOverload++
			// Log first skip for debugging
			if skippedOverload == 1 {
				log.Debug().
					Str("vm", vi.vm.Name).
					Float64("impact", vi.impact).
					Float64("new_source", newSourceLoad).
					Float64("new_target", newTargetLoad).
					Msg("Homogenization: skipped - would overload target")
			}
			continue
		}
		
		// Skip if this would push target above average while source stays above average
		if newTargetLoad > targetAvg && newSourceLoad > targetAvg {
			// But allow if it still reduces spread significantly
			newSpread := newSourceLoad - newTargetLoad
			if currentSpread-newSpread < e.config.MinSpreadReduction {
				skippedAboveAvg++
				continue
			}
		}
		
		evaluated++
		
		// Calculate new spread after migration
		// We need to consider all nodes, not just source and target
		newSpread := e.calculateNewClusterSpread(state, sourceNode, targetNode, vi.impact)
		reduction := currentSpread - newSpread
		
		if reduction > bestReduction {
			bestReduction = reduction
			vm := vi.vm // Copy
			bestVM = &vm
			
			log.Debug().
				Str("vm", vi.vm.Name).
				Float64("impact", vi.impact).
				Float64("new_spread", newSpread).
				Float64("reduction", reduction).
				Msg("Homogenization: new best candidate")
		}
	}
	
	log.Info().
		Int("evaluated", evaluated).
		Int("skipped_overload", skippedOverload).
		Int("skipped_above_avg", skippedAboveAvg).
		Float64("best_reduction", bestReduction).
		Msg("Homogenization: migration evaluation complete")
	
	return bestVM, bestReduction
}

// calculateNewClusterSpread calculates what the cluster spread would be after a migration
func (e *Engine) calculateNewClusterSpread(state *ClusterState, sourceNode, targetNode string, vmImpact float64) float64 {
	var maxLoad, minLoad float64 = 0, 100000
	
	for _, node := range state.Nodes {
		load := node.Score
		if node.Node == sourceNode {
			load -= vmImpact
		} else if node.Node == targetNode {
			load += vmImpact
		}
		
		if load > maxLoad {
			maxLoad = load
		}
		if load < minLoad {
			minLoad = load
		}
	}
	
	return maxLoad - minLoad
}

// removeVMFromImpacts removes a VM from the impacts list
func (e *Engine) removeVMFromImpacts(vmImpacts map[string][]vmImpact, nodeName string, vmid int) {
	vms := vmImpacts[nodeName]
	for i, vi := range vms {
		if vi.vm.VMID == vmid {
			vmImpacts[nodeName] = append(vms[:i], vms[i+1:]...)
			return
		}
	}
}

// calculateHomogenizationPriority determines priority based on current spread
func (e *Engine) calculateHomogenizationPriority(spread float64) Priority {
	if spread > 25 {
		return PriorityCritical
	}
	if spread > 15 {
		return PriorityHigh
	}
	if spread > 10 {
		return PriorityMedium
	}
	return PriorityLow
}

// findHotNodes returns nodes that exceed thresholds
func (e *Engine) findHotNodes(nodes []NodeScore) []NodeScore {
	var hot []NodeScore
	for _, node := range nodes {
		if node.CPUUsage > e.config.CPUHighThreshold ||
			node.MemoryUsage > e.config.MemoryHighThreshold {
			hot = append(hot, node)
		}
	}
	return hot
}

// findColdNodes returns nodes with capacity
func (e *Engine) findColdNodes(nodes []NodeScore) []NodeScore {
	var cold []NodeScore
	for _, node := range nodes {
		// A node is cold if it's below the LOW thresholds (has capacity)
		if node.CPUUsage < e.config.CPULowThreshold &&
			node.MemoryUsage < e.config.MemoryLowThreshold {
			cold = append(cold, node)
		}
	}
	
	// If no strictly cold nodes, find nodes that are at least not hot
	if len(cold) == 0 {
		for _, node := range nodes {
			if node.CPUUsage < e.config.CPUHighThreshold &&
				node.MemoryUsage < e.config.MemoryHighThreshold {
				cold = append(cold, node)
			}
		}
	}
	
	return cold
}

// findBestTarget finds the best target node for a VM migration
func (e *Engine) findBestTarget(vm proxmox.VM, source NodeScore, coldNodes []NodeScore, state *ClusterState) (string, float64) {
	var bestTarget string
	var bestImprovement float64

	// Calculate VM resource impact
	// For CPU: vm.CPU is the actual usage ratio (0.0-1.0 per core), cpus is the number of allocated cores
	// For memory: we need to estimate the % impact on the target node
	
	var vmCPUPercent float64
	if vm.CPUs > 0 && vm.CPU > 0 {
		// CPU impact: actual CPU usage as percentage
		vmCPUPercent = vm.CPU * 100
	}
	
	var vmMemPercent float64
	if vm.MaxMem > 0 && vm.Mem > 0 {
		// Memory impact: estimate based on actual memory used relative to the node
		// We'll calculate this per-target based on node capacity
		vmMemPercent = float64(vm.Mem) / float64(vm.MaxMem) * 100
	} else if vm.Mem > 0 {
		// Fallback: if we have mem but not maxmem, estimate impact
		// Assume the VM uses what it needs
		vmMemPercent = 10 // Conservative estimate: 10% impact
	}
	
	// Log VM resource info for debugging
	log.Debug().
		Str("vm", vm.Name).
		Int("vmid", vm.VMID).
		Float64("vm_cpu", vm.CPU).
		Int("vm_cpus", vm.CPUs).
		Int64("vm_mem", vm.Mem).
		Int64("vm_maxmem", vm.MaxMem).
		Float64("vm_cpu_percent", vmCPUPercent).
		Float64("vm_mem_percent", vmMemPercent).
		Msg("VM resource analysis")
	
	// Skip VMs with no measurable resource impact
	if vmCPUPercent == 0 && vmMemPercent == 0 {
		log.Debug().
			Str("vm", vm.Name).
			Int("vmid", vm.VMID).
			Msg("Skipping VM: no resource data available")
		return "", 0
	}

	// Calculate cluster average for relative comparison
	var avgScore float64
	for _, node := range state.Nodes {
		avgScore += node.Score
	}
	avgScore /= float64(len(state.Nodes))

	for _, target := range coldNodes {
		if target.Node == source.Node {
			continue
		}

		// Estimate new usage after migration
		newTargetCPU := target.CPUUsage + vmCPUPercent
		newTargetMem := target.MemoryUsage + vmMemPercent

		// Calculate new target score after migration
		newTargetScore := (newTargetCPU * e.config.CPUWeight) +
			(newTargetMem * e.config.MemoryWeight) +
			(target.StorageUsage * e.config.StorageWeight)

		// Skip if target would become more loaded than source (no improvement)
		if newTargetScore >= source.Score {
			log.Debug().
				Str("vm", vm.Name).
				Str("target", target.Node).
				Float64("new_target_score", newTargetScore).
				Float64("source_score", source.Score).
				Msg("Skipping target: would become more loaded than source")
			continue
		}

		// Calculate improvement (reduction in imbalance)
		improvement := (source.Score - newTargetScore) / source.Score * 100

		log.Debug().
			Str("vm", vm.Name).
			Str("target", target.Node).
			Float64("target_cpu_after", newTargetCPU).
			Float64("target_mem_after", newTargetMem).
			Float64("new_target_score", newTargetScore).
			Float64("improvement", improvement).
			Msg("Evaluating migration target")

		if improvement > bestImprovement {
			bestImprovement = improvement
			bestTarget = target.Node
		}
	}

	return bestTarget, bestImprovement
}

// calculatePriority determines the priority based on node load
func (e *Engine) calculatePriority(node NodeScore, improvement float64) Priority {
	if node.CPUUsage > 95 || node.MemoryUsage > 95 {
		return PriorityCritical
	}
	if node.CPUUsage > 90 || node.MemoryUsage > 90 {
		return PriorityHigh
	}
	if improvement > 20 {
		return PriorityMedium
	}
	return PriorityLow
}

// generateReason creates a human-readable reason
func (e *Engine) generateReason(source NodeScore, target string, improvement float64) string {
	if source.CPUUsage > e.config.CPUHighThreshold {
		return "High CPU load on source node"
	}
	if source.MemoryUsage > e.config.MemoryHighThreshold {
		return "High memory usage on source node"
	}
	return "Load balancing optimization"
}

// Rebalance executes approved recommendations (in automatic mode)
func (e *Engine) Rebalance(ctx context.Context) error {
	if !e.config.Enabled || e.config.Mode == config.DRSModeManual {
		return nil
	}

	e.mu.Lock()
	activeMigrations := len(e.activeMigrations)
	e.mu.Unlock()

	if activeMigrations >= e.config.MaxConcurrentMigrations {
		log.Debug().Int("active", activeMigrations).Msg("Max concurrent migrations reached")
		return nil
	}

	// Get pending recommendations
	recommendations := e.GetRecommendations()

	for _, rec := range recommendations {
		if rec.Status != "pending" && rec.Status != "approved" {
			continue
		}

		// In partial mode, only execute high priority recommendations
		if e.config.Mode == config.DRSModePartial && rec.Priority < PriorityHigh {
			continue
		}

		// Execute migration
		if err := e.ExecuteMigration(ctx, &rec); err != nil {
			log.Error().Err(err).Str("recommendation", rec.ID).Msg("Failed to execute migration")
			continue
		}

		e.mu.Lock()
		if len(e.activeMigrations) >= e.config.MaxConcurrentMigrations {
			e.mu.Unlock()
			break
		}
		e.mu.Unlock()
	}

	return nil
}

// ExecuteMigration executes a specific migration
func (e *Engine) ExecuteMigration(ctx context.Context, rec *Recommendation) error {
	client, err := e.pveManager.GetClient(rec.ConnectionID)
	if err != nil {
		return err
	}

	// Verify VM is still on the expected source node before migrating
	currentNode, err := client.GetVMNode(ctx, rec.VMID)
	if err != nil {
		return fmt.Errorf("failed to verify VM location: %w", err)
	}
	
	if currentNode != rec.SourceNode {
		// VM has moved since recommendation was generated
		log.Warn().
			Int("vmid", rec.VMID).
			Str("expected_node", rec.SourceNode).
			Str("current_node", currentNode).
			Msg("VM is no longer on expected source node, invalidating recommendation")
		
		// Mark recommendation as stale
		rec.Status = "stale"
		e.db.UpdateRecommendationStatus(rec.ID, "stale")
		
		return fmt.Errorf("VM %d has moved from %s to %s since recommendation was created", 
			rec.VMID, rec.SourceNode, currentNode)
	}
	
	// Also check if VM is already on target (migration already done)
	if currentNode == rec.TargetNode {
		log.Info().
			Int("vmid", rec.VMID).
			Str("node", currentNode).
			Msg("VM is already on target node")
		
		rec.Status = "completed"
		e.db.UpdateRecommendationStatus(rec.ID, "completed")
		
		return fmt.Errorf("VM %d is already on target node %s", rec.VMID, rec.TargetNode)
	}

	// Initiate migration based on guest type
	var taskID string
	if rec.GuestType == "lxc" {
		taskID, err = client.MigrateLXC(ctx, rec.SourceNode, rec.VMID, rec.TargetNode, true)
	} else {
		taskID, err = client.MigrateVM(ctx, rec.SourceNode, rec.VMID, rec.TargetNode, true)
	}
	if err != nil {
		return err
	}

	migration := &Migration{
		ID:               generateID(),
		RecommendationID: rec.ID,
		ConnectionID:     rec.ConnectionID,
		VMID:             rec.VMID,
		VMName:           rec.VMName,
		GuestType:        rec.GuestType,
		SourceNode:       rec.SourceNode,
		TargetNode:       rec.TargetNode,
		TaskID:           taskID,
		StartedAt:        time.Now(),
		Status:           "running",
	}

	e.mu.Lock()
	e.activeMigrations[migration.ID] = migration
	e.lastMigrationTime[rec.VMID] = time.Now()
	e.mu.Unlock()

	// Update recommendation status
	rec.Status = "executed"
	e.db.UpdateRecommendationStatus(rec.ID, "executed")
	e.db.SaveMigration(migration)

	log.Info().
		Int("vmid", rec.VMID).
		Str("type", rec.GuestType).
		Str("source", rec.SourceNode).
		Str("target", rec.TargetNode).
		Str("task_id", taskID).
		Msg("Migration started")

	// Notification de début de migration
	e.notifyMigrationStarted(migration, rec.Reason)

	// Monitor migration in background
	go e.monitorMigration(migration, client)

	return nil
}

// monitorMigration monitors an active migration
func (e *Engine) monitorMigration(migration *Migration, client *proxmox.Client) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	timeout := time.After(30 * time.Minute)

	for {
		select {
		case <-ticker.C:
			ctx := context.Background()
			status, err := client.GetTaskStatus(ctx, migration.SourceNode, migration.TaskID)
			if err != nil {
				log.Error().Err(err).Str("migration", migration.ID).Msg("Failed to check migration status")
				continue
			}

			if status == "OK" {
				now := time.Now()
				migration.CompletedAt = &now
				migration.Status = "completed"

				e.mu.Lock()
				delete(e.activeMigrations, migration.ID)
				e.mu.Unlock()

				e.db.UpdateMigrationStatus(migration.ID, "completed", "")
				log.Info().Str("migration", migration.ID).Msg("Migration completed successfully")
				
				// Notification de succès
				e.notifyMigrationCompleted(migration)
				return
			}

			if status != "running" {
				now := time.Now()
				migration.CompletedAt = &now
				migration.Status = "failed"
				migration.Error = status

				e.mu.Lock()
				delete(e.activeMigrations, migration.ID)
				e.mu.Unlock()

				e.db.UpdateMigrationStatus(migration.ID, "failed", status)
				log.Error().Str("migration", migration.ID).Str("error", status).Msg("Migration failed")
				
				// Notification d'échec
				e.notifyMigrationFailed(migration, status)
				return
			}

		case <-timeout:
			migration.Status = "failed"
			migration.Error = "timeout"

			e.mu.Lock()
			delete(e.activeMigrations, migration.ID)
			e.mu.Unlock()

			e.db.UpdateMigrationStatus(migration.ID, "failed", "timeout")
			log.Error().Str("migration", migration.ID).Msg("Migration timed out")
			
			// Notification d'échec timeout
			e.notifyMigrationFailed(migration, "Migration timeout après 30 minutes")
			return
		}
	}
}

// GetRecommendations returns current recommendations
func (e *Engine) GetRecommendations() []Recommendation {
	e.mu.RLock()
	defer e.mu.RUnlock()

	result := make([]Recommendation, len(e.recommendations))
	copy(result, e.recommendations)
	return result
}

// GetActiveMigrations returns active migrations
func (e *Engine) GetActiveMigrations() []*Migration {
	e.mu.RLock()
	defer e.mu.RUnlock()

	result := make([]*Migration, 0, len(e.activeMigrations))
	for _, m := range e.activeMigrations {
		result = append(result, m)
	}
	return result
}

// ApproveRecommendation approves a recommendation for execution
func (e *Engine) ApproveRecommendation(id string) error {
	e.mu.Lock()
	defer e.mu.Unlock()

	for i := range e.recommendations {
		if e.recommendations[i].ID == id {
			e.recommendations[i].Status = "approved"
			e.db.UpdateRecommendationStatus(id, "approved")
			return nil
		}
	}

	return nil
}

// RejectRecommendation rejects a recommendation
func (e *Engine) RejectRecommendation(id string) error {
	e.mu.Lock()
	defer e.mu.Unlock()

	for i := range e.recommendations {
		if e.recommendations[i].ID == id {
			e.recommendations[i].Status = "rejected"
			e.db.UpdateRecommendationStatus(id, "rejected")
			return nil
		}
	}

	return nil
}

// Helper functions

// isVMMigrationSafe checks if a VM/LXC can be live migrated (all disks on shared storage like Ceph)
// Returns true if safe to migrate, false if has local disks
func (e *Engine) isVMMigrationSafe(ctx context.Context, client *proxmox.Client, vm proxmox.VM) bool {
	var analysis *proxmox.VMStorageAnalysis
	var err error

	if vm.Type == "lxc" {
		analysis, err = client.AnalyzeLXCStorage(ctx, vm.Node, vm.VMID, vm.Name)
	} else {
		analysis, err = client.AnalyzeVMStorage(ctx, vm.Node, vm.VMID, vm.Name)
	}

	if err != nil {
		log.Warn().
			Err(err).
			Int("vmid", vm.VMID).
			Str("name", vm.Name).
			Str("type", vm.Type).
			Msg("Failed to analyze VM storage, assuming not migration safe")
		return false
	}

	if !analysis.MigrationSafe {
		log.Debug().
			Int("vmid", vm.VMID).
			Str("name", vm.Name).
			Bool("has_local_disks", analysis.HasLocalDisks).
			Strs("local_storages", analysis.LocalStorages).
			Int64("local_size_bytes", analysis.TotalLocalSize).
			Msg("VM excluded from DRS: has local storage")
	}

	return analysis.MigrationSafe
}

func calculateImbalance(nodes []NodeScore) float64 {
	if len(nodes) == 0 {
		return 0
	}

	var sum float64
	for _, n := range nodes {
		sum += n.Score
	}
	mean := sum / float64(len(nodes))

	var variance float64
	for _, n := range nodes {
		diff := n.Score - mean
		variance += diff * diff
	}
	variance /= float64(len(nodes))

	// Standard deviation
	return variance // Simplified - use math.Sqrt for actual stddev
}

func generateID() string {
	return time.Now().Format("20060102150405") + "-" + randomString(6)
}

func randomString(n int) string {
	const letters = "abcdefghijklmnopqrstuvwxyz0123456789"
	b := make([]byte, n)
	for i := range b {
		b[i] = letters[time.Now().UnixNano()%int64(len(letters))]
	}
	return string(b)
}

// sqrtApprox calculates an approximate square root using Newton's method
func sqrtApprox(x float64) float64 {
	if x <= 0 {
		return 0
	}
	z := x / 2 // Initial guess
	for i := 0; i < 10; i++ {
		z = (z + x/z) / 2
	}
	return z
}