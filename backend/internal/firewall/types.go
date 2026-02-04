package firewall

import "time"

// ================================================================================
// ALIASES
// ================================================================================

// Alias represents a firewall alias (network/IP definition)
type Alias struct {
	Name    string `json:"name"`
	CIDR    string `json:"cidr"`
	Comment string `json:"comment,omitempty"`
	Digest  string `json:"digest,omitempty"`
}

// ================================================================================
// IPSETS
// ================================================================================

// IPSet represents a firewall IP set
type IPSet struct {
	Name    string       `json:"name"`
	Comment string       `json:"comment,omitempty"`
	Digest  string       `json:"digest,omitempty"`
	Members []IPSetEntry `json:"members,omitempty"`
}

// IPSetEntry represents an entry in an IP set
type IPSetEntry struct {
	CIDR    string `json:"cidr"`
	Comment string `json:"comment,omitempty"`
	NoMatch bool   `json:"nomatch,omitempty"`
	Digest  string `json:"digest,omitempty"`
}

// ================================================================================
// SECURITY GROUPS
// ================================================================================

// SecurityGroup represents a firewall security group
type SecurityGroup struct {
	Group   string         `json:"group"`  // Proxmox returns "group" not "name"
// Name removed - using Group instead
	Comment string         `json:"comment,omitempty"`
	Digest  string         `json:"digest,omitempty"`
	Rules   []FirewallRule `json:"rules,omitempty"`
}

// ================================================================================
// FIREWALL RULES
// ================================================================================

// FirewallRule represents a single firewall rule
type FirewallRule struct {
	Pos       int    `json:"pos"`
	Type      string `json:"type"`                // in, out, group
	Action    string `json:"action"`              // ACCEPT, DROP, REJECT
	Enable    int    `json:"enable,omitempty"`    // 0 or 1
	Source    string `json:"source,omitempty"`    // Source IP/network/alias
	Dest      string `json:"dest,omitempty"`      // Destination IP/network/alias
	Proto     string `json:"proto,omitempty"`     // tcp, udp, icmp, etc.
	Dport     string `json:"dport,omitempty"`     // Destination port(s)
	Sport     string `json:"sport,omitempty"`     // Source port(s)
	Macro     string `json:"macro,omitempty"`     // Predefined macro name
	Iface     string `json:"iface,omitempty"`     // Network interface
	Log       string `json:"log,omitempty"`       // Log level
	Comment   string `json:"comment,omitempty"`   // Rule description
	Digest    string `json:"digest,omitempty"`    // Configuration digest
	ICMPType  string `json:"icmp-type,omitempty"` // ICMP type
	IPVersion int    `json:"ipversion,omitempty"` // 4 or 6
}

// ================================================================================
// FIREWALL OPTIONS
// ================================================================================

// ClusterOptions represents cluster-level firewall options
type ClusterOptions struct {
	Enable    int    `json:"enable,omitempty"`
	PolicyIn  string `json:"policy_in,omitempty"`  // ACCEPT, DROP, REJECT
	PolicyOut string `json:"policy_out,omitempty"` // ACCEPT, DROP, REJECT
	Digest    string `json:"digest,omitempty"`
}

// NodeOptions represents node-level firewall options
type NodeOptions struct {
	Enable       int    `json:"enable,omitempty"`
	PolicyIn     string `json:"policy_in,omitempty"`
	PolicyOut    string `json:"policy_out,omitempty"`
	LogLevelIn   string `json:"log_level_in,omitempty"`
	LogLevelOut  string `json:"log_level_out,omitempty"`
	NDPFilter    int    `json:"ndp,omitempty"`
	RadVFilter   int    `json:"radv,omitempty"`
	TCPFlagsLog  int    `json:"tcpflags,omitempty"`
	SmurfLog     int    `json:"smurf,omitempty"`
	NoFilter     int    `json:"nofilter,omitempty"`
	ProtectNodes int    `json:"protect_nodes,omitempty"`
	Digest       string `json:"digest,omitempty"`
}

