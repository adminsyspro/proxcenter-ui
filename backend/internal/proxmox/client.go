package proxmox

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/proxcenter/orchestrator/internal/config"
	"github.com/rs/zerolog/log"
)

// Client represents a connection to a single Proxmox VE node/cluster
type Client struct {
	BaseURL    string
	APIToken   string // Full token: "user@pam!tokenid=secret"
	httpClient *http.Client
	mu         sync.RWMutex

	// Cache for storage info
	storageCache     map[string]*Storage
	storageCacheTime time.Time
}

// Manager manages multiple Proxmox connections
type Manager struct {
	clients map[string]*Client // connectionID -> Client
	config  config.ProxmoxConfig
	mu      sync.RWMutex
}

// Node represents a Proxmox node
type Node struct {
	Node    string  `json:"node"`
	Status  string  `json:"status"`
	CPU     float64 `json:"cpu"`
	MaxCPU  int     `json:"maxcpu"`
	Mem     int64   `json:"mem"`
	MaxMem  int64   `json:"maxmem"`
	Disk    int64   `json:"disk"`
	MaxDisk int64   `json:"maxdisk"`
	Uptime  int64   `json:"uptime"`
	Level   string  `json:"level"`
}

// VM represents a virtual machine or container
type VM struct {
	VMID     int       `json:"vmid"`
	Name     string    `json:"name"`
	Node     string    `json:"node"`
	Type     string    `json:"type"` // "qemu" or "lxc"
	Status   string    `json:"status"`
	CPU      float64   `json:"cpu"`
	CPUs     int       `json:"cpus"`
	Mem      int64     `json:"mem"`
	MaxMem   int64     `json:"maxmem"`
	Disk     int64     `json:"disk"`
	MaxDisk  int64     `json:"maxdisk"`
	Uptime   int64     `json:"uptime"`
	Template int       `json:"template"` // 0 or 1
	Pool     string    `json:"pool,omitempty"`
	Tags     string    `json:"tags,omitempty"`
	HA       *HAStatus `json:"ha,omitempty"`
}

// IsTemplate returns true if this VM is a template
func (v *VM) IsTemplate() bool {
	return v.Template == 1
}

// IsLXC returns true if this is a container
func (v *VM) IsLXC() bool {
	return v.Type == "lxc"
}

type HAStatus struct {
	Managed int    `json:"managed"`
	State   string `json:"state,omitempty"`
}

// Storage represents a Proxmox storage
type Storage struct {
	Storage string `json:"storage"`
	Type    string `json:"type"`    // rbd, lvmthin, dir, nfs, cephfs, etc.
	Content string `json:"content"` // images,rootdir,vztmpl,iso,backup,snippets
	Shared  int    `json:"shared"`  // 1 if shared, 0 if local
	Active  int    `json:"active"`
	Enabled int    `json:"enabled"`
	Total   int64  `json:"total,omitempty"`
	Used    int64  `json:"used,omitempty"`
	Avail   int64  `json:"avail,omitempty"`
}

// IsShared returns true if the storage is shared across nodes
func (s *Storage) IsShared() bool {
	return s.Shared == 1
}

// VMDisk represents a disk attached to a VM
type VMDisk struct {
	Device      string `json:"device"`       // scsi0, virtio0, ide0, etc.
	Storage     string `json:"storage"`      // CephStoragePool, local-lvm, etc.
	Volume      string `json:"volume"`       // Full volume ID (storage:vm-xxx-disk-0)
	Size        int64  `json:"size"`         // Size in bytes
	SizeStr     string `json:"size_str"`     // Original size string (32G, 100G, etc.)
	Format      string `json:"format"`       // raw, qcow2, etc.
	IsShared    bool   `json:"is_shared"`    // true if on shared storage
	IsLocal     bool   `json:"is_local"`     // true if on local storage
	StorageType string `json:"storage_type"` // rbd, lvmthin, dir, etc.
}

