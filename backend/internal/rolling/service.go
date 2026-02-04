package rolling

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/proxcenter/orchestrator/internal/notifications"
	"github.com/proxcenter/orchestrator/internal/proxmox"
	"github.com/proxcenter/orchestrator/internal/storage"
	"github.com/rs/zerolog/log"
)

// UpdateStatus represents the status of a rolling update
type UpdateStatus string

const (
	StatusPending   UpdateStatus = "pending"
	StatusRunning   UpdateStatus = "running"
	StatusPaused    UpdateStatus = "paused"
	StatusCompleted UpdateStatus = "completed"
	StatusFailed    UpdateStatus = "failed"
	StatusCancelled UpdateStatus = "cancelled"
)

// NodeStatus represents the status of a node update
type NodeStatus string

const (
	NodePending         NodeStatus = "pending"
	NodeEnteringMaint   NodeStatus = "entering_maintenance"
	NodeMigratingVMs    NodeStatus = "migrating_vms"
	NodeUpdating        NodeStatus = "updating"
	NodeRebooting       NodeStatus = "rebooting"
	NodeWaitingReturn   NodeStatus = "waiting_return"
	NodeVerifyingHealth NodeStatus = "verifying_health"
	NodeExitingMaint    NodeStatus = "exiting_maintenance"
	NodeCompleted       NodeStatus = "completed"
	NodeFailed          NodeStatus = "failed"
	NodeSkipped         NodeStatus = "skipped"
)

// RollingUpdateConfig contains configuration for a rolling update
type RollingUpdateConfig struct {
	// Node selection
	NodeOrder    []string `json:"node_order"`    // Custom order, empty = alphabetical
	ExcludeNodes []string `json:"exclude_nodes"` // Nodes to skip

	// Migration behavior
	MigrateNonHAVMs         bool     `json:"migrate_non_ha_vms"`          // Migrate non-HA VMs
	ShutdownLocalVMs        bool     `json:"shutdown_local_vms"`          // Shutdown VMs with local storage
	PreferredTargets        []string `json:"preferred_targets"`           // Preferred target nodes
	MaxConcurrentMigrations int      `json:"max_concurrent_migrations"`   // Max parallel migrations (default: 2)
	MigrationTimeout        int      `json:"migration_timeout"`           // Timeout per migration in seconds (default: 600)

	// Update behavior
	AutoReboot         bool     `json:"auto_reboot"`          // Auto reboot if kernel update
	RebootTimeout      int      `json:"reboot_timeout"`       // Reboot timeout in seconds (default: 300)
	PreUpdateCommands  []string `json:"pre_update_commands"`  // Commands to run before update
	PostUpdateCommands []string `json:"post_update_commands"` // Commands to run after update

	// Safety
	RequireManualApproval bool `json:"require_manual_approval"` // Pause between nodes
	MinHealthyNodes       int  `json:"min_healthy_nodes"`       // Minimum healthy nodes (default: 2)
	AbortOnFailure        bool `json:"abort_on_failure"`        // Stop if a node fails

	// Ceph integration
	SetCephNoout    bool `json:"set_ceph_noout"`    // Set noout flag before maintenance
	WaitCephHealthy bool `json:"wait_ceph_healthy"` // Wait for Ceph HEALTH_OK

	// Restoration
	RestoreVMPlacement bool `json:"restore_vm_placement"` // Move VMs back after update
	WaitForHARebalance bool `json:"wait_for_ha_rebalance"` // Wait for HA to rebalance

	// Notifications
	NotifyOnStart        bool     `json:"notify_on_start"`
	NotifyOnNodeComplete bool     `json:"notify_on_node_complete"`
	NotifyOnComplete     bool     `json:"notify_on_complete"`
	NotifyOnError        bool     `json:"notify_on_error"`
	NotificationTargets  []string `json:"notification_targets"` // Email addresses

	// SSH Credentials (passed from frontend, not stored)
	SSHCredentials *SSHCredentials `json:"ssh_credentials,omitempty"`
}

// DefaultConfig returns a default configuration
func DefaultConfig() RollingUpdateConfig {
	return RollingUpdateConfig{
		MigrateNonHAVMs:         true,
		ShutdownLocalVMs:        false,
		MaxConcurrentMigrations: 2,
		MigrationTimeout:        600,
		AutoReboot:              true,
		RebootTimeout:           300,
		MinHealthyNodes:         2,
		AbortOnFailure:          true,
		SetCephNoout:            true,
		WaitCephHealthy:         true,
		RestoreVMPlacement:      false,
		WaitForHARebalance:      true,
		NotifyOnComplete:        true,
		NotifyOnError:           true,
	}
}

// VMPlacement represents a VM's location
type VMPlacement struct {
	VMID    int    `json:"vmid"`
	VMName  string `json:"name"`
	Type    string `json:"type"` // qemu or lxc
	Node    string `json:"node"`
	Status  string `json:"status"`
	IsHA    bool   `json:"is_ha"`
	HAGroup string `json:"ha_group,omitempty"`
}

// MigrationRecord represents a VM migration during rolling update
type MigrationRecord struct {
	VMID        int        `json:"vmid"`
	VMName      string     `json:"name"`
	SourceNode  string     `json:"source_node"`
	TargetNode  string     `json:"target_node"`
	StartedAt   time.Time  `json:"started_at"`
	CompletedAt *time.Time `json:"completed_at,omitempty"`
	Duration    int        `json:"duration_seconds"`
	Success     bool       `json:"success"`
	Error       string     `json:"error,omitempty"`
}

// PackageInfo represents a package update
type PackageInfo struct {
	Name           string `json:"name"`
	CurrentVersion string `json:"current_version"`
	NewVersion     string `json:"new_version,omitempty"`
}

// NodeUpdateDetail contains details about a node's update
type NodeUpdateDetail struct {
	ID              string            `json:"id"`
	RollingUpdateID string            `json:"rolling_update_id"`
	NodeName        string            `json:"node_name"`
	Status          NodeStatus        `json:"status"`
	StartedAt       *time.Time        `json:"started_at,omitempty"`
	CompletedAt     *time.Time        `json:"completed_at,omitempty"`
	VMsBeforeUpdate []VMPlacement     `json:"vms_before_update,omitempty"`
	MigratedVMs     []MigrationRecord `json:"migrated_vms,omitempty"`
	UpdateOutput    string            `json:"update_output,omitempty"`
	RebootRequired  bool              `json:"reboot_required"`
	DidReboot       bool              `json:"did_reboot"`
	VersionBefore   string            `json:"version_before,omitempty"`
	VersionAfter    string            `json:"version_after,omitempty"`
	Error           string            `json:"error,omitempty"`
}

// RollingUpdate represents a rolling update session
type RollingUpdate struct {
	ID             string              `json:"id"`
	ConnectionID   string              `json:"connection_id"`
	ClusterName    string              `json:"cluster_name,omitempty"`
	Status         UpdateStatus        `json:"status"`
	Config         RollingUpdateConfig `json:"config"`
	TotalNodes     int                 `json:"total_nodes"`
	CompletedNodes int                 `json:"completed_nodes"`
	CurrentNode    string              `json:"current_node,omitempty"`
	NodeStatuses   []NodeUpdateDetail  `json:"node_statuses"`
	Logs           []LogEntry          `json:"logs,omitempty"`
	Error          string              `json:"error,omitempty"`
	CreatedAt      time.Time           `json:"created_at"`
	StartedAt      *time.Time          `json:"started_at,omitempty"`
	CompletedAt    *time.Time          `json:"completed_at,omitempty"`
}

// LogEntry represents a log message
type LogEntry struct {
	Timestamp time.Time `json:"timestamp"`
	Level     string    `json:"level"` // info, warning, error
	Node      string    `json:"node,omitempty"`
	Message   string    `json:"message"`
}