// VMOptions represents VM/CT-level firewall options
type VMOptions struct {
	Enable      int    `json:"enable,omitempty"`
	PolicyIn    string `json:"policy_in,omitempty"`
	PolicyOut   string `json:"policy_out,omitempty"`
	LogLevelIn  string `json:"log_level_in,omitempty"`
	LogLevelOut string `json:"log_level_out,omitempty"`
	DHCPFilter  int    `json:"dhcp,omitempty"`
	MACFilter   int    `json:"macfilter,omitempty"`
	IPFilter    int    `json:"ipfilter,omitempty"`
	NDPFilter   int    `json:"ndp,omitempty"`
	RadVFilter  int    `json:"radv,omitempty"`
	Digest      string `json:"digest,omitempty"`
}

// ================================================================================
// API REQUESTS
// ================================================================================

// CreateAliasRequest represents a request to create an alias
type CreateAliasRequest struct {
	Name    string `json:"name"`
	CIDR    string `json:"cidr"`
	Comment string `json:"comment,omitempty"`
}

// CreateIPSetRequest represents a request to create an IP set
type CreateIPSetRequest struct {
	Name    string `json:"name"`
	Comment string `json:"comment,omitempty"`
}

// AddIPSetEntryRequest represents a request to add an entry to an IP set
type AddIPSetEntryRequest struct {
	CIDR    string `json:"cidr"`
	Comment string `json:"comment,omitempty"`
	NoMatch bool   `json:"nomatch,omitempty"`
}

// CreateSecurityGroupRequest represents a request to create a security group
type CreateSecurityGroupRequest struct {
	Group   string `json:"group"`
	Comment string `json:"comment,omitempty"`
}

// CreateRuleRequest represents a request to create a firewall rule
type CreateRuleRequest struct {
	Type    string `json:"type"`              // in, out, group
	Action  string `json:"action"`            // ACCEPT, DROP, REJECT, GROUP
	Enable  int    `json:"enable,omitempty"`  // 0 or 1, default 1
	Source  string `json:"source,omitempty"`  // Source IP/network/alias
	Dest    string `json:"dest,omitempty"`    // Destination IP/network/alias
	Proto   string `json:"proto,omitempty"`   // tcp, udp, icmp, etc.
	Dport   string `json:"dport,omitempty"`   // Destination port(s)
	Sport   string `json:"sport,omitempty"`   // Source port(s)
	Macro   string `json:"macro,omitempty"`   // Predefined macro
	Group   string `json:"group,omitempty"`   // Security group name (for GROUP action)
	Iface   string `json:"iface,omitempty"`   // Network interface
	Log     string `json:"log,omitempty"`     // Log level
	Comment string `json:"comment,omitempty"` // Rule description
	Pos     int    `json:"pos,omitempty"`     // Position in rule list
}

// UpdateOptionsRequest represents a request to update firewall options
type UpdateOptionsRequest struct {
	Enable    *int    `json:"enable,omitempty"`
	PolicyIn  *string `json:"policy_in,omitempty"`
	PolicyOut *string `json:"policy_out,omitempty"`
}

// UpdateAliasRequest represents a request to update an alias
type UpdateAliasRequest struct {
	CIDR    string `json:"cidr"`
	Comment string `json:"comment,omitempty"`
}

// UpdateRuleRequest represents a request to update a firewall rule
type UpdateRuleRequest struct {
	Type    string `json:"type,omitempty"`
	Action  string `json:"action,omitempty"`
	Enable  *int   `json:"enable"`
	Source  string `json:"source,omitempty"`
	Dest    string `json:"dest,omitempty"`
	Proto   string `json:"proto,omitempty"`
	Dport   string `json:"dport,omitempty"`
	Sport   string `json:"sport,omitempty"`
	Macro   string `json:"macro,omitempty"`
	Iface   string `json:"iface,omitempty"`
	Log     string `json:"log,omitempty"`
	Comment string `json:"comment,omitempty"`
	Moveto  *int   `json:"moveto,omitempty"` // Move rule to new position
}

// ================================================================================
// API RESPONSES
// ================================================================================

