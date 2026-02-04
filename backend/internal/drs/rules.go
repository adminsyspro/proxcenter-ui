package drs

import (
	"github.com/proxcenter/orchestrator/internal/proxmox"
)

// RuleType defines the type of affinity rule
type RuleType string

const (
	RuleTypeAffinity     RuleType = "affinity"     // VMs should run together
	RuleTypeAntiAffinity RuleType = "anti-affinity" // VMs should run on different nodes
	RuleTypeNodeAffinity RuleType = "node-affinity" // VM should run on specific nodes
)

// AffinityRule defines VM placement constraints
type AffinityRule struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	Type         RuleType `json:"type"`
	ConnectionID string   `json:"connection_id"`
	Enabled      bool     `json:"enabled"`
	
	// For affinity/anti-affinity: list of VMIDs that should/shouldn't be together
	VMIDs []int `json:"vmids,omitempty"`
	
	// For node affinity: list of allowed/preferred nodes
	Nodes []string `json:"nodes,omitempty"`
	
	// Enforcement level
	Required bool `json:"required"` // true = hard constraint, false = preferred
}

// RuleViolation represents a violated affinity rule
type RuleViolation struct {
	Rule      AffinityRule
	VMIDs     []int    // VMs involved in violation
	Nodes     []string // Current nodes
	Severity  string   // critical, warning
	Message   string
}

// RuleEngine handles affinity rule evaluation
type RuleEngine struct {
	rules []AffinityRule
}

// NewRuleEngine creates a new rule engine
func NewRuleEngine() *RuleEngine {
	return &RuleEngine{
		rules: make([]AffinityRule, 0),
	}
}

// AddRule adds a rule to the engine
func (r *RuleEngine) AddRule(rule AffinityRule) {
	r.rules = append(r.rules, rule)
}

// LoadRules loads rules from the database
func (r *RuleEngine) LoadRules(rules []AffinityRule) {
	r.rules = rules
}

// GetRules returns all rules
func (r *RuleEngine) GetRules() []AffinityRule {
	return r.rules
}

// EvaluateRules checks all rules against current VM placement
func (r *RuleEngine) EvaluateRules(vms []proxmox.VM) []RuleViolation {
	var violations []RuleViolation

	// Build VM location map
	vmNodeMap := make(map[int]string)
	for _, vm := range vms {
		vmNodeMap[vm.VMID] = vm.Node
	}

	for _, rule := range r.rules {
		if !rule.Enabled {
			continue
		}

		switch rule.Type {
		case RuleTypeAffinity:
			violation := r.checkAffinityRule(rule, vmNodeMap)
			if violation != nil {
				violations = append(violations, *violation)
			}

		case RuleTypeAntiAffinity:
			violation := r.checkAntiAffinityRule(rule, vmNodeMap)
			if violation != nil {
				violations = append(violations, *violation)
			}

		case RuleTypeNodeAffinity:
			violation := r.checkNodeAffinityRule(rule, vmNodeMap)
			if violation != nil {
				violations = append(violations, *violation)
			}
		}
	}

	return violations
}

// checkAffinityRule verifies that all VMs in the rule are on the same node
func (r *RuleEngine) checkAffinityRule(rule AffinityRule, vmNodeMap map[int]string) *RuleViolation {
	if len(rule.VMIDs) < 2 {
		return nil
	}

	// Find all nodes where rule VMs are located
	nodeSet := make(map[string][]int)
	for _, vmid := range rule.VMIDs {
		if node, ok := vmNodeMap[vmid]; ok {
			nodeSet[node] = append(nodeSet[node], vmid)
		}
	}

	// If VMs are on more than one node, it's a violation
	if len(nodeSet) > 1 {
		var nodes []string
		for n := range nodeSet {
			nodes = append(nodes, n)
		}

		severity := "warning"
		if rule.Required {
			severity = "critical"
		}

		return &RuleViolation{
			Rule:     rule,
			VMIDs:    rule.VMIDs,
			Nodes:    nodes,
			Severity: severity,
			Message:  "Affinity rule violated: VMs should be on the same node",
		}
	}

	return nil
}