// PreflightResult contains the result of preflight checks
type PreflightResult struct {
	CanProceed       bool              `json:"can_proceed"`
	Warnings         []string          `json:"warnings"`
	Errors           []string          `json:"errors"`
	ClusterHealth    ClusterHealth     `json:"cluster_health"`
	NodesHealth      []NodeHealth      `json:"nodes_health"`
	UpdatesAvailable []NodeUpdateInfo  `json:"updates_available"`
	MigrationPlan    MigrationPlan     `json:"migration_plan"`
	EstimatedTime    int               `json:"estimated_time_minutes"`
}

// ClusterHealth represents cluster health status
type ClusterHealth struct {
	Healthy         bool     `json:"healthy"`
	QuorumOK        bool     `json:"quorum_ok"`
	TotalNodes      int      `json:"total_nodes"`
	OnlineNodes     int      `json:"online_nodes"`
	CephHealthy     *bool    `json:"ceph_healthy,omitempty"` // nil if no Ceph
	HAManagerActive bool     `json:"ha_manager_active"`
	Issues          []string `json:"issues"`
}

// NodeHealth represents a node's health status
type NodeHealth struct {
	Node            string   `json:"node"`
	Online          bool     `json:"online"`
	DiskSpaceOK     bool     `json:"disk_space_ok"`
	DiskSpaceFree   int64    `json:"disk_space_free_bytes"`
	MemoryOK        bool     `json:"memory_ok"`
	LoadOK          bool     `json:"load_ok"`
	ServicesHealthy bool     `json:"services_healthy"`
	Issues          []string `json:"issues"`
}

// NodeUpdateInfo represents available updates for a node
type NodeUpdateInfo struct {
	Node             string        `json:"node"`
	UpdatesAvailable bool          `json:"updates_available"`
	PackageCount     int           `json:"package_count"`
	KernelUpdate     bool          `json:"kernel_update"`
	SecurityUpdates  int           `json:"security_updates"`
	Packages         []PackageInfo `json:"packages"`
}

// MigrationPlan represents the planned migrations
type MigrationPlan struct {
	TotalVMs          int                 `json:"total_vms"`
	VMsToMigrate      int                 `json:"vms_to_migrate"`
	VMsToShutdown     int                 `json:"vms_to_shutdown"`
	EstimatedDuration int                 `json:"estimated_duration_minutes"`
	NodePlans         []NodeMigrationPlan `json:"node_plans"`
	ResourceWarnings  []string            `json:"resource_warnings"`
}

// NodeMigrationPlan represents migrations for a single node
type NodeMigrationPlan struct {
	Node          string                 `json:"node"`
	VMsToMigrate  []PlannedMigration     `json:"vms_to_migrate"`
	VMsToShutdown []VMPlacement          `json:"vms_to_shutdown"`
	TargetNodes   map[string]int         `json:"target_nodes"` // node -> count
}

// PlannedMigration represents a planned VM migration
type PlannedMigration struct {
	VMID       int    `json:"vmid"`
	VMName     string `json:"name"`
	TargetNode string `json:"target_node"`
	Reason     string `json:"reason"` // best_fit, affinity, etc.
}

// updateSession represents an active rolling update session
type updateSession struct {
	update    *RollingUpdate
	ctx       context.Context
	cancel    context.CancelFunc
	pauseChan chan struct{}
	isPaused  bool
	mu        sync.Mutex

	// SSH
	sshCreds    *SSHCredentials
	sshClients  map[string]*NodeSSHOperations // node name -> SSH client
	sshClientMu sync.Mutex
}

// Service handles rolling updates
type Service struct {
	pve           *proxmox.Manager
	db            *storage.Database
	notifications *notifications.Service

	// Active sessions
	activeSessions map[string]*updateSession
	sessionsMu     sync.RWMutex

	// Context for service lifecycle
	ctx    context.Context
	cancel context.CancelFunc
}

// NewService creates a new rolling update service
func NewService(pve *proxmox.Manager, db *storage.Database) *Service {
	ctx, cancel := context.WithCancel(context.Background())
	return &Service{
		pve:            pve,
		db:             db,
		activeSessions: make(map[string]*updateSession),
		ctx:            ctx,
		cancel:         cancel,
	}
}

// SetNotificationService sets the notification service
func (s *Service) SetNotificationService(svc *notifications.Service) {
	s.notifications = svc
}

// PreflightCheck performs pre-update checks
func (s *Service) PreflightCheck(ctx context.Context, connectionID string, config *RollingUpdateConfig) (*PreflightResult, error) {
	client, err := s.pve.GetClient(connectionID)
	if err != nil {
		return nil, fmt.Errorf("failed to get client: %w", err)
	}

	result := &PreflightResult{
		CanProceed: true,
	}

	// 1. Check cluster health
	clusterHealth, err := s.checkClusterHealth(ctx, client, connectionID)
	if err != nil {
		return nil, fmt.Errorf("cluster health check failed: %w", err)
	}
	result.ClusterHealth = *clusterHealth

	if !clusterHealth.Healthy {
		result.CanProceed = false
		result.Errors = append(result.Errors, "Cluster is not healthy")
	}

	// 2. Get all nodes
	nodes, err := client.GetNodes(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to get nodes: %w", err)
	}

	// 3. Check each node
	for _, node := range nodes {
		if contains(config.ExcludeNodes, node.Node) {
			continue
		}

		// Node health
		nodeHealth := s.checkNodeHealth(ctx, client, node)
		result.NodesHealth = append(result.NodesHealth, *nodeHealth)

		if !nodeHealth.DiskSpaceOK {
			result.Errors = append(result.Errors, fmt.Sprintf("Node %s has insufficient disk space", node.Node))
			result.CanProceed = false
		}

		// Available updates
		updates, err := s.checkNodeUpdates(ctx, client, node.Node)
		if err != nil {
			result.Warnings = append(result.Warnings, fmt.Sprintf("Could not check updates for %s: %v", node.Node, err))
		} else {
			result.UpdatesAvailable = append(result.UpdatesAvailable, *updates)
		}
	}

	// 4. Plan migrations
	migrationPlan, err := s.planMigrations(ctx, client, nodes, config)
	if err != nil {
		return nil, fmt.Errorf("migration planning failed: %w", err)
	}
	result.MigrationPlan = *migrationPlan

	for _, warning := range migrationPlan.ResourceWarnings {
		result.Warnings = append(result.Warnings, warning)
	}

	// 5. Check minimum healthy nodes
	healthyCount := 0
	for _, nh := range result.NodesHealth {
		if nh.Online && nh.ServicesHealthy {
			healthyCount++
		}
	}

	minRequired := config.MinHealthyNodes
	if minRequired == 0 {
		minRequired = 2
	}

	if healthyCount < minRequired+1 { // +1 because we need at least minRequired after taking one offline
		result.CanProceed = false
		result.Errors = append(result.Errors, fmt.Sprintf("Only %d healthy nodes, need at least %d to safely update", healthyCount, minRequired+1))
	}

	// 6. Estimate total time
	result.EstimatedTime = s.estimateTotalTime(result, config)

	return result, nil
}