// FirewallStatus represents the overall firewall status
type FirewallStatus struct {
	ClusterEnabled   bool   `json:"cluster_enabled"`
	Status           string `json:"status"` // enabled/running, disabled, etc.
	TotalAliases     int    `json:"total_aliases"`
	TotalIPSets      int    `json:"total_ipsets"`
	TotalGroups      int    `json:"total_groups"`
	TotalClusterRules int   `json:"total_cluster_rules"`
	ProtectedNodes   int    `json:"protected_nodes"`
	TotalNodes       int    `json:"total_nodes"`
	ProtectedVMs     int    `json:"protected_vms"`
	TotalVMs         int    `json:"total_vms"`
	LastSync         time.Time `json:"last_sync"`
}

// VMFirewallInfo represents firewall info for a single VM
type VMFirewallInfo struct {
	VMID           int          `json:"vmid"`
	Name           string       `json:"name"`
	Node           string       `json:"node"`
	Type           string       `json:"type"` // qemu or lxc
	FirewallEnabled bool        `json:"firewall_enabled"`
	NICFirewall    []NICFirewallInfo `json:"nic_firewall"`
	Rules          []FirewallRule    `json:"rules"`
	Options        VMOptions         `json:"options"`
}

// NICFirewallInfo represents firewall status for a VM NIC
type NICFirewallInfo struct {
	Interface  string `json:"interface"` // net0, net1, etc.
	Bridge     string `json:"bridge"`
	Firewall   bool   `json:"firewall"` // Whether firewall is enabled on this NIC
	MACAddress string `json:"mac,omitempty"`
}

// NodeFirewallInfo represents firewall info for a node
type NodeFirewallInfo struct {
	Node            string         `json:"node"`
	Enabled         bool           `json:"enabled"`
	Options         NodeOptions    `json:"options"`
	Rules           []FirewallRule `json:"rules"`
	SecurityGroups  []string       `json:"security_groups"` // Applied security groups
}

// ================================================================================
// MACROS (Predefined rule templates)
// ================================================================================

// Macro represents a predefined firewall macro
type Macro struct {
	Name        string `json:"macro"`
	Description string `json:"descr,omitempty"`
}

// Common macros available in Proxmox
var CommonMacros = []Macro{
	{Name: "SSH", Description: "SSH traffic"},
	{Name: "HTTP", Description: "HTTP traffic"},
	{Name: "HTTPS", Description: "HTTPS traffic"},
	{Name: "DNS", Description: "DNS traffic"},
	{Name: "SMTP", Description: "SMTP traffic"},
	{Name: "Ping", Description: "ICMP ping"},
	{Name: "Ceph", Description: "Ceph Storage Cluster traffic (Ceph Monitors, OSD, MDS)"},
	{Name: "Corosync", Description: "Corosync cluster traffic"},
	{Name: "PostgreSQL", Description: "PostgreSQL traffic"},
	{Name: "MySQL", Description: "MySQL traffic"},
	{Name: "Redis", Description: "Redis traffic"},
	{Name: "Web", Description: "HTTP and HTTPS traffic"},
}

// ================================================================================
// MICRO-SEGMENTATION TYPES
// ================================================================================

// MicrosegAnalysis represents the analysis of current micro-segmentation state
type MicrosegAnalysis struct {
	// Existing configuration
	Networks         []NetworkInfo     `json:"networks"`          // Detected networks from net-* aliases
	GatewayAliases   []string          `json:"gateway_aliases"`   // Existing gw-* aliases
	BaseSGs          []string          `json:"base_sgs"`          // Existing sg-base-* groups
	
	// Missing configuration
	MissingGateways  []MissingGateway  `json:"missing_gateways"`  // Networks without gw-* alias
	MissingBaseSGs   []MissingBaseSG   `json:"missing_base_sgs"`  // Networks without sg-base-*
	
	// VM Status
	TotalVMs         int               `json:"total_vms"`
	IsolatedVMs      int               `json:"isolated_vms"`      // VMs with sg-base-* applied
	UnprotectedVMs   int               `json:"unprotected_vms"`   // VMs without firewall enabled
	
	// Summary
	SegmentationReady bool             `json:"segmentation_ready"` // All base SGs exist
}