// VMStorageAnalysis represents the storage analysis for a VM
type VMStorageAnalysis struct {
	VMID             int      `json:"vmid"`
	VMName           string   `json:"vm_name"`
	Node             string   `json:"node"`
	Disks            []VMDisk `json:"disks"`
	HasLocalDisks    bool     `json:"has_local_disks"`
	HasSharedDisks   bool     `json:"has_shared_disks"`
	TotalLocalSize   int64    `json:"total_local_size"`  // Total size of local disks in bytes
	TotalSharedSize  int64    `json:"total_shared_size"` // Total size of shared disks in bytes
	MigrationSafe    bool     `json:"migration_safe"`    // true if all disks are shared
	MigrationWarning string   `json:"migration_warning"` // Warning message if local disks exist
	LocalStorages    []string `json:"local_storages"`    // List of local storage names used
}

// MigrationTask represents an ongoing migration
type MigrationTask struct {
	TaskID     string    `json:"task_id"`
	VMID       int       `json:"vmid"`
	SourceNode string    `json:"source_node"`
	TargetNode string    `json:"target_node"`
	StartedAt  time.Time `json:"started_at"`
	Status     string    `json:"status"`
	Progress   float64   `json:"progress"`
}

// NewManager creates a new Proxmox manager
func NewManager(cfg config.ProxmoxConfig) *Manager {
	return &Manager{
		clients: make(map[string]*Client),
		config:  cfg,
	}
}

// AddConnection adds a new Proxmox connection
// apiToken should be the full token in format "user@pam!tokenid=secret" or just the token value
func (m *Manager) AddConnection(id, baseURL, apiToken, _ string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	client := &Client{
		BaseURL:  baseURL,
		APIToken: apiToken, // Store the full token
		httpClient: &http.Client{
			Timeout: m.config.RequestTimeout,
			Transport: &http.Transport{
				TLSClientConfig: &tls.Config{InsecureSkipVerify: true}, // Proxmox self-signed certs
			},
		},
		storageCache: make(map[string]*Storage),
	}

	m.clients[id] = client
	log.Info().Str("connection_id", id).Str("url", baseURL).Msg("Added Proxmox connection")
}

// GetClient returns a client by connection ID
func (m *Manager) GetClient(connectionID string) (*Client, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	client, ok := m.clients[connectionID]
	if !ok {
		return nil, fmt.Errorf("connection not found: %s", connectionID)
	}
	return client, nil
}

// GetAllClients returns all clients
func (m *Manager) GetAllClients() map[string]*Client {
	m.mu.RLock()
	defer m.mu.RUnlock()

	result := make(map[string]*Client)
	for k, v := range m.clients {
		result[k] = v
	}
	return result
}

// GetAppSecret returns the APP_SECRET from the configuration
// This is used to decrypt secrets stored in ProxCenter's database
func (m *Manager) GetAppSecret() string {
	return m.config.AppSecret
}

// request makes an authenticated request to the Proxmox API
func (c *Client) request(ctx context.Context, method, path string, body interface{}) ([]byte, error) {
	url := fmt.Sprintf("%s/api2/json%s", c.BaseURL, path)

	req, err := http.NewRequestWithContext(ctx, method, url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Authorization", fmt.Sprintf("PVEAPIToken=%s", c.APIToken))
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	// Read raw body for debugging
	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %w", err)
	}

	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("API error (status %d): %s", resp.StatusCode, string(bodyBytes))
	}

	if len(bodyBytes) == 0 {
		return nil, fmt.Errorf("empty response from API (status %d)", resp.StatusCode)
	}

	var result struct {
		Data   json.RawMessage `json:"data"`
		Errors interface{}     `json:"errors,omitempty"`
	}

	if err := json.Unmarshal(bodyBytes, &result); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w (body: %s)", err, string(bodyBytes[:min(200, len(bodyBytes))]))
	}

	return result.Data, nil
}

// Request is a public wrapper for the internal request method
func (c *Client) Request(ctx context.Context, method, path string, body interface{}) ([]byte, error) {
	return c.request(ctx, method, path, body)
}