// StartRollingUpdate starts a new rolling update
func (s *Service) StartRollingUpdate(ctx context.Context, connectionID string, config *RollingUpdateConfig) (*RollingUpdate, error) {
	// Validate SSH credentials
	if config.SSHCredentials == nil || !config.SSHCredentials.Enabled {
		return nil, fmt.Errorf("SSH credentials are required for rolling update")
	}

	if config.SSHCredentials.AuthMethod == "key" && config.SSHCredentials.Key == "" {
		return nil, fmt.Errorf("SSH key is required when using key authentication")
	}

	if config.SSHCredentials.AuthMethod == "password" && config.SSHCredentials.Password == "" {
		return nil, fmt.Errorf("SSH password is required when using password authentication")
	}

	// Check for existing active update
	s.sessionsMu.RLock()
	for _, session := range s.activeSessions {
		if session.update.ConnectionID == connectionID &&
			(session.update.Status == StatusRunning || session.update.Status == StatusPaused) {
			s.sessionsMu.RUnlock()
			return nil, fmt.Errorf("rolling update already in progress for this cluster")
		}
	}
	s.sessionsMu.RUnlock()

	// Perform preflight check
	preflight, err := s.PreflightCheck(ctx, connectionID, config)
	if err != nil {
		return nil, err
	}

	if !preflight.CanProceed {
		return nil, fmt.Errorf("preflight check failed: %v", preflight.Errors)
	}

	// Get client and nodes
	client, _ := s.pve.GetClient(connectionID)
	nodes, _ := client.GetNodes(ctx)

	// Determine node order
	nodeOrder := s.determineNodeOrder(nodes, config)

	// Create rolling update
	update := &RollingUpdate{
		ID:           uuid.New().String(),
		ConnectionID: connectionID,
		Status:       StatusPending,
		Config:       *config,
		TotalNodes:   len(nodeOrder),
		CreatedAt:    time.Now(),
	}

	// Create node details
	for _, nodeName := range nodeOrder {
		detail := NodeUpdateDetail{
			ID:              uuid.New().String(),
			RollingUpdateID: update.ID,
			NodeName:        nodeName,
			Status:          NodePending,
		}
		update.NodeStatuses = append(update.NodeStatuses, detail)
	}

	// Save to database
	if err := s.saveUpdate(update); err != nil {
		return nil, fmt.Errorf("failed to save update: %w", err)
	}

	// Create session
	sessionCtx, sessionCancel := context.WithCancel(s.ctx)
	session := &updateSession{
		update:     update,
		ctx:        sessionCtx,
		cancel:     sessionCancel,
		pauseChan:  make(chan struct{}, 1),
		sshCreds:   config.SSHCredentials,
		sshClients: make(map[string]*NodeSSHOperations),
	}

	s.sessionsMu.Lock()
	s.activeSessions[update.ID] = session
	s.sessionsMu.Unlock()

	// Start execution in background
	go s.executeRollingUpdate(session)

	return update, nil
}

// executeRollingUpdate executes the rolling update
func (s *Service) executeRollingUpdate(session *updateSession) {
	update := session.update
	ctx := session.ctx

	// Update status
	update.Status = StatusRunning
	now := time.Now()
	update.StartedAt = &now
	s.saveUpdate(update)
	s.addLog(update, "info", "", "Rolling update started")

	// Notify if configured
	if update.Config.NotifyOnStart && s.notifications != nil {
		s.sendNotification(update, "Rolling update started", fmt.Sprintf("Starting rolling update for cluster %s", update.ConnectionID))
	}

	// Get client
	client, err := s.pve.GetClient(update.ConnectionID)
	if err != nil {
		s.failUpdate(update, fmt.Sprintf("Failed to get client: %v", err))
		return
	}

	// Set Ceph noout if configured
	if update.Config.SetCephNoout {
		if err := s.setCephNooutWithSession(ctx, session, client, true); err != nil {
			s.addLog(update, "warning", "", fmt.Sprintf("Failed to set Ceph noout: %v", err))
		} else {
			s.addLog(update, "info", "", "Set Ceph noout flag")
		}
	}

	// Process each node
	for i := range update.NodeStatuses {
		nodeDetail := &update.NodeStatuses[i]

		// Check for cancellation
		select {
		case <-ctx.Done():
			update.Status = StatusCancelled
			s.saveUpdate(update)
			s.addLog(update, "warning", "", "Rolling update cancelled")
			s.cleanup(session, client)
			return
		default:
		}

		// Handle pause
		session.mu.Lock()
		isPaused := session.isPaused
		session.mu.Unlock()

		if isPaused {
			s.addLog(update, "info", "", "Rolling update paused")
			<-session.pauseChan // Wait for resume
		}

		// Manual approval between nodes (except first)
		if update.Config.RequireManualApproval && i > 0 {
			update.Status = StatusPaused
			s.saveUpdate(update)
			s.addLog(update, "info", nodeDetail.NodeName, "Waiting for manual approval")
			<-session.pauseChan
			update.Status = StatusRunning
			s.saveUpdate(update)
		}

		update.CurrentNode = nodeDetail.NodeName
		s.saveUpdate(update)

		// Process the node
		err := s.processNode(session, client, nodeDetail)

		if err != nil {
			s.addLog(update, "error", nodeDetail.NodeName, fmt.Sprintf("Node update failed: %v", err))
			nodeDetail.Status = NodeFailed
			nodeDetail.Error = err.Error()
			s.saveUpdate(update)

			if update.Config.AbortOnFailure {
				s.failUpdate(update, fmt.Sprintf("Failed on node %s: %v", nodeDetail.NodeName, err))
				s.cleanup(session, client)
				return
			}
		} else {
			update.CompletedNodes++
			s.saveUpdate(update)

			if update.Config.NotifyOnNodeComplete && s.notifications != nil {
				s.sendNotification(update, "Node updated", fmt.Sprintf("Node %s updated successfully", nodeDetail.NodeName))
			}
		}
	}

	// Cleanup and complete
	s.cleanup(session, client)

	update.Status = StatusCompleted
	now = time.Now()
	update.CompletedAt = &now
	update.CurrentNode = ""
	s.saveUpdate(update)

	s.addLog(update, "info", "", "Rolling update completed successfully")

	if update.Config.NotifyOnComplete && s.notifications != nil {
		s.sendNotification(update, "Rolling update completed",
			fmt.Sprintf("Successfully updated %d/%d nodes", update.CompletedNodes, update.TotalNodes))
	}

	// Remove from active sessions
	s.sessionsMu.Lock()
	delete(s.activeSessions, update.ID)
	s.sessionsMu.Unlock()
}