// NetworkInfo represents a detected network
type NetworkInfo struct {
	Name        string `json:"name"`         // Alias name (e.g., "net-dmz-k8s")
	CIDR        string `json:"cidr"`         // Network CIDR (e.g., "10.17.17.0/24")
	Comment     string `json:"comment"`      // Description
	Gateway     string `json:"gateway"`      // Computed gateway (.254)
	HasGateway  bool   `json:"has_gateway"`  // gw-* alias exists
	HasBaseSG   bool   `json:"has_base_sg"`  // sg-base-* exists
}

// MissingGateway represents a missing gateway alias
type MissingGateway struct {
	NetworkName string `json:"network_name"` // e.g., "net-dmz-k8s"
	AliasName   string `json:"alias_name"`   // e.g., "gw-dmz-k8s"
	GatewayIP   string `json:"gateway_ip"`   // e.g., "10.17.17.254"
}

// MissingBaseSG represents a missing base security group
type MissingBaseSG struct {
	NetworkName string `json:"network_name"` // e.g., "net-dmz-k8s"
	SGName      string `json:"sg_name"`      // e.g., "sg-base-dmz-k8s"
	GatewayName string `json:"gateway_name"` // e.g., "gw-dmz-k8s"
}

// GenerateBaseSGsRequest represents a request to generate base SGs
type GenerateBaseSGsRequest struct {
	DryRun           bool     `json:"dry_run"`            // Only show what would be created
	Networks         []string `json:"networks,omitempty"` // Specific networks, or all if empty
	GatewayOffset    int      `json:"gateway_offset"`     // Gateway IP offset (default 254)
	CreateGateways   bool     `json:"create_gateways"`    // Also create missing gw-* aliases
}

// GenerateBaseSGsResult represents the result of generating base SGs
type GenerateBaseSGsResult struct {
	CreatedAliases []string          `json:"created_aliases"`
	CreatedGroups  []string          `json:"created_groups"`
	Errors         []string          `json:"errors,omitempty"`
	DryRun         bool              `json:"dry_run"`
	Plan           []PlannedAction   `json:"plan,omitempty"` // Only for dry_run
}

// PlannedAction represents a planned action in dry-run mode
type PlannedAction struct {
	Type        string `json:"type"`        // "alias" or "security_group"
	Name        string `json:"name"`
	Description string `json:"description"`
}

// VMSegmentationStatus represents the segmentation status of a VM
type VMSegmentationStatus struct {
	VMID            int               `json:"vmid"`
	Name            string            `json:"name"`
	Node            string            `json:"node"`
	FirewallEnabled bool              `json:"firewall_enabled"`
	PolicyIn        string            `json:"policy_in"`
	PolicyOut       string            `json:"policy_out"`
	
	// Network info
	Networks        []VMNetworkInfo   `json:"networks"`
	
	// Segmentation
	IsIsolated      bool              `json:"is_isolated"`       // Has sg-base-* applied
	AppliedBaseSGs  []string          `json:"applied_base_sgs"`  // Applied sg-base-* groups
	AppliedSGs      []string          `json:"applied_sgs"`       // All applied security groups
	DirectRules     int               `json:"direct_rules"`      // Number of direct rules
	
	// Recommendations
	Recommendations []string          `json:"recommendations"`
}

// VMNetworkInfo represents network info for a VM
type VMNetworkInfo struct {
	Interface    string `json:"interface"`     // net0, net1, etc.
	Bridge       string `json:"bridge"`
	Tag          string `json:"tag,omitempty"` // VLAN tag
	IPAddress    string `json:"ip_address"`    // If known
	Network      string `json:"network"`       // Detected network alias (net-*)
	Gateway      string `json:"gateway"`       // Gateway alias (gw-*)
	BaseSG       string `json:"base_sg"`       // Base SG for this network
	Firewall     bool   `json:"firewall"`      // NIC firewall enabled
}