// RequestForm makes an authenticated request with form-encoded body
func (c *Client) RequestForm(ctx context.Context, method, path string, form url.Values) ([]byte, error) {
	apiURL := fmt.Sprintf("%s/api2/json%s", c.BaseURL, path)

	var reqBody io.Reader
	if form != nil {
		reqBody = strings.NewReader(form.Encode())
	}

	req, err := http.NewRequestWithContext(ctx, method, apiURL, reqBody)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Authorization", fmt.Sprintf("PVEAPIToken=%s", c.APIToken))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %w", err)
	}

	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("API error (status %d): %s", resp.StatusCode, string(bodyBytes))
	}

	// For successful DELETE/POST requests, response might be empty or just contain data: null
	if len(bodyBytes) == 0 {
		return nil, nil
	}

	var result struct {
		Data   json.RawMessage `json:"data"`
		Errors interface{}     `json:"errors,omitempty"`
	}

	if err := json.Unmarshal(bodyBytes, &result); err != nil {
		// Some requests return just "null" or empty data
		return nil, nil
	}

	return result.Data, nil
}

// GetNodes returns all nodes in the cluster
func (c *Client) GetNodes(ctx context.Context) ([]Node, error) {
	data, err := c.request(ctx, "GET", "/nodes", nil)
	if err != nil {
		return nil, err
	}

	var nodes []Node
	if err := json.Unmarshal(data, &nodes); err != nil {
		return nil, fmt.Errorf("failed to parse nodes: %w", err)
	}

	return nodes, nil
}

// GetVMs returns all VMs across all nodes
func (c *Client) GetVMs(ctx context.Context) ([]VM, error) {
	data, err := c.request(ctx, "GET", "/cluster/resources?type=vm", nil)
	if err != nil {
		return nil, err
	}

	var vms []VM
	if err := json.Unmarshal(data, &vms); err != nil {
		return nil, fmt.Errorf("failed to parse VMs: %w", err)
	}

	return vms, nil
}

// GetVMNode returns the current node where a VM is located
func (c *Client) GetVMNode(ctx context.Context, vmid int) (string, error) {
	// Use cluster resources to find the VM's current location
	vms, err := c.GetVMs(ctx)
	if err != nil {
		return "", fmt.Errorf("failed to get VMs: %w", err)
	}

	for _, vm := range vms {
		if vm.VMID == vmid {
			return vm.Node, nil
		}
	}

	return "", fmt.Errorf("VM %d not found in cluster", vmid)
}

// GetNodeStatus returns detailed status for a specific node
func (c *Client) GetNodeStatus(ctx context.Context, node string) (*Node, error) {
	data, err := c.request(ctx, "GET", fmt.Sprintf("/nodes/%s/status", node), nil)
	if err != nil {
		return nil, err
	}

	var status Node
	if err := json.Unmarshal(data, &status); err != nil {
		return nil, fmt.Errorf("failed to parse node status: %w", err)
	}
	status.Node = node

	return &status, nil
}

// GetVMStatus returns detailed status for a specific VM
func (c *Client) GetVMStatus(ctx context.Context, node string, vmid int) (*VM, error) {
	data, err := c.request(ctx, "GET", fmt.Sprintf("/nodes/%s/qemu/%d/status/current", node, vmid), nil)
	if err != nil {
		return nil, err
	}

	var vm VM
	if err := json.Unmarshal(data, &vm); err != nil {
		return nil, fmt.Errorf("failed to parse VM status: %w", err)
	}
	vm.Node = node
	vm.VMID = vmid

	return &vm, nil
}

// GetStorages returns all storages in the cluster
func (c *Client) GetStorages(ctx context.Context) ([]Storage, error) {
	data, err := c.request(ctx, "GET", "/storage", nil)
	if err != nil {
		return nil, err
	}

	var storages []Storage
	if err := json.Unmarshal(data, &storages); err != nil {
		return nil, fmt.Errorf("failed to parse storages: %w", err)
	}

	// Update cache
	c.mu.Lock()
	c.storageCache = make(map[string]*Storage)
	for i := range storages {
		c.storageCache[storages[i].Storage] = &storages[i]
	}
	c.storageCacheTime = time.Now()
	c.mu.Unlock()

	return storages, nil
}

// GetStorage returns info about a specific storage (uses cache if fresh)
func (c *Client) GetStorage(ctx context.Context, storageName string) (*Storage, error) {
	c.mu.RLock()
	cached, ok := c.storageCache[storageName]
	cacheAge := time.Since(c.storageCacheTime)
	c.mu.RUnlock()

	// Use cache if less than 5 minutes old
	if ok && cacheAge < 5*time.Minute {
		return cached, nil
	}

	// Refresh cache
	_, err := c.GetStorages(ctx)
	if err != nil {
		return nil, err
	}

	c.mu.RLock()
	defer c.mu.RUnlock()

	if storage, ok := c.storageCache[storageName]; ok {
		return storage, nil
	}

	return nil, fmt.Errorf("storage not found: %s", storageName)
}