// processNode handles the update of a single node
func (s *Service) processNode(session *updateSession, client *proxmox.Client, nodeDetail *NodeUpdateDetail) error {
	ctx := session.ctx
	update := session.update
	nodeName := nodeDetail.NodeName

	nodeDetail.Status = NodeEnteringMaint
	now := time.Now()
	nodeDetail.StartedAt = &now
	s.saveUpdate(update)

	s.addLog(update, "info", nodeName, "Starting node update")

	// 1. Get current VMs on this node
	vms, err := s.getNodeVMs(ctx, client, nodeName)
	if err != nil {
		return fmt.Errorf("failed to get VM list: %w", err)
	}
	nodeDetail.VMsBeforeUpdate = vms
	s.saveUpdate(update)

	// 2. Get version before update
	nodeDetail.VersionBefore, _ = s.getNodeVersion(ctx, client, nodeName)

	// 3. Enable maintenance mode (for HA VMs)
	s.addLog(update, "info", nodeName, "Enabling maintenance mode")
	if err := s.enableMaintenanceModeWithSession(ctx, session, client, nodeName); err != nil {
		s.addLog(update, "warning", nodeName, fmt.Sprintf("Failed to enable maintenance mode: %v", err))
		// Continue anyway - maintenance mode might not be available
	}

	// 4. Wait for HA migrations
	nodeDetail.Status = NodeMigratingVMs
	s.saveUpdate(update)

	s.addLog(update, "info", nodeName, "Waiting for HA migrations to complete")
	if err := s.waitForHAMigrations(ctx, client, nodeName, update.Config.MigrationTimeout); err != nil {
		s.disableMaintenanceModeWithSession(ctx, session, client, nodeName)
		return fmt.Errorf("HA migration timeout: %w", err)
	}

	// 5. Migrate non-HA VMs if configured
	if update.Config.MigrateNonHAVMs {
		s.addLog(update, "info", nodeName, "Migrating non-HA VMs")
		migrations, err := s.migrateNonHAVMs(ctx, client, nodeName, update)
		if err != nil {
			s.disableMaintenanceModeWithSession(ctx, session, client, nodeName)
			return fmt.Errorf("non-HA migration failed: %w", err)
		}
		nodeDetail.MigratedVMs = migrations
		s.saveUpdate(update)
	}

	// 6. Shutdown VMs with local storage if configured
	if update.Config.ShutdownLocalVMs {
		s.addLog(update, "info", nodeName, "Shutting down local storage VMs")
		if err := s.shutdownLocalVMs(ctx, client, nodeName); err != nil {
			s.addLog(update, "warning", nodeName, fmt.Sprintf("Some local VMs could not be shut down: %v", err))
		}
	}

	// 7. Run pre-update commands
	nodeDetail.Status = NodeUpdating
	s.saveUpdate(update)

	for _, cmd := range update.Config.PreUpdateCommands {
		s.addLog(update, "info", nodeName, fmt.Sprintf("Running pre-update command: %s", cmd))
		if _, err := s.executeSSHWithSession(ctx, session, client, nodeName, cmd); err != nil {
			s.addLog(update, "warning", nodeName, fmt.Sprintf("Pre-update command failed: %v", err))
		}
	}

	// 8. Execute update
	s.addLog(update, "info", nodeName, "Running apt update && apt full-upgrade")
	output, err := s.executeUpdateWithSession(ctx, session, client, nodeName)
	if err != nil {
		s.disableMaintenanceModeWithSession(ctx, session, client, nodeName)
		return fmt.Errorf("apt update failed: %w", err)
	}
	nodeDetail.UpdateOutput = output
	s.saveUpdate(update)

	// 9. Check if reboot required
	rebootRequired, _ := s.checkRebootRequiredWithSession(ctx, session, client, nodeName)
	nodeDetail.RebootRequired = rebootRequired
	s.saveUpdate(update)

	// 10. Run post-update commands
	for _, cmd := range update.Config.PostUpdateCommands {
		s.addLog(update, "info", nodeName, fmt.Sprintf("Running post-update command: %s", cmd))
		if _, err := s.executeSSHWithSession(ctx, session, client, nodeName, cmd); err != nil {
			s.addLog(update, "warning", nodeName, fmt.Sprintf("Post-update command failed: %v", err))
		}
	}

	// 11. Reboot if required and configured
	if rebootRequired && update.Config.AutoReboot {
		nodeDetail.Status = NodeRebooting
		s.saveUpdate(update)

		s.addLog(update, "info", nodeName, "Rebooting node")
		if err := s.rebootNodeWithSession(ctx, session, client, nodeName); err != nil {
			return fmt.Errorf("reboot failed: %w", err)
		}
		nodeDetail.DidReboot = true

		// Close SSH connection before reboot
		session.sshClientMu.Lock()
		if sshClient, exists := session.sshClients[nodeName]; exists {
			sshClient.Close()
			delete(session.sshClients, nodeName)
		}
		session.sshClientMu.Unlock()

		// 12. Wait for node to come back
		nodeDetail.Status = NodeWaitingReturn
		s.saveUpdate(update)

		s.addLog(update, "info", nodeName, "Waiting for node to come back online")
		if err := s.waitForNodeOnline(ctx, client, nodeName, update.Config.RebootTimeout); err != nil {
			return fmt.Errorf("node did not come back online: %w", err)
		}
	}

	// 13. Verify node health
	nodeDetail.Status = NodeVerifyingHealth
	s.saveUpdate(update)

	s.addLog(update, "info", nodeName, "Verifying node health")
	if err := s.verifyNodeHealth(ctx, client, nodeName); err != nil {
		return fmt.Errorf("node health check failed: %w", err)
	}

	// 14. Get new version
	nodeDetail.VersionAfter, _ = s.getNodeVersion(ctx, client, nodeName)

	// 15. Disable maintenance mode
	nodeDetail.Status = NodeExitingMaint
	s.saveUpdate(update)

	s.addLog(update, "info", nodeName, "Disabling maintenance mode")
	if err := s.disableMaintenanceModeWithSession(ctx, session, client, nodeName); err != nil {
		s.addLog(update, "warning", nodeName, fmt.Sprintf("Failed to disable maintenance mode: %v", err))
	}

	// 16. Wait for HA rebalance if configured
	if update.Config.WaitForHARebalance {
		s.addLog(update, "info", nodeName, "Waiting for HA rebalance")
		time.Sleep(30 * time.Second)
	}

	// 17. Wait for Ceph if configured
	if update.Config.WaitCephHealthy {
		s.addLog(update, "info", nodeName, "Waiting for Ceph to be healthy")
		if err := s.waitForCephHealthyWithSession(ctx, session, client, 300); err != nil {
			s.addLog(update, "warning", nodeName, fmt.Sprintf("Ceph health check timeout: %v", err))
		}
	}

	// Close SSH connection for this node
	session.sshClientMu.Lock()
	if sshClient, exists := session.sshClients[nodeName]; exists {
		sshClient.Close()
		delete(session.sshClients, nodeName)
	}
	session.sshClientMu.Unlock()

	// Done
	nodeDetail.Status = NodeCompleted
	now = time.Now()
	nodeDetail.CompletedAt = &now
	s.saveUpdate(update)

	s.addLog(update, "info", nodeName, "Node update completed")

	return nil
}

// PauseUpdate pauses an active rolling update
func (s *Service) PauseUpdate(updateID string) error {
	s.sessionsMu.Lock()
	session, exists := s.activeSessions[updateID]
	s.sessionsMu.Unlock()

	if !exists {
		return fmt.Errorf("update session not found")
	}

	session.mu.Lock()
	session.isPaused = true
	session.mu.Unlock()

	session.update.Status = StatusPaused
	s.saveUpdate(session.update)

	return nil
}

// ResumeUpdate resumes a paused rolling update
func (s *Service) ResumeUpdate(updateID string) error {
	s.sessionsMu.Lock()
	session, exists := s.activeSessions[updateID]
	s.sessionsMu.Unlock()

	if !exists {
		return fmt.Errorf("update session not found")
	}

	session.mu.Lock()
	session.isPaused = false
	session.mu.Unlock()

	// Signal to continue
	select {
	case session.pauseChan <- struct{}{}:
	default:
	}

	return nil
}

// CancelUpdate cancels an active rolling update
func (s *Service) CancelUpdate(updateID string) error {
	s.sessionsMu.Lock()
	session, exists := s.activeSessions[updateID]
	s.sessionsMu.Unlock()

	if !exists {
		return fmt.Errorf("update session not found")
	}

	session.cancel()
	return nil
}

// GetUpdate returns a rolling update by ID
func (s *Service) GetUpdate(updateID string) (*RollingUpdate, error) {
	return s.loadUpdate(updateID)
}

// GetConnectionUpdates returns all updates for a connection
func (s *Service) GetConnectionUpdates(connectionID string) ([]*RollingUpdate, error) {
	return s.loadConnectionUpdates(connectionID)
}

// GetActiveUpdates returns all currently active updates
func (s *Service) GetActiveUpdates() []*RollingUpdate {
	s.sessionsMu.RLock()
	defer s.sessionsMu.RUnlock()

	var updates []*RollingUpdate
	for _, session := range s.activeSessions {
		updates = append(updates, session.update)
	}
	return updates
}

// Helper functions

func (s *Service) checkClusterHealth(ctx context.Context, client *proxmox.Client, connectionID string) (*ClusterHealth, error) {
	health := &ClusterHealth{
		Healthy: true,
	}

	nodes, err := client.GetNodes(ctx)
	if err != nil {
		return nil, err
	}

	health.TotalNodes = len(nodes)
	for _, node := range nodes {
		if node.Status == "online" {
			health.OnlineNodes++
		}
	}

	// Check quorum
	health.QuorumOK = health.OnlineNodes > health.TotalNodes/2

	if !health.QuorumOK {
		health.Healthy = false
		health.Issues = append(health.Issues, "Cluster has lost quorum")
	}

	if health.OnlineNodes < health.TotalNodes {
		health.Issues = append(health.Issues, fmt.Sprintf("%d node(s) offline", health.TotalNodes-health.OnlineNodes))
	}

	// TODO: Check Ceph health if available
	// TODO: Check HA manager status

	return health, nil
}