// IsolateVMRequest represents a request to isolate a VM
type IsolateVMRequest struct {
	EnableFirewall   bool     `json:"enable_firewall"`     // Enable firewall if not already
	SetPolicyInDrop  bool     `json:"set_policy_in_drop"`  // Set policy_in to DROP
	SetPolicyOutDrop bool     `json:"set_policy_out_drop"` // Set policy_out to DROP (reinforced mode)
	ApplyBaseSGs     bool     `json:"apply_base_sgs"`      // Apply sg-base-* for detected networks
	AdditionalSGs    []string `json:"additional_sgs"`      // Additional SGs to apply
	EnableNICFW      bool     `json:"enable_nic_fw"`       // Enable firewall on NICs
}

// IsolateVMResult represents the result of isolating a VM
type IsolateVMResult struct {
	Success       bool     `json:"success"`
	AppliedSGs    []string `json:"applied_sgs"`
	EnabledNICs   []string `json:"enabled_nics"`
	Actions       []string `json:"actions"`
	Errors        []string `json:"errors,omitempty"`
}

// ================================================================================
// IMPACT SIMULATION
// ================================================================================

// ImpactSimulation represents the simulated impact of enabling micro-segmentation on a VM
type ImpactSimulation struct {
	VMID              int                `json:"vmid"`
	Name              string             `json:"name"`
	CurrentState      VMIsolationState   `json:"current_state"`
	SimulatedState    VMIsolationState   `json:"simulated_state"`
	AllowedFlows      []FlowAnalysis     `json:"allowed_flows"`
	BlockedFlows      []FlowAnalysis     `json:"blocked_flows"`
	AffectedVMs       []AffectedVM       `json:"affected_vms"`
	Warnings          []string           `json:"warnings"`
	RequiredActions   []string           `json:"required_actions"`
}

// VMIsolationState represents the isolation state of a VM
type VMIsolationState struct {
	FirewallEnabled bool     `json:"firewall_enabled"`
	PolicyIn        string   `json:"policy_in"`
	PolicyOut       string          `json:"policy_out"`
	IsIsolated      bool            `json:"is_isolated"`
	AppliedSGs      []string        `json:"applied_sgs"`
	Networks        []VMNetworkInfo `json:"networks,omitempty"`
}

// FlowAnalysis represents a network flow and its status
type FlowAnalysis struct {
	Direction   string `json:"direction"`    // "in" or "out"
	Protocol    string `json:"protocol"`     // tcp, udp, icmp, etc.
	Port        string `json:"port"`         // Port or port range
	Source      string `json:"source"`       // Source IP/network/alias
	Destination string `json:"destination"`  // Destination IP/network/alias
	Reason      string `json:"reason"`       // Why it's allowed/blocked (which SG/rule)
	Critical    bool   `json:"critical"`     // Is this a critical flow
}

// AffectedVM represents a VM that may be affected by isolation
type AffectedVM struct {
	VMID       int    `json:"vmid"`
	Name       string `json:"name"`
	Node       string `json:"node"`
	Network    string `json:"network"`
	IPAddress  string `json:"ip_address"`
	Impact     string `json:"impact"`      // "communication_blocked", "no_impact", etc.
	CanResolve bool   `json:"can_resolve"` // Can be resolved with SG
	Resolution string `json:"resolution"`  // Suggested SG to add
}

// VMListForSegmentation represents a list of VMs with their segmentation status
type VMListForSegmentation struct {
	TotalVMs       int                     `json:"total_vms"`
	IsolatedVMs    int                     `json:"isolated_vms"`
	UnprotectedVMs int                     `json:"unprotected_vms"`
	VMs            []VMSegmentationSummary `json:"vms"`
}

// VMSegmentationSummary represents a summary of VM segmentation status
type VMSegmentationSummary struct {
	VMID            int      `json:"vmid"`
	Name            string   `json:"name"`
	Node            string   `json:"node"`
	Type            string   `json:"type"` // qemu or lxc
	Status          string   `json:"status"`
	Network         string   `json:"network"`         // Primary network
	Networks        []string `json:"networks"`        // All networks
	FirewallEnabled bool     `json:"firewall_enabled"`
	IsIsolated      bool     `json:"is_isolated"`
	MissingBaseSGs  []string `json:"missing_base_sgs"`
	AppliedSGs      []string `json:"applied_sgs"`
}