// GetVMConfig returns the configuration of a VM
func (c *Client) GetVMConfig(ctx context.Context, node string, vmid int) (map[string]interface{}, error) {
	data, err := c.request(ctx, "GET", fmt.Sprintf("/nodes/%s/qemu/%d/config", node, vmid), nil)
	if err != nil {
		return nil, err
	}

	var config map[string]interface{}
	if err := json.Unmarshal(data, &config); err != nil {
		return nil, fmt.Errorf("failed to parse VM config: %w", err)
	}

	return config, nil
}

// GetLXCConfig returns the configuration of a container
func (c *Client) GetLXCConfig(ctx context.Context, node string, vmid int) (map[string]interface{}, error) {
	data, err := c.request(ctx, "GET", fmt.Sprintf("/nodes/%s/lxc/%d/config", node, vmid), nil)
	if err != nil {
		return nil, err
	}

	var config map[string]interface{}
	if err := json.Unmarshal(data, &config); err != nil {
		return nil, fmt.Errorf("failed to parse LXC config: %w", err)
	}

	return config, nil
}

// parseDiskValue parses a disk configuration string like "CephStoragePool:vm-50011-disk-0,size=32G"
func parseDiskValue(diskValue string) (storage, volume, sizeStr string) {
	// Format: storage:volume,options
	// Example: CephStoragePool:vm-50011-disk-0,size=32G,discard=on

	parts := strings.SplitN(diskValue, ",", 2)
	volumePart := parts[0]

	// Extract storage:volume
	colonIdx := strings.Index(volumePart, ":")
	if colonIdx > 0 {
		storage = volumePart[:colonIdx]
		volume = volumePart
	} else {
		return "", "", ""
	}

	// Extract size from options
	if len(parts) > 1 {
		options := parts[1]
		sizeRegex := regexp.MustCompile(`size=(\d+[KMGT]?)`)
		if match := sizeRegex.FindStringSubmatch(options); len(match) > 1 {
			sizeStr = match[1]
		}
	}

	return storage, volume, sizeStr
}

// parseSizeString converts size string like "32G" to bytes
func parseSizeString(sizeStr string) int64 {
	if sizeStr == "" {
		return 0
	}

	var multiplier int64 = 1
	numStr := sizeStr

	if strings.HasSuffix(sizeStr, "T") {
		multiplier = 1024 * 1024 * 1024 * 1024
		numStr = strings.TrimSuffix(sizeStr, "T")
	} else if strings.HasSuffix(sizeStr, "G") {
		multiplier = 1024 * 1024 * 1024
		numStr = strings.TrimSuffix(sizeStr, "G")
	} else if strings.HasSuffix(sizeStr, "M") {
		multiplier = 1024 * 1024
		numStr = strings.TrimSuffix(sizeStr, "M")
	} else if strings.HasSuffix(sizeStr, "K") {
		multiplier = 1024
		numStr = strings.TrimSuffix(sizeStr, "K")
	}

	var num int64
	fmt.Sscanf(numStr, "%d", &num)
	return num * multiplier
}