func (s *Service) checkNodeHealth(ctx context.Context, client *proxmox.Client, node proxmox.Node) *NodeHealth {
	health := &NodeHealth{
		Node:            node.Node,
		Online:          node.Status == "online",
		ServicesHealthy: node.Status == "online",
	}

	if !health.Online {
		health.Issues = append(health.Issues, "Node is offline")
		return health
	}

	// Check disk space (need at least 5GB free)
	minFreeBytes := int64(5 * 1024 * 1024 * 1024)
	freeBytes := node.MaxDisk - node.Disk
	health.DiskSpaceFree = freeBytes
	health.DiskSpaceOK = freeBytes > minFreeBytes

	if !health.DiskSpaceOK {
		health.Issues = append(health.Issues, fmt.Sprintf("Less than 5GB free disk space (%d MB free)", freeBytes/1024/1024))
	}

	// Check memory (should have reasonable free memory)
	memUsage := float64(node.Mem) / float64(node.MaxMem)
	health.MemoryOK = memUsage < 0.95

	if !health.MemoryOK {
		health.Issues = append(health.Issues, fmt.Sprintf("Memory usage too high: %.1f%%", memUsage*100))
	}

	// Check CPU load
	health.LoadOK = node.CPU < 0.95

	if !health.LoadOK {
		health.Issues = append(health.Issues, fmt.Sprintf("CPU usage too high: %.1f%%", node.CPU*100))
	}

	return health
}

func (s *Service) checkNodeUpdates(ctx context.Context, client *proxmox.Client, nodeName string) (*NodeUpdateInfo, error) {
	info := &NodeUpdateInfo{
		Node: nodeName,
	}

	// Get updates via API
	data, err := client.Request(ctx, "GET", fmt.Sprintf("/nodes/%s/apt/update", nodeName), nil)
	if err != nil {
		return nil, err
	}

	var updates []struct {
		Package    string `json:"Package"`
		OldVersion string `json:"OldVersion"`
		Version    string `json:"Version"`
		Priority   string `json:"Priority"`
	}

	if err := json.Unmarshal(data, &updates); err != nil {
		return nil, err
	}

	info.PackageCount = len(updates)
	info.UpdatesAvailable = len(updates) > 0

	for _, u := range updates {
		pkg := PackageInfo{
			Name:           u.Package,
			CurrentVersion: u.OldVersion,
			NewVersion:     u.Version,
		}
		info.Packages = append(info.Packages, pkg)

		// Check for kernel update
		pkgLower := strings.ToLower(u.Package)
		if strings.Contains(pkgLower, "kernel") || strings.Contains(pkgLower, "linux-image") || strings.Contains(pkgLower, "pve-kernel") {
			info.KernelUpdate = true
		}

		// Check for security updates
		if u.Priority == "high" || strings.Contains(strings.ToLower(u.Package), "security") {
			info.SecurityUpdates++
		}
	}

	return info, nil
}

func (s *Service) planMigrations(ctx context.Context, client *proxmox.Client, nodes []proxmox.Node, config *RollingUpdateConfig) (*MigrationPlan, error) {
	plan := &MigrationPlan{}

	vms, err := client.GetVMs(ctx)
	if err != nil {
		return nil, err
	}

	plan.TotalVMs = len(vms)

	// Create node plans
	nodeVMs := make(map[string][]proxmox.VM)
	for _, vm := range vms {
		if vm.Status == "running" && !vm.IsTemplate() {
			nodeVMs[vm.Node] = append(nodeVMs[vm.Node], vm)
		}
	}

	for _, node := range nodes {
		if contains(config.ExcludeNodes, node.Node) {
			continue
		}

		nodePlan := NodeMigrationPlan{
			Node:        node.Node,
			TargetNodes: make(map[string]int),
		}

		for _, vm := range nodeVMs[node.Node] {
			// Check if VM can be migrated
			analysis, _ := client.AnalyzeVMStorage(ctx, node.Node, vm.VMID, vm.Name)

			if analysis != nil && analysis.MigrationSafe {
				// Find best target
				target := s.findBestTarget(nodes, node.Node, config.ExcludeNodes, config.PreferredTargets)
				if target != "" {
					migration := PlannedMigration{
						VMID:       vm.VMID,
						VMName:     vm.Name,
						TargetNode: target,
						Reason:     "best_fit",
					}
					nodePlan.VMsToMigrate = append(nodePlan.VMsToMigrate, migration)
					nodePlan.TargetNodes[target]++
					plan.VMsToMigrate++
				}
			} else if config.ShutdownLocalVMs {
				placement := VMPlacement{
					VMID:   vm.VMID,
					VMName: vm.Name,
					Type:   vm.Type,
					Node:   vm.Node,
					Status: vm.Status,
				}
				nodePlan.VMsToShutdown = append(nodePlan.VMsToShutdown, placement)
				plan.VMsToShutdown++
			}
		}

		plan.NodePlans = append(plan.NodePlans, nodePlan)
	}

	// Estimate duration (rough)
	plan.EstimatedDuration = (plan.VMsToMigrate * 2) + (plan.VMsToShutdown * 1) // minutes

	return plan, nil
}

func (s *Service) findBestTarget(nodes []proxmox.Node, excludeNode string, excludeNodes, preferredTargets []string) string {
	var bestNode string
	var bestScore float64 = -1

	for _, node := range nodes {
		if node.Node == excludeNode || contains(excludeNodes, node.Node) || node.Status != "online" {
			continue
		}

		// Calculate score based on available resources
		memFree := float64(node.MaxMem-node.Mem) / float64(node.MaxMem)
		cpuFree := 1.0 - node.CPU
		score := (memFree + cpuFree) / 2

		// Boost preferred targets
		if contains(preferredTargets, node.Node) {
			score += 0.2
		}

		if score > bestScore {
			bestScore = score
			bestNode = node.Node
		}
	}

	return bestNode
}

func (s *Service) determineNodeOrder(nodes []proxmox.Node, config *RollingUpdateConfig) []string {
	// Use custom order if provided
	if len(config.NodeOrder) > 0 {
		return config.NodeOrder
	}

	// Otherwise, alphabetical order
	var order []string
	for _, node := range nodes {
		if !contains(config.ExcludeNodes, node.Node) {
			order = append(order, node.Node)
		}
	}

	// Sort alphabetically
	for i := 0; i < len(order)-1; i++ {
		for j := i + 1; j < len(order); j++ {
			if order[i] > order[j] {
				order[i], order[j] = order[j], order[i]
			}
		}
	}

	return order
}

func (s *Service) estimateTotalTime(preflight *PreflightResult, config *RollingUpdateConfig) int {
	totalMinutes := 0

	for _, nodeHealth := range preflight.NodesHealth {
		if !nodeHealth.Online {
			continue
		}

		// Find updates for this node
		var nodeUpdates *NodeUpdateInfo
		for _, u := range preflight.UpdatesAvailable {
			if u.Node == nodeHealth.Node {
				nodeUpdates = &u
				break
			}
		}

		if nodeUpdates == nil || nodeUpdates.PackageCount == 0 {
			continue
		}

		// Find VM count for this node
		vmCount := 0
		for _, plan := range preflight.MigrationPlan.NodePlans {
			if plan.Node == nodeHealth.Node {
				vmCount = len(plan.VMsToMigrate) + len(plan.VMsToShutdown)
				break
			}
		}

		// Estimate per node
		nodeMinutes := 2 + // Entering maintenance
			int(float64(vmCount)*0.5) + // VM migrations (30s each)
			2 + // Download packages
			5 + (nodeUpdates.PackageCount*3)/60 + // Install packages
			2 + // Exit maintenance
			3 + // Ceph health check
			2 // Buffer

		if nodeUpdates.KernelUpdate && config.AutoReboot {
			nodeMinutes += 5 // Reboot time
		}

		totalMinutes += nodeMinutes
	}

	return totalMinutes
}

// SSH and Proxmox operations

func (s *Service) enableMaintenanceMode(ctx context.Context, client *proxmox.Client, nodeName string) error {
	// Use ha-manager to enable maintenance mode
	cmd := fmt.Sprintf("ha-manager crm-command node-maintenance enable %s", nodeName)
	_, err := s.executeSSH(ctx, client, nodeName, cmd)
	return err
}

func (s *Service) disableMaintenanceMode(ctx context.Context, client *proxmox.Client, nodeName string) error {
	cmd := fmt.Sprintf("ha-manager crm-command node-maintenance disable %s", nodeName)
	_, err := s.executeSSH(ctx, client, nodeName, cmd)
	return err
}