// checkAntiAffinityRule verifies that VMs in the rule are on different nodes
func (r *RuleEngine) checkAntiAffinityRule(rule AffinityRule, vmNodeMap map[int]string) *RuleViolation {
	if len(rule.VMIDs) < 2 {
		return nil
	}

	// Group VMs by node
	nodeVMs := make(map[string][]int)
	for _, vmid := range rule.VMIDs {
		if node, ok := vmNodeMap[vmid]; ok {
			nodeVMs[node] = append(nodeVMs[node], vmid)
		}
	}

	// Check for any node with more than one VM from the rule
	for node, vmids := range nodeVMs {
		if len(vmids) > 1 {
			severity := "warning"
			if rule.Required {
				severity = "critical"
			}

			return &RuleViolation{
				Rule:     rule,
				VMIDs:    vmids,
				Nodes:    []string{node},
				Severity: severity,
				Message:  "Anti-affinity rule violated: VMs should be on different nodes",
			}
		}
	}

	return nil
}

// checkNodeAffinityRule verifies that VMs are on allowed nodes
func (r *RuleEngine) checkNodeAffinityRule(rule AffinityRule, vmNodeMap map[int]string) *RuleViolation {
	if len(rule.Nodes) == 0 || len(rule.VMIDs) == 0 {
		return nil
	}

	allowedNodes := make(map[string]bool)
	for _, n := range rule.Nodes {
		allowedNodes[n] = true
	}

	var violatingVMs []int
	var violatingNodes []string

	for _, vmid := range rule.VMIDs {
		if node, ok := vmNodeMap[vmid]; ok {
			if !allowedNodes[node] {
				violatingVMs = append(violatingVMs, vmid)
				violatingNodes = append(violatingNodes, node)
			}
		}
	}

	if len(violatingVMs) > 0 {
		severity := "warning"
		if rule.Required {
			severity = "critical"
		}

		return &RuleViolation{
			Rule:     rule,
			VMIDs:    violatingVMs,
			Nodes:    violatingNodes,
			Severity: severity,
			Message:  "Node affinity rule violated: VMs should run on specific nodes",
		}
	}

	return nil
}

// ValidateMigration checks if a proposed migration would violate any rules
func (r *RuleEngine) ValidateMigration(vmid int, targetNode string, vms []proxmox.VM) []RuleViolation {
	// Create a simulated state with the VM on the target node
	simulatedVMs := make([]proxmox.VM, len(vms))
	copy(simulatedVMs, vms)

	for i := range simulatedVMs {
		if simulatedVMs[i].VMID == vmid {
			simulatedVMs[i].Node = targetNode
			break
		}
	}

	return r.EvaluateRules(simulatedVMs)
}

// FindValidTargetNodes returns nodes that would not violate rules for a VM
func (r *RuleEngine) FindValidTargetNodes(vmid int, candidateNodes []string, vms []proxmox.VM) []string {
	var validNodes []string

	for _, node := range candidateNodes {
		violations := r.ValidateMigration(vmid, node, vms)
		
		// Check for required (hard) rule violations
		hasRequiredViolation := false
		for _, v := range violations {
			if v.Rule.Required {
				hasRequiredViolation = true
				break
			}
		}

		if !hasRequiredViolation {
			validNodes = append(validNodes, node)
		}
	}

	return validNodes
}

// VM Groups for common anti-affinity patterns
type VMGroup struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	ConnectionID string `json:"connection_id"`
	VMIDs        []int  `json:"vmids"`
	Type         string `json:"type"` // e.g., "database-cluster", "web-cluster"
}

// CreateAntiAffinityRuleFromGroup creates an anti-affinity rule from a VM group
func CreateAntiAffinityRuleFromGroup(group VMGroup, required bool) AffinityRule {
	return AffinityRule{
		ID:           group.ID + "-anti-affinity",
		Name:         group.Name + " Anti-Affinity",
		Type:         RuleTypeAntiAffinity,
		ConnectionID: group.ConnectionID,
		Enabled:      true,
		VMIDs:        group.VMIDs,
		Required:     required,
	}
}