// AnalyzeVMStorage analyzes the storage configuration of a VM
func (c *Client) AnalyzeVMStorage(ctx context.Context, node string, vmid int, vmName string) (*VMStorageAnalysis, error) {
	// Get VM config
	vmConfig, err := c.GetVMConfig(ctx, node, vmid)
	if err != nil {
		return nil, err
	}

	// Ensure storage cache is populated
	_, err = c.GetStorages(ctx)
	if err != nil {
		log.Warn().Err(err).Msg("Failed to get storages, will assume unknown storages are local")
	}

	analysis := &VMStorageAnalysis{
		VMID:          vmid,
		VMName:        vmName,
		Node:          node,
		Disks:         make([]VMDisk, 0),
		LocalStorages: make([]string, 0),
	}

	// Disk device patterns: scsi0, virtio0, ide0, sata0, etc.
	diskPattern := regexp.MustCompile(`^(scsi|virtio|ide|sata)\d+$`)

	localStorageSet := make(map[string]bool)

	for key, value := range vmConfig {
		if !diskPattern.MatchString(key) {
			continue
		}

		diskValue, ok := value.(string)
		if !ok {
			continue
		}

		// Skip cdrom/iso
		if strings.Contains(diskValue, "media=cdrom") || strings.Contains(diskValue, ",iso/") {
			continue
		}

		// Skip cloudinit
		if strings.Contains(diskValue, "cloudinit") {
			continue
		}

		storageName, volume, sizeStr := parseDiskValue(diskValue)
		if storageName == "" {
			continue
		}

		disk := VMDisk{
			Device:  key,
			Storage: storageName,
			Volume:  volume,
			SizeStr: sizeStr,
			Size:    parseSizeString(sizeStr),
		}

		// Check if storage is shared
		c.mu.RLock()
		storageInfo, ok := c.storageCache[storageName]
		c.mu.RUnlock()

		if ok {
			disk.IsShared = storageInfo.IsShared()
			disk.IsLocal = !storageInfo.IsShared()
			disk.StorageType = storageInfo.Type
		} else {
			// Unknown storage - assume local for safety
			disk.IsLocal = true
			disk.IsShared = false
			disk.StorageType = "unknown"
			log.Warn().
				Str("storage", storageName).
				Int("vmid", vmid).
				Msg("Storage not found in cache, assuming local")
		}

		analysis.Disks = append(analysis.Disks, disk)

		if disk.IsLocal {
			analysis.HasLocalDisks = true
			analysis.TotalLocalSize += disk.Size
			if !localStorageSet[storageName] {
				localStorageSet[storageName] = true
				analysis.LocalStorages = append(analysis.LocalStorages, storageName)
			}
		}

		if disk.IsShared {
			analysis.HasSharedDisks = true
			analysis.TotalSharedSize += disk.Size
		}
	}

	// Determine migration safety
	analysis.MigrationSafe = !analysis.HasLocalDisks

	if analysis.HasLocalDisks {
		localSizeGB := analysis.TotalLocalSize / (1024 * 1024 * 1024)
		storageList := strings.Join(analysis.LocalStorages, ", ")
		analysis.MigrationWarning = fmt.Sprintf(
			"VM has %d GB on local storage (%s). Migration will copy data over network and may take significant time.",
			localSizeGB, storageList,
		)
	}

	return analysis, nil
}

// AnalyzeLXCStorage analyzes the storage configuration of a container
func (c *Client) AnalyzeLXCStorage(ctx context.Context, node string, vmid int, vmName string) (*VMStorageAnalysis, error) {
	// Get LXC config
	lxcConfig, err := c.GetLXCConfig(ctx, node, vmid)
	if err != nil {
		return nil, err
	}

	// Ensure storage cache is populated
	_, _ = c.GetStorages(ctx)

	analysis := &VMStorageAnalysis{
		VMID:          vmid,
		VMName:        vmName,
		Node:          node,
		Disks:         make([]VMDisk, 0),
		LocalStorages: make([]string, 0),
	}

	// LXC uses rootfs and mp0, mp1, etc.
	diskPattern := regexp.MustCompile(`^(rootfs|mp\d+)$`)
	localStorageSet := make(map[string]bool)

	for key, value := range lxcConfig {
		if !diskPattern.MatchString(key) {
			continue
		}

		diskValue, ok := value.(string)
		if !ok {
			continue
		}

		storageName, volume, sizeStr := parseDiskValue(diskValue)
		if storageName == "" {
			continue
		}

		disk := VMDisk{
			Device:  key,
			Storage: storageName,
			Volume:  volume,
			SizeStr: sizeStr,
			Size:    parseSizeString(sizeStr),
		}

		c.mu.RLock()
		storageInfo, ok := c.storageCache[storageName]
		c.mu.RUnlock()

		if ok {
			disk.IsShared = storageInfo.IsShared()
			disk.IsLocal = !storageInfo.IsShared()
			disk.StorageType = storageInfo.Type
		} else {
			disk.IsLocal = true
			disk.IsShared = false
			disk.StorageType = "unknown"
		}

		analysis.Disks = append(analysis.Disks, disk)

		if disk.IsLocal {
			analysis.HasLocalDisks = true
			analysis.TotalLocalSize += disk.Size
			if !localStorageSet[storageName] {
				localStorageSet[storageName] = true
				analysis.LocalStorages = append(analysis.LocalStorages, storageName)
			}
		}

		if disk.IsShared {
			analysis.HasSharedDisks = true
			analysis.TotalSharedSize += disk.Size
		}
	}

	analysis.MigrationSafe = !analysis.HasLocalDisks

	if analysis.HasLocalDisks {
		localSizeGB := analysis.TotalLocalSize / (1024 * 1024 * 1024)
		storageList := strings.Join(analysis.LocalStorages, ", ")
		analysis.MigrationWarning = fmt.Sprintf(
			"Container has %d GB on local storage (%s). Migration will copy data over network.",
			localSizeGB, storageList,
		)
	}

	return analysis, nil
}