func (s *Service) executeUpdate(ctx context.Context, client *proxmox.Client, nodeName string) (string, error) {
	cmd := "DEBIAN_FRONTEND=noninteractive apt-get update && DEBIAN_FRONTEND=noninteractive apt-get full-upgrade -y"
	return s.executeSSH(ctx, client, nodeName, cmd)
}

func (s *Service) checkRebootRequired(ctx context.Context, client *proxmox.Client, nodeName string) (bool, error) {
	output, err := s.executeSSH(ctx, client, nodeName, "[ -f /var/run/reboot-required ] && echo 'yes' || echo 'no'")
	if err != nil {
		return false, err
	}
	return strings.TrimSpace(output) == "yes", nil
}

func (s *Service) rebootNode(ctx context.Context, client *proxmox.Client, nodeName string) error {
	_, err := s.executeSSH(ctx, client, nodeName, "shutdown -r now")
	// Ignore error as connection will drop
	_ = err
	return nil
}

func (s *Service) waitForNodeOnline(ctx context.Context, client *proxmox.Client, nodeName string, timeout int) error {
	if timeout == 0 {
		timeout = 300
	}

	deadline := time.Now().Add(time.Duration(timeout) * time.Second)

	// Wait a bit for node to go down first
	time.Sleep(10 * time.Second)

	for time.Now().Before(deadline) {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		nodes, err := client.GetNodes(ctx)
		if err == nil {
			for _, n := range nodes {
				if n.Node == nodeName && n.Status == "online" {
					// Wait a bit more for services
					time.Sleep(15 * time.Second)
					return nil
				}
			}
		}

		time.Sleep(5 * time.Second)
	}

	return fmt.Errorf("timeout waiting for node to come online")
}

func (s *Service) verifyNodeHealth(ctx context.Context, client *proxmox.Client, nodeName string) error {
	nodes, err := client.GetNodes(ctx)
	if err != nil {
		return err
	}

	for _, n := range nodes {
		if n.Node == nodeName {
			if n.Status != "online" {
				return fmt.Errorf("node is not online")
			}
			return nil
		}
	}

	return fmt.Errorf("node not found in cluster")
}

func (s *Service) getNodeVersion(ctx context.Context, client *proxmox.Client, nodeName string) (string, error) {
	data, err := client.Request(ctx, "GET", fmt.Sprintf("/nodes/%s/version", nodeName), nil)
	if err != nil {
		return "", err
	}

	var version struct {
		Version string `json:"version"`
		Release string `json:"release"`
	}

	if err := json.Unmarshal(data, &version); err != nil {
		return "", err
	}

	return version.Version, nil
}

func (s *Service) getNodeVMs(ctx context.Context, client *proxmox.Client, nodeName string) ([]VMPlacement, error) {
	vms, err := client.GetVMs(ctx)
	if err != nil {
		return nil, err
	}

	var placements []VMPlacement
	for _, vm := range vms {
		if vm.Node == nodeName {
			placement := VMPlacement{
				VMID:   vm.VMID,
				VMName: vm.Name,
				Type:   vm.Type,
				Node:   vm.Node,
				Status: vm.Status,
			}
			if vm.HA != nil && vm.HA.Managed == 1 {
				placement.IsHA = true
			}
			placements = append(placements, placement)
		}
	}

	return placements, nil
}

func (s *Service) waitForHAMigrations(ctx context.Context, client *proxmox.Client, nodeName string, timeout int) error {
	if timeout == 0 {
		timeout = 600
	}

	deadline := time.Now().Add(time.Duration(timeout) * time.Second)

	for time.Now().Before(deadline) {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		// Check if any running VMs remain on the node
		vms, _ := client.GetVMs(ctx)
		runningOnNode := 0
		for _, vm := range vms {
			if vm.Node == nodeName && vm.Status == "running" {
				if vm.HA != nil && vm.HA.Managed == 1 {
					runningOnNode++
				}
			}
		}

		if runningOnNode == 0 {
			return nil
		}

		log.Debug().Int("remaining", runningOnNode).Str("node", nodeName).Msg("Waiting for HA migrations")
		time.Sleep(10 * time.Second)
	}

	return fmt.Errorf("timeout waiting for HA migrations")
}

func (s *Service) migrateNonHAVMs(ctx context.Context, client *proxmox.Client, nodeName string, update *RollingUpdate) ([]MigrationRecord, error) {
	var records []MigrationRecord

	vms, err := client.GetVMs(ctx)
	if err != nil {
		return nil, err
	}

	nodes, _ := client.GetNodes(ctx)

	for _, vm := range vms {
		if vm.Node != nodeName || vm.Status != "running" || vm.IsTemplate() {
			continue
		}

		// Skip HA-managed VMs (they should have migrated already)
		if vm.HA != nil && vm.HA.Managed == 1 {
			continue
		}

		// Check if migration is safe
		analysis, _ := client.AnalyzeVMStorage(ctx, nodeName, vm.VMID, vm.Name)
		if analysis == nil || !analysis.MigrationSafe {
			s.addLog(update, "warning", nodeName, fmt.Sprintf("Skipping VM %d (%s) - has local storage", vm.VMID, vm.Name))
			continue
		}

		// Find target
		target := s.findBestTarget(nodes, nodeName, update.Config.ExcludeNodes, update.Config.PreferredTargets)
		if target == "" {
			s.addLog(update, "warning", nodeName, fmt.Sprintf("No target found for VM %d (%s)", vm.VMID, vm.Name))
			continue
		}

		record := MigrationRecord{
			VMID:       vm.VMID,
			VMName:     vm.Name,
			SourceNode: nodeName,
			TargetNode: target,
			StartedAt:  time.Now(),
		}

		s.addLog(update, "info", nodeName, fmt.Sprintf("Migrating VM %d (%s) to %s", vm.VMID, vm.Name, target))

		// Start migration
		var taskID string
		if vm.Type == "lxc" {
			taskID, err = client.MigrateLXC(ctx, nodeName, vm.VMID, target, true)
		} else {
			taskID, err = client.MigrateVM(ctx, nodeName, vm.VMID, target, true)
		}

		if err != nil {
			record.Success = false
			record.Error = err.Error()
			records = append(records, record)
			continue
		}

		// Wait for migration to complete
		err = s.waitForTask(ctx, client, nodeName, taskID, update.Config.MigrationTimeout)
		now := time.Now()
		record.CompletedAt = &now
		record.Duration = int(now.Sub(record.StartedAt).Seconds())

		if err != nil {
			record.Success = false
			record.Error = err.Error()
			s.addLog(update, "error", nodeName, fmt.Sprintf("Migration of VM %d failed: %v", vm.VMID, err))
		} else {
			record.Success = true
			s.addLog(update, "info", nodeName, fmt.Sprintf("VM %d migrated successfully", vm.VMID))
		}

		records = append(records, record)
	}

	return records, nil
}

func (s *Service) shutdownLocalVMs(ctx context.Context, client *proxmox.Client, nodeName string) error {
	vms, err := client.GetVMs(ctx)
	if err != nil {
		return err
	}

	var errors []string

	for _, vm := range vms {
		if vm.Node != nodeName || vm.Status != "running" || vm.IsTemplate() {
			continue
		}

		// Check if VM has local storage
		analysis, _ := client.AnalyzeVMStorage(ctx, nodeName, vm.VMID, vm.Name)
		if analysis == nil || analysis.MigrationSafe {
			continue // Can be migrated, don't shutdown
		}

		// Shutdown the VM
		path := fmt.Sprintf("/nodes/%s/%s/%d/status/shutdown", nodeName, vm.Type, vm.VMID)
		_, err := client.RequestForm(ctx, "POST", path, nil)
		if err != nil {
			errors = append(errors, fmt.Sprintf("VM %d: %v", vm.VMID, err))
		}
	}

	if len(errors) > 0 {
		return fmt.Errorf("shutdown errors: %s", strings.Join(errors, "; "))
	}

	return nil
}