// GetNodeStorageStatus returns storage usage for a specific node
func (c *Client) GetNodeStorageStatus(ctx context.Context, node string) ([]Storage, error) {
	data, err := c.request(ctx, "GET", fmt.Sprintf("/nodes/%s/storage", node), nil)
	if err != nil {
		return nil, err
	}

	var storages []Storage
	if err := json.Unmarshal(data, &storages); err != nil {
		return nil, fmt.Errorf("failed to parse node storages: %w", err)
	}

	return storages, nil
}

// GetStorageStatus returns the status of a specific storage on a specific node
// This includes usage information (total, used, available)
func (c *Client) GetStorageStatus(ctx context.Context, node, storageName string) (*Storage, error) {
	// Get all storages for the node
	storages, err := c.GetNodeStorageStatus(ctx, node)
	if err != nil {
		return nil, fmt.Errorf("failed to get node storage status: %w", err)
	}

	// Find the specific storage
	for i := range storages {
		if storages[i].Storage == storageName {
			return &storages[i], nil
		}
	}

	return nil, fmt.Errorf("storage %s not found on node %s", storageName, node)
}

// MigrateVM initiates a live migration of a VM to another node
func (c *Client) MigrateVM(ctx context.Context, sourceNode string, vmid int, targetNode string, online bool) (string, error) {
	path := fmt.Sprintf("/nodes/%s/qemu/%d/migrate", sourceNode, vmid)

	// Build form data as URL-encoded body (required by Proxmox API)
	formData := fmt.Sprintf("target=%s", targetNode)
	if online {
		formData += "&online=1"
	}
	// Add with-local-disks for VMs with local storage
	formData += "&with-local-disks=1"

	req, err := http.NewRequestWithContext(ctx, "POST", fmt.Sprintf("%s/api2/json%s", c.BaseURL, path), strings.NewReader(formData))
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Authorization", fmt.Sprintf("PVEAPIToken=%s", c.APIToken))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("migration request failed: %w", err)
	}
	defer resp.Body.Close()

	// Read the full response body
	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read response body: %w", err)
	}

	// Check for HTTP errors
	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("migration API error (status %d): %s", resp.StatusCode, string(bodyBytes))
	}

	// Parse response
	var result struct {
		Data   string      `json:"data"` // Returns task UPID
		Errors interface{} `json:"errors,omitempty"`
	}

	if err := json.Unmarshal(bodyBytes, &result); err != nil {
		return "", fmt.Errorf("failed to decode response: %w (body: %s)", err, string(bodyBytes))
	}

	if result.Data == "" {
		return "", fmt.Errorf("migration returned empty task ID, response: %s", string(bodyBytes))
	}

	log.Debug().
		Str("task_id", result.Data).
		Int("vmid", vmid).
		Str("source", sourceNode).
		Str("target", targetNode).
		Msg("Migration task created")

	return result.Data, nil
}

// MigrateLXC initiates a migration of a container to another node
func (c *Client) MigrateLXC(ctx context.Context, sourceNode string, vmid int, targetNode string, online bool) (string, error) {
	path := fmt.Sprintf("/nodes/%s/lxc/%d/migrate", sourceNode, vmid)

	// Build form data
	formData := fmt.Sprintf("target=%s", targetNode)
	if online {
		formData += "&online=1"
	}

	req, err := http.NewRequestWithContext(ctx, "POST", fmt.Sprintf("%s/api2/json%s", c.BaseURL, path), strings.NewReader(formData))
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Authorization", fmt.Sprintf("PVEAPIToken=%s", c.APIToken))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("migration request failed: %w", err)
	}
	defer resp.Body.Close()

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read response body: %w", err)
	}

	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("migration API error (status %d): %s", resp.StatusCode, string(bodyBytes))
	}

	var result struct {
		Data   string      `json:"data"`
		Errors interface{} `json:"errors,omitempty"`
	}

	if err := json.Unmarshal(bodyBytes, &result); err != nil {
		return "", fmt.Errorf("failed to decode response: %w (body: %s)", err, string(bodyBytes))
	}

	if result.Data == "" {
		return "", fmt.Errorf("migration returned empty task ID, response: %s", string(bodyBytes))
	}

	log.Debug().
		Str("task_id", result.Data).
		Int("vmid", vmid).
		Str("source", sourceNode).
		Str("target", targetNode).
		Msg("LXC migration task created")

	return result.Data, nil
}

// TaskStatus represents the status of a Proxmox task
type TaskStatus struct {
	Status     string `json:"status"`
	ExitStatus string `json:"exitstatus,omitempty"`
	Type       string `json:"type,omitempty"`
	ID         string `json:"id,omitempty"`
	Node       string `json:"node,omitempty"`
	User       string `json:"user,omitempty"`
	StartTime  int64  `json:"starttime,omitempty"`
	EndTime    int64  `json:"endtime,omitempty"`
	UPID       string `json:"upid,omitempty"`
	PID        int    `json:"pid,omitempty"`
}

// TaskLogEntry represents a single log line from a task
type TaskLogEntry struct {
	N int    `json:"n"` // Line number
	T string `json:"t"` // Log text
}

// TaskDetails contains full task information including progress
type TaskDetails struct {
	Status     string  `json:"status"`
	ExitStatus string  `json:"exitstatus,omitempty"`
	Progress   float64 `json:"progress"` // 0-100
	Message    string  `json:"message"`  // Current operation
	StartTime  int64   `json:"starttime,omitempty"`
	EndTime    int64   `json:"endtime,omitempty"`
}

// GetTaskStatus returns the status of a task
func (c *Client) GetTaskStatus(ctx context.Context, node, upid string) (string, error) {
	data, err := c.request(ctx, "GET", fmt.Sprintf("/nodes/%s/tasks/%s/status", node, upid), nil)
	if err != nil {
		return "", err
	}

	// Try to parse as a single object first
	var status TaskStatus
	if err := json.Unmarshal(data, &status); err == nil {
		if status.Status == "stopped" {
			if status.ExitStatus != "" {
				return status.ExitStatus, nil
			}
			return "OK", nil
		}
		return status.Status, nil
	}

	// If that fails, try to parse as an array (some Proxmox versions return this)
	var statusArray []TaskStatus
	if err := json.Unmarshal(data, &statusArray); err == nil && len(statusArray) > 0 {
		status = statusArray[0]
		if status.Status == "stopped" {
			if status.ExitStatus != "" {
				return status.ExitStatus, nil
			}
			return "OK", nil
		}
		return status.Status, nil
	}

	// If both fail, try to extract status from raw JSON
	var raw map[string]interface{}
	if err := json.Unmarshal(data, &raw); err == nil {
		if s, ok := raw["status"].(string); ok {
			if s == "stopped" {
				if es, ok := raw["exitstatus"].(string); ok && es != "" {
					return es, nil
				}
				return "OK", nil
			}
			return s, nil
		}
	}

	return "", fmt.Errorf("failed to parse task status: unexpected format: %s", string(data))
}

// GetTaskLog returns the log output of a task
func (c *Client) GetTaskLog(ctx context.Context, node, upid string, start int) ([]TaskLogEntry, error) {
	path := fmt.Sprintf("/nodes/%s/tasks/%s/log?start=%d&limit=100", node, upid, start)
	data, err := c.request(ctx, "GET", path, nil)
	if err != nil {
		return nil, err
	}

	var logs []TaskLogEntry
	if err := json.Unmarshal(data, &logs); err != nil {
		return nil, fmt.Errorf("failed to parse task log: %w", err)
	}

	return logs, nil
}