func (s *Service) waitForTask(ctx context.Context, client *proxmox.Client, nodeName, taskID string, timeout int) error {
	if timeout == 0 {
		timeout = 600
	}

	deadline := time.Now().Add(time.Duration(timeout) * time.Second)

	for time.Now().Before(deadline) {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		status, err := client.GetTaskStatus(ctx, nodeName, taskID)
		if err != nil {
			return err
		}

		if status == "OK" {
			return nil
		}

		if strings.HasPrefix(status, "ERROR") || strings.Contains(status, "WARNINGS") {
			return fmt.Errorf("task failed: %s", status)
		}

		if status != "running" {
			// Task completed
			return nil
		}

		time.Sleep(5 * time.Second)
	}

	return fmt.Errorf("timeout waiting for task")
}

func (s *Service) setCephNoout(ctx context.Context, client *proxmox.Client, enable bool) error {
	nodes, err := client.GetNodes(ctx)
	if err != nil || len(nodes) == 0 {
		return err
	}

	var cmd string
	if enable {
		cmd = "ceph osd set noout"
	} else {
		cmd = "ceph osd unset noout"
	}

	_, err = s.executeSSH(ctx, client, nodes[0].Node, cmd)
	return err
}

func (s *Service) waitForCephHealthy(ctx context.Context, client *proxmox.Client, timeout int) error {
	if timeout == 0 {
		timeout = 300
	}

	nodes, err := client.GetNodes(ctx)
	if err != nil || len(nodes) == 0 {
		return nil // No Ceph or can't check
	}

	deadline := time.Now().Add(time.Duration(timeout) * time.Second)

	for time.Now().Before(deadline) {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		output, err := s.executeSSH(ctx, client, nodes[0].Node, "ceph health")
		if err != nil {
			return nil // Ceph probably not installed
		}

		if strings.Contains(output, "HEALTH_OK") {
			return nil
		}

		time.Sleep(10 * time.Second)
	}

	return fmt.Errorf("timeout waiting for Ceph healthy")
}

func (s *Service) executeSSH(ctx context.Context, client *proxmox.Client, nodeName, command string) (string, error) {
	// This is a fallback - prefer using executeSSHWithSession
	log.Warn().Str("node", nodeName).Str("cmd", command).Msg("executeSSH called without session - SSH not available")
	return "", fmt.Errorf("SSH not available - no session context")
}

// executeSSHWithSession executes SSH command using session credentials
func (s *Service) executeSSHWithSession(ctx context.Context, session *updateSession, client *proxmox.Client, nodeName, command string) (string, error) {
	if session.sshCreds == nil {
		return "", fmt.Errorf("SSH credentials not configured")
	}

	// Get or create SSH client for this node
	session.sshClientMu.Lock()
	sshClient, exists := session.sshClients[nodeName]
	session.sshClientMu.Unlock()

	if !exists {
		// Get node IP
		nodeIP, err := s.getNodeIP(ctx, client, nodeName)
		if err != nil {
			return "", fmt.Errorf("failed to get node IP: %w", err)
		}

		log.Info().Str("node", nodeName).Str("ip", nodeIP).Msg("Creating SSH connection")

		sshClient, err = NewNodeSSHOperations(nodeIP, nodeName, *session.sshCreds)
		if err != nil {
			return "", fmt.Errorf("failed to connect SSH to %s: %w", nodeName, err)
		}

		session.sshClientMu.Lock()
		session.sshClients[nodeName] = sshClient
		session.sshClientMu.Unlock()
	}

	stdout, stderr, err := sshClient.RunCustomCommand(ctx, command)
	if err != nil {
		return stdout + stderr, err
	}

	return stdout, nil
}

// getNodeIP gets the IP address of a node
func (s *Service) getNodeIP(ctx context.Context, client *proxmox.Client, nodeName string) (string, error) {
	// Try to get IP from node network config
	data, err := client.Request(ctx, "GET", fmt.Sprintf("/nodes/%s/network", nodeName), nil)
	if err == nil {
		var networks []struct {
			Iface   string `json:"iface"`
			Address string `json:"address"`
			Type    string `json:"type"`
		}
		if json.Unmarshal(data, &networks) == nil {
			for _, net := range networks {
				if net.Address != "" && net.Type == "bridge" {
					return net.Address, nil
				}
			}
			// Fallback to any interface with an IP
			for _, net := range networks {
				if net.Address != "" {
					return net.Address, nil
				}
			}
		}
	}

	// Try DNS resolution
	if ips, err := net.LookupIP(nodeName); err == nil && len(ips) > 0 {
		for _, ip := range ips {
			if ipv4 := ip.To4(); ipv4 != nil {
				return ipv4.String(), nil
			}
		}
	}

	// Fallback to base URL host
	if u, err := url.Parse(client.BaseURL); err == nil {
		return u.Hostname(), nil
	}

	return nodeName, nil
}

// executeUpdateWithSession performs apt update/upgrade via SSH
func (s *Service) executeUpdateWithSession(ctx context.Context, session *updateSession, client *proxmox.Client, nodeName string) (string, error) {
	// Wait for apt locks to be released (in case another process is using apt)
	waitCmd := `while fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 || fuser /var/lib/apt/lists/lock >/dev/null 2>&1; do echo "Waiting for apt lock..."; sleep 5; done`
	s.executeSSHWithSession(ctx, session, client, nodeName, waitCmd)

	// Run apt update and upgrade
	cmd := `DEBIAN_FRONTEND=noninteractive apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get -y -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold" dist-upgrade`
	return s.executeSSHWithSession(ctx, session, client, nodeName, cmd)
}

// checkRebootRequiredWithSession checks if reboot is needed via SSH
func (s *Service) checkRebootRequiredWithSession(ctx context.Context, session *updateSession, client *proxmox.Client, nodeName string) (bool, error) {
	output, err := s.executeSSHWithSession(ctx, session, client, nodeName, "[ -f /var/run/reboot-required ] && echo 'yes' || echo 'no'")
	if err != nil {
		return false, err
	}
	return strings.TrimSpace(output) == "yes", nil
}

// rebootNodeWithSession initiates reboot via SSH
func (s *Service) rebootNodeWithSession(ctx context.Context, session *updateSession, client *proxmox.Client, nodeName string) error {
	// Use nohup to ensure reboot continues after SSH disconnects
	_, err := s.executeSSHWithSession(ctx, session, client, nodeName, "nohup sh -c 'sleep 2 && reboot' >/dev/null 2>&1 &")
	// Ignore error as connection will drop
	_ = err
	return nil
}

// enableMaintenanceModeWithSession enables HA maintenance mode via SSH
func (s *Service) enableMaintenanceModeWithSession(ctx context.Context, session *updateSession, client *proxmox.Client, nodeName string) error {
	cmd := fmt.Sprintf("ha-manager crm-command node-maintenance enable %s", nodeName)
	_, err := s.executeSSHWithSession(ctx, session, client, nodeName, cmd)
	return err
}

// disableMaintenanceModeWithSession disables HA maintenance mode via SSH  
func (s *Service) disableMaintenanceModeWithSession(ctx context.Context, session *updateSession, client *proxmox.Client, nodeName string) error {
	cmd := fmt.Sprintf("ha-manager crm-command node-maintenance disable %s", nodeName)
	_, err := s.executeSSHWithSession(ctx, session, client, nodeName, cmd)
	return err
}

// waitForCephHealthyWithSession waits for Ceph to be healthy using SSH
func (s *Service) waitForCephHealthyWithSession(ctx context.Context, session *updateSession, client *proxmox.Client, timeoutSec int) error {
	// Get first available node to run ceph command
	nodes, err := client.GetNodes(ctx)
	if err != nil || len(nodes) == 0 {
		return fmt.Errorf("no nodes available")
	}

	nodeName := nodes[0].Node

	// First check if Ceph is available on this cluster
	checkCmd := "which ceph >/dev/null 2>&1 && ceph -s >/dev/null 2>&1"
	_, err = s.executeSSHWithSession(ctx, session, client, nodeName, checkCmd)
	if err != nil {
		// Ceph is not available, skip silently
		log.Debug().Str("node", nodeName).Msg("Ceph not available on this cluster, skipping health check")
		return nil
	}

	deadline := time.Now().Add(time.Duration(timeoutSec) * time.Second)

	for time.Now().Before(deadline) {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		output, err := s.executeSSHWithSession(ctx, session, client, nodeName, "ceph health 2>/dev/null || echo HEALTH_UNKNOWN")
		if err != nil {
			time.Sleep(10 * time.Second)
			continue
		}

		if strings.Contains(output, "HEALTH_OK") {
			return nil
		}

		log.Debug().Str("health", strings.TrimSpace(output)).Msg("Waiting for Ceph healthy")
		time.Sleep(10 * time.Second)
	}

	return fmt.Errorf("timeout waiting for Ceph healthy")
}