// GetTaskDetails returns detailed task information including progress estimation
func (c *Client) GetTaskDetails(ctx context.Context, node, upid string) (*TaskDetails, error) {
	// Get task status
	data, err := c.request(ctx, "GET", fmt.Sprintf("/nodes/%s/tasks/%s/status", node, upid), nil)
	if err != nil {
		return nil, err
	}

	var status TaskStatus
	if err := json.Unmarshal(data, &status); err != nil {
		return nil, fmt.Errorf("failed to parse task status: %w", err)
	}

	details := &TaskDetails{
		Status:    status.Status,
		StartTime: status.StartTime,
		EndTime:   status.EndTime,
	}

	if status.Status == "stopped" {
		details.ExitStatus = status.ExitStatus
		details.Progress = 100
		if status.ExitStatus == "OK" {
			details.Message = "Migration terminée avec succès"
		} else {
			details.Message = fmt.Sprintf("Migration échouée: %s", status.ExitStatus)
		}
		return details, nil
	}

	// Get logs to extract progress
	logs, err := c.GetTaskLog(ctx, node, upid, 0)
	if err != nil {
		log.Warn().Err(err).Msg("Failed to get task logs for progress")
		details.Message = "Migration en cours..."
		return details, nil
	}

	// Parse logs to find progress - read from end to get latest status
	details.Progress = 0
	details.Message = "Démarrage de la migration..."

	// Regex to parse progress like "transferred 32.0 GiB of 32.0 GiB (100.00%)"
	progressRegex := regexp.MustCompile(`transferred\s+[\d.]+\s+\w+\s+of\s+[\d.]+\s+\w+\s+\(([\d.]+)%\)`)
	// Regex for transfer details
	transferRegex := regexp.MustCompile(`transferred\s+([\d.]+)\s+(\w+)\s+of\s+([\d.]+)\s+(\w+)`)

	for _, entry := range logs {
		text := entry.T

		// Check for progress percentage
		if matches := progressRegex.FindStringSubmatch(text); len(matches) > 1 {
			if pct, err := strconv.ParseFloat(matches[1], 64); err == nil {
				details.Progress = pct
			}
			// Extract transfer info for message
			if transferMatches := transferRegex.FindStringSubmatch(text); len(transferMatches) > 4 {
				details.Message = fmt.Sprintf("Copie des données: %s %s / %s %s", 
					transferMatches[1], transferMatches[2], 
					transferMatches[3], transferMatches[4])
			}
		} else if strings.Contains(text, "starting migration") {
			if details.Progress == 0 {
				details.Progress = 2
				details.Message = "Démarrage de la migration..."
			}
		} else if strings.Contains(text, "found local disk") {
			if details.Progress < 5 {
				details.Progress = 5
				details.Message = "Analyse des disques locaux..."
			}
		} else if strings.Contains(text, "starting storage migration") {
			if details.Progress < 10 {
				details.Progress = 10
				details.Message = "Démarrage de la copie des disques..."
			}
		} else if strings.Contains(text, "drive mirror is starting") {
			if details.Progress < 10 {
				details.Progress = 10
				details.Message = "Initialisation du miroir de disque..."
			}
		} else if strings.Contains(text, "switching to actively synced mode") {
			details.Progress = 95
			details.Message = "Synchronisation finale..."
		} else if strings.Contains(text, "starting online/live migration") {
			details.Progress = 96
			details.Message = "Migration live de la mémoire..."
		} else if strings.Contains(text, "migration completed") {
			details.Progress = 98
			details.Message = "Migration de la mémoire terminée..."
		} else if strings.Contains(text, "migration finished successfully") {
			details.Progress = 100
			details.Message = "Migration terminée avec succès"
		} else if strings.Contains(text, "TASK OK") {
			details.Progress = 100
			details.Message = "Migration terminée avec succès"
		} else if strings.Contains(text, "TASK ERROR") || strings.Contains(text, "error") {
			details.Message = text
		}
	}

	return details, nil
}