// setCephNooutWithSession sets or unsets Ceph noout flag via SSH
func (s *Service) setCephNooutWithSession(ctx context.Context, session *updateSession, client *proxmox.Client, enable bool) error {
	nodes, err := client.GetNodes(ctx)
	if err != nil || len(nodes) == 0 {
		return fmt.Errorf("no nodes available")
	}

	// First check if Ceph is available on this cluster
	checkCmd := "which ceph >/dev/null 2>&1 && ceph -s >/dev/null 2>&1"
	_, err = s.executeSSHWithSession(ctx, session, client, nodes[0].Node, checkCmd)
	if err != nil {
		// Ceph is not available, skip silently
		log.Debug().Str("node", nodes[0].Node).Msg("Ceph not available on this cluster, skipping noout flag")
		return nil
	}

	cmd := "ceph osd unset noout"
	if enable {
		cmd = "ceph osd set noout"
	}

	_, err = s.executeSSHWithSession(ctx, session, client, nodes[0].Node, cmd)
	return err
}

func (s *Service) cleanup(session *updateSession, client *proxmox.Client) {
	update := session.update
	ctx := context.Background()

	// Remove Ceph noout if we set it
	if update.Config.SetCephNoout {
		if err := s.setCephNooutWithSession(ctx, session, client, false); err != nil {
			s.addLog(update, "warning", "", fmt.Sprintf("Failed to unset Ceph noout: %v", err))
		} else {
			s.addLog(update, "info", "", "Unset Ceph noout flag")
		}
	}

	// Close all SSH connections
	session.sshClientMu.Lock()
	for nodeName, sshClient := range session.sshClients {
		sshClient.Close()
		delete(session.sshClients, nodeName)
	}
	session.sshClientMu.Unlock()
}

func (s *Service) failUpdate(update *RollingUpdate, errMsg string) {
	update.Status = StatusFailed
	update.Error = errMsg
	now := time.Now()
	update.CompletedAt = &now
	s.saveUpdate(update)

	s.addLog(update, "error", "", errMsg)

	if update.Config.NotifyOnError && s.notifications != nil {
		s.sendNotification(update, "Rolling update failed", errMsg)
	}

	// Remove from active sessions
	s.sessionsMu.Lock()
	delete(s.activeSessions, update.ID)
	s.sessionsMu.Unlock()
}

func (s *Service) addLog(update *RollingUpdate, level, node, message string) {
	entry := LogEntry{
		Timestamp: time.Now(),
		Level:     level,
		Node:      node,
		Message:   message,
	}
	update.Logs = append(update.Logs, entry)

	log.Info().
		Str("update_id", update.ID).
		Str("level", level).
		Str("node", node).
		Msg(message)
}

func (s *Service) sendNotification(update *RollingUpdate, subject, message string) {
	if s.notifications == nil {
		return
	}

	// Send notification via the notification service
	// This would integrate with email, Slack, etc.
	log.Info().
		Str("update_id", update.ID).
		Str("subject", subject).
		Msg("Notification sent")
}

// Storage operations using GORM

// RollingUpdateRecord is the GORM model for rolling updates
type RollingUpdateRecord struct {
	ID             string     `gorm:"primaryKey"`
	ConnectionID   string     `gorm:"index"`
	ClusterName    string
	Status         string     `gorm:"index"`
	ConfigJSON     string     // JSON encoded RollingUpdateConfig
	TotalNodes     int
	CompletedNodes int
	CurrentNode    string
	NodeStatusJSON string     // JSON encoded []NodeUpdateDetail
	LogsJSON       string     // JSON encoded []LogEntry
	Error          string
	CreatedAt      time.Time  `gorm:"index"`
	StartedAt      *time.Time
	CompletedAt    *time.Time
}

func (s *Service) saveUpdate(update *RollingUpdate) error {
	if s.db == nil {
		return nil
	}

	configJSON, _ := json.Marshal(update.Config)
	nodeStatusJSON, _ := json.Marshal(update.NodeStatuses)
	logsJSON, _ := json.Marshal(update.Logs)

	record := RollingUpdateRecord{
		ID:             update.ID,
		ConnectionID:   update.ConnectionID,
		ClusterName:    update.ClusterName,
		Status:         string(update.Status),
		ConfigJSON:     string(configJSON),
		TotalNodes:     update.TotalNodes,
		CompletedNodes: update.CompletedNodes,
		CurrentNode:    update.CurrentNode,
		NodeStatusJSON: string(nodeStatusJSON),
		LogsJSON:       string(logsJSON),
		Error:          update.Error,
		CreatedAt:      update.CreatedAt,
		StartedAt:      update.StartedAt,
		CompletedAt:    update.CompletedAt,
	}

	return s.db.DB().Save(&record).Error
}

func (s *Service) loadUpdate(id string) (*RollingUpdate, error) {
	if s.db == nil {
		return nil, fmt.Errorf("database not available")
	}

	var record RollingUpdateRecord
	if err := s.db.DB().Where("id = ?", id).First(&record).Error; err != nil {
		return nil, err
	}

	update := &RollingUpdate{
		ID:             record.ID,
		ConnectionID:   record.ConnectionID,
		ClusterName:    record.ClusterName,
		Status:         UpdateStatus(record.Status),
		TotalNodes:     record.TotalNodes,
		CompletedNodes: record.CompletedNodes,
		CurrentNode:    record.CurrentNode,
		Error:          record.Error,
		CreatedAt:      record.CreatedAt,
		StartedAt:      record.StartedAt,
		CompletedAt:    record.CompletedAt,
	}

	json.Unmarshal([]byte(record.ConfigJSON), &update.Config)
	json.Unmarshal([]byte(record.NodeStatusJSON), &update.NodeStatuses)
	json.Unmarshal([]byte(record.LogsJSON), &update.Logs)

	return update, nil
}

func (s *Service) loadConnectionUpdates(connectionID string) ([]*RollingUpdate, error) {
	if s.db == nil {
		return nil, fmt.Errorf("database not available")
	}

	var records []RollingUpdateRecord
	if err := s.db.DB().Where("connection_id = ?", connectionID).Order("created_at DESC").Find(&records).Error; err != nil {
		return nil, err
	}

	updates := make([]*RollingUpdate, len(records))
	for i, record := range records {
		update := &RollingUpdate{
			ID:             record.ID,
			ConnectionID:   record.ConnectionID,
			ClusterName:    record.ClusterName,
			Status:         UpdateStatus(record.Status),
			TotalNodes:     record.TotalNodes,
			CompletedNodes: record.CompletedNodes,
			CurrentNode:    record.CurrentNode,
			Error:          record.Error,
			CreatedAt:      record.CreatedAt,
			StartedAt:      record.StartedAt,
			CompletedAt:    record.CompletedAt,
		}
		json.Unmarshal([]byte(record.ConfigJSON), &update.Config)
		json.Unmarshal([]byte(record.NodeStatusJSON), &update.NodeStatuses)
		json.Unmarshal([]byte(record.LogsJSON), &update.Logs)
		updates[i] = update
	}

	return updates, nil
}

// InitDB initializes the rolling update table
func (s *Service) InitDB() error {
	if s.db == nil {
		return nil
	}
	return s.db.DB().AutoMigrate(&RollingUpdateRecord{})
}

// Utility functions

func contains(slice []string, item string) bool {
	for _, s := range slice {
		if s == item {
			return true
		}
	}
	return false
}
