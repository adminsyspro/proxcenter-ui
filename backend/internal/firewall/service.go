package firewall

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"

	"github.com/proxcenter/orchestrator/internal/proxmox"
	"github.com/rs/zerolog/log"
)

// Service provides firewall management functionality
type Service struct {
	pve *proxmox.Manager
}

// NewService creates a new firewall service
func NewService(pve *proxmox.Manager) *Service {
	return &Service{pve: pve}
}

// ================================================================================
// CLUSTER-LEVEL ALIASES
// ================================================================================

// GetAliases returns all cluster-level firewall aliases
func (s *Service) GetAliases(ctx context.Context, connectionID string) ([]Alias, error) {
	client, err := s.pve.GetClient(connectionID)
	if err != nil {
		return nil, err
	}

	data, err := client.Request(ctx, "GET", "/cluster/firewall/aliases", nil)
	if err != nil {
		return nil, fmt.Errorf("failed to get aliases: %w", err)
	}

	var aliases []Alias
	if err := json.Unmarshal(data, &aliases); err != nil {
		return nil, fmt.Errorf("failed to parse aliases: %w", err)
	}

	return aliases, nil
}

// CreateAlias creates a new firewall alias
func (s *Service) CreateAlias(ctx context.Context, connectionID string, req CreateAliasRequest) error {
	client, err := s.pve.GetClient(connectionID)
	if err != nil {
		return err
	}

	form := url.Values{}
	form.Set("name", req.Name)
	form.Set("cidr", req.CIDR)
	if req.Comment != "" {
		form.Set("comment", req.Comment)
	}

	_, err = client.RequestForm(ctx, "POST", "/cluster/firewall/aliases", form)
	if err != nil {
		return fmt.Errorf("failed to create alias: %w", err)
	}

	log.Info().Str("alias", req.Name).Str("cidr", req.CIDR).Msg("Created firewall alias")
	return nil
}

// DeleteAlias deletes a firewall alias
func (s *Service) DeleteAlias(ctx context.Context, connectionID, name string) error {
	client, err := s.pve.GetClient(connectionID)
	if err != nil {
		return err
	}

	_, err = client.Request(ctx, "DELETE", fmt.Sprintf("/cluster/firewall/aliases/%s", name), nil)
	if err != nil {
		return fmt.Errorf("failed to delete alias: %w", err)
	}

	log.Info().Str("alias", name).Msg("Deleted firewall alias")
	return nil
}

// UpdateAlias updates a firewall alias
func (s *Service) UpdateAlias(ctx context.Context, connectionID, name string, req UpdateAliasRequest) error {
	client, err := s.pve.GetClient(connectionID)
	if err != nil {
		return err
	}

	form := url.Values{}
	form.Set("cidr", req.CIDR)
	if req.Comment != "" {
		form.Set("comment", req.Comment)
	}

	_, err = client.RequestForm(ctx, "PUT", fmt.Sprintf("/cluster/firewall/aliases/%s", name), form)
	if err != nil {
		return fmt.Errorf("failed to update alias: %w", err)
	}

	log.Info().Str("alias", name).Str("cidr", req.CIDR).Msg("Updated firewall alias")
	return nil
}

// ================================================================================
// CLUSTER-LEVEL IPSETS
// ================================================================================

// GetIPSets returns all cluster-level IP sets
func (s *Service) GetIPSets(ctx context.Context, connectionID string) ([]IPSet, error) {
	client, err := s.pve.GetClient(connectionID)
	if err != nil {
		return nil, err
	}

	data, err := client.Request(ctx, "GET", "/cluster/firewall/ipset", nil)
	if err != nil {
		return nil, fmt.Errorf("failed to get IP sets: %w", err)
	}

	var ipsets []IPSet
	if err := json.Unmarshal(data, &ipsets); err != nil {
		return nil, fmt.Errorf("failed to parse IP sets: %w", err)
	}

	// Load members for each IP set
	for i := range ipsets {
		members, err := s.GetIPSetMembers(ctx, connectionID, ipsets[i].Name)
		if err != nil {
			log.Warn().Err(err).Str("ipset", ipsets[i].Name).Msg("Failed to get IP set members")
			continue
		}
		ipsets[i].Members = members
	}

	return ipsets, nil
}

// GetIPSetMembers returns the members of an IP set
func (s *Service) GetIPSetMembers(ctx context.Context, connectionID, name string) ([]IPSetEntry, error) {
	client, err := s.pve.GetClient(connectionID)
	if err != nil {
		return nil, err
	}

	data, err := client.Request(ctx, "GET", fmt.Sprintf("/cluster/firewall/ipset/%s", name), nil)
	if err != nil {
		return nil, fmt.Errorf("failed to get IP set members: %w", err)
	}

	var members []IPSetEntry
	if err := json.Unmarshal(data, &members); err != nil {
		return nil, fmt.Errorf("failed to parse IP set members: %w", err)
	}

	return members, nil
}

// CreateIPSet creates a new IP set
func (s *Service) CreateIPSet(ctx context.Context, connectionID string, req CreateIPSetRequest) error {
	client, err := s.pve.GetClient(connectionID)
	if err != nil {
		return err
	}

	form := url.Values{}
	form.Set("name", req.Name)
	if req.Comment != "" {
		form.Set("comment", req.Comment)
	}

	_, err = client.RequestForm(ctx, "POST", "/cluster/firewall/ipset", form)
	if err != nil {
		return fmt.Errorf("failed to create IP set: %w", err)
	}

	log.Info().Str("ipset", req.Name).Msg("Created IP set")
	return nil
}

// AddIPSetEntry adds an entry to an IP set
func (s *Service) AddIPSetEntry(ctx context.Context, connectionID, ipsetName string, req AddIPSetEntryRequest) error {
	client, err := s.pve.GetClient(connectionID)
	if err != nil {
		return err
	}

	form := url.Values{}
	form.Set("cidr", req.CIDR)
	if req.Comment != "" {
		form.Set("comment", req.Comment)
	}
	if req.NoMatch {
		form.Set("nomatch", "1")
	}

	_, err = client.RequestForm(ctx, "POST", fmt.Sprintf("/cluster/firewall/ipset/%s", ipsetName), form)
	if err != nil {
		return fmt.Errorf("failed to add IP set entry: %w", err)
	}

	log.Info().Str("ipset", ipsetName).Str("cidr", req.CIDR).Msg("Added IP set entry")
	return nil
}

// DeleteIPSetEntry removes an entry from an IP set
func (s *Service) DeleteIPSetEntry(ctx context.Context, connectionID, ipsetName, cidr string) error {
	client, err := s.pve.GetClient(connectionID)
	if err != nil {
		return err
	}

	// URL encode the CIDR (replace / with %2F)
	encodedCIDR := url.PathEscape(cidr)

	_, err = client.Request(ctx, "DELETE", fmt.Sprintf("/cluster/firewall/ipset/%s/%s", ipsetName, encodedCIDR), nil)
	if err != nil {
		return fmt.Errorf("failed to delete IP set entry: %w", err)
	}

	log.Info().Str("ipset", ipsetName).Str("cidr", cidr).Msg("Deleted IP set entry")
	return nil
}

// DeleteIPSet deletes an IP set (must be empty)
func (s *Service) DeleteIPSet(ctx context.Context, connectionID, name string) error {
	client, err := s.pve.GetClient(connectionID)
	if err != nil {
		return err
	}

	_, err = client.Request(ctx, "DELETE", fmt.Sprintf("/cluster/firewall/ipset/%s", name), nil)
	if err != nil {
		return fmt.Errorf("failed to delete IP set: %w", err)
	}

	log.Info().Str("ipset", name).Msg("Deleted IP set")
	return nil
}

// ================================================================================
// SECURITY GROUPS
// ================================================================================

// GetSecurityGroups returns all security groups
func (s *Service) GetSecurityGroups(ctx context.Context, connectionID string) ([]SecurityGroup, error) {
	client, err := s.pve.GetClient(connectionID)
	if err != nil {
		return nil, err
	}

	data, err := client.Request(ctx, "GET", "/cluster/firewall/groups", nil)
	if err != nil {
		return nil, fmt.Errorf("failed to get security groups: %w", err)
	}

	var groups []SecurityGroup
	if err := json.Unmarshal(data, &groups); err != nil {
		return nil, fmt.Errorf("failed to parse security groups: %w", err)
	}

	// Load rules for each group
	for i := range groups {
		rules, err := s.GetSecurityGroupRules(ctx, connectionID, groups[i].Group)
		if err != nil {
			log.Warn().Err(err).Str("group", groups[i].Group).Msg("Failed to get security group rules")
			continue
		}
		groups[i].Rules = rules
	}

	return groups, nil
}

// GetSecurityGroupRules returns the rules of a security group
func (s *Service) GetSecurityGroupRules(ctx context.Context, connectionID, groupName string) ([]FirewallRule, error) {
	client, err := s.pve.GetClient(connectionID)
	if err != nil {
		return nil, err
	}

	data, err := client.Request(ctx, "GET", fmt.Sprintf("/cluster/firewall/groups/%s", groupName), nil)
	if err != nil {
		return nil, fmt.Errorf("failed to get security group rules: %w", err)
	}

	var rules []FirewallRule
	if err := json.Unmarshal(data, &rules); err != nil {
		return nil, fmt.Errorf("failed to parse security group rules: %w", err)
	}

	return rules, nil
}

// CreateSecurityGroup creates a new security group
func (s *Service) CreateSecurityGroup(ctx context.Context, connectionID string, req CreateSecurityGroupRequest) error {
	client, err := s.pve.GetClient(connectionID)
	if err != nil {
		return err
	}

	form := url.Values{}
	form.Set("group", req.Group)
	if req.Comment != "" {
		form.Set("comment", req.Comment)
	}

	_, err = client.RequestForm(ctx, "POST", "/cluster/firewall/groups", form)
	if err != nil {
		return fmt.Errorf("failed to create security group: %w", err)
	}

	log.Info().Str("group", req.Group).Msg("Created security group")
	return nil
}

// AddSecurityGroupRule adds a rule to a security group
func (s *Service) AddSecurityGroupRule(ctx context.Context, connectionID, groupName string, req CreateRuleRequest) error {
	client, err := s.pve.GetClient(connectionID)
	if err != nil {
		return err
	}

	form := s.ruleToForm(req)

	_, err = client.RequestForm(ctx, "POST", fmt.Sprintf("/cluster/firewall/groups/%s", groupName), form)
	if err != nil {
		return fmt.Errorf("failed to add security group rule: %w", err)
	}

	log.Info().Str("group", groupName).Str("action", req.Action).Msg("Added security group rule")
	return nil
}

// AddSecurityGroupRuleAtPos adds a rule to a security group at a specific position
func (s *Service) AddSecurityGroupRuleAtPos(ctx context.Context, connectionID, groupName string, pos int, req CreateRuleRequest) error {
	client, err := s.pve.GetClient(connectionID)
	if err != nil {
		return err
	}

	form := s.ruleToForm(req)
	form.Set("pos", fmt.Sprintf("%d", pos))

	_, err = client.RequestForm(ctx, "POST", fmt.Sprintf("/cluster/firewall/groups/%s", groupName), form)
	if err != nil {
		return fmt.Errorf("failed to add security group rule at pos %d: %w", pos, err)
	}

	log.Info().Str("group", groupName).Str("action", req.Action).Int("pos", pos).Msg("Added security group rule at position")
	return nil
}

// DeleteSecurityGroupRule deletes a rule from a security group
func (s *Service) DeleteSecurityGroupRule(ctx context.Context, connectionID, groupName string, pos int) error {
	client, err := s.pve.GetClient(connectionID)
	if err != nil {
		return err
	}

	_, err = client.Request(ctx, "DELETE", fmt.Sprintf("/cluster/firewall/groups/%s/%d", groupName, pos), nil)
	if err != nil {
		return fmt.Errorf("failed to delete security group rule: %w", err)
	}

	log.Info().Str("group", groupName).Int("pos", pos).Msg("Deleted security group rule")
	return nil
}

// UpdateSecurityGroupRule updates a rule in a security group
func (s *Service) UpdateSecurityGroupRule(ctx context.Context, connectionID, groupName string, pos int, req UpdateRuleRequest) error {
	client, err := s.pve.GetClient(connectionID)
	if err != nil {
		return err
	}

	form := url.Values{}
	if req.Type != "" {
		form.Set("type", req.Type)
	}
	if req.Action != "" {
		form.Set("action", req.Action)
	}
	if req.Enable != nil {
		form.Set("enable", fmt.Sprintf("%d", *req.Enable))
	}
	if req.Source != "" {
		form.Set("source", req.Source)
	}
	if req.Dest != "" {
		form.Set("dest", req.Dest)
	}
	if req.Proto != "" {
		form.Set("proto", req.Proto)
	}
	if req.Dport != "" {
		form.Set("dport", req.Dport)
	}
	if req.Sport != "" {
		form.Set("sport", req.Sport)
	}
	if req.Macro != "" {
		form.Set("macro", req.Macro)
	}
	if req.Iface != "" {
		form.Set("iface", req.Iface)
	}
	if req.Log != "" {
		form.Set("log", req.Log)
	}
	if req.Comment != "" {
		form.Set("comment", req.Comment)
	}
	if req.Moveto != nil {
		form.Set("moveto", fmt.Sprintf("%d", *req.Moveto))
	}

	_, err = client.RequestForm(ctx, "PUT", fmt.Sprintf("/cluster/firewall/groups/%s/%d", groupName, pos), form)
	if err != nil {
		return fmt.Errorf("failed to update security group rule: %w", err)
	}

	log.Info().Str("group", groupName).Int("pos", pos).Msg("Updated security group rule")
	return nil
}

// DeleteSecurityGroup deletes a security group (must be empty)
func (s *Service) DeleteSecurityGroup(ctx context.Context, connectionID, name string) error {
	client, err := s.pve.GetClient(connectionID)
	if err != nil {
		return err
	}

	_, err = client.Request(ctx, "DELETE", fmt.Sprintf("/cluster/firewall/groups/%s", name), nil)
	if err != nil {
		return fmt.Errorf("failed to delete security group: %w", err)
	}

	log.Info().Str("group", name).Msg("Deleted security group")
	return nil
}

// ================================================================================
// CLUSTER-LEVEL RULES & OPTIONS
// ================================================================================

// GetClusterRules returns cluster-level firewall rules
func (s *Service) GetClusterRules(ctx context.Context, connectionID string) ([]FirewallRule, error) {
	client, err := s.pve.GetClient(connectionID)
	if err != nil {
		return nil, err
	}

	data, err := client.Request(ctx, "GET", "/cluster/firewall/rules", nil)
	if err != nil {
		return nil, fmt.Errorf("failed to get cluster rules: %w", err)
	}

	var rules []FirewallRule
	if err := json.Unmarshal(data, &rules); err != nil {
		return nil, fmt.Errorf("failed to parse cluster rules: %w", err)
	}

	return rules, nil
}

// AddClusterRule adds a cluster-level firewall rule
func (s *Service) AddClusterRule(ctx context.Context, connectionID string, req CreateRuleRequest) error {
	client, err := s.pve.GetClient(connectionID)
	if err != nil {
		return err
	}

	form := s.ruleToForm(req)

	_, err = client.RequestForm(ctx, "POST", "/cluster/firewall/rules", form)
	if err != nil {
		return fmt.Errorf("failed to add cluster rule: %w", err)
	}

	log.Info().Str("action", req.Action).Msg("Added cluster firewall rule")
	return nil
}

// GetClusterOptions returns cluster-level firewall options
func (s *Service) GetClusterOptions(ctx context.Context, connectionID string) (*ClusterOptions, error) {
	client, err := s.pve.GetClient(connectionID)
	if err != nil {
		return nil, err
	}

	data, err := client.Request(ctx, "GET", "/cluster/firewall/options", nil)
	if err != nil {
		return nil, fmt.Errorf("failed to get cluster options: %w", err)
	}

	var options ClusterOptions
	if err := json.Unmarshal(data, &options); err != nil {
		return nil, fmt.Errorf("failed to parse cluster options: %w", err)
	}

	return &options, nil
}

// UpdateClusterOptions updates cluster-level firewall options
func (s *Service) UpdateClusterOptions(ctx context.Context, connectionID string, req UpdateOptionsRequest) error {
	client, err := s.pve.GetClient(connectionID)
	if err != nil {
		return err
	}

	form := url.Values{}
	if req.Enable != nil {
		form.Set("enable", fmt.Sprintf("%d", *req.Enable))
	}
	if req.PolicyIn != nil {
		form.Set("policy_in", *req.PolicyIn)
	}
	if req.PolicyOut != nil {
		form.Set("policy_out", *req.PolicyOut)
	}

	_, err = client.RequestForm(ctx, "PUT", "/cluster/firewall/options", form)
	if err != nil {
		return fmt.Errorf("failed to update cluster options: %w", err)
	}

	log.Info().Msg("Updated cluster firewall options")
	return nil
}

// ================================================================================
// NODE-LEVEL FIREWALL
// ================================================================================

// GetNodeOptions returns node-level firewall options
func (s *Service) GetNodeOptions(ctx context.Context, connectionID, node string) (*NodeOptions, error) {
	client, err := s.pve.GetClient(connectionID)
	if err != nil {
		return nil, err
	}

	data, err := client.Request(ctx, "GET", fmt.Sprintf("/nodes/%s/firewall/options", node), nil)
	if err != nil {
		return nil, fmt.Errorf("failed to get node options: %w", err)
	}

	var options NodeOptions
	if err := json.Unmarshal(data, &options); err != nil {
		return nil, fmt.Errorf("failed to parse node options: %w", err)
	}

	return &options, nil
}

// UpdateNodeOptions updates node-level firewall options
func (s *Service) UpdateNodeOptions(ctx context.Context, connectionID, node string, req UpdateOptionsRequest) error {
	client, err := s.pve.GetClient(connectionID)
	if err != nil {
		return err
	}

	form := url.Values{}
	if req.Enable != nil {
		form.Set("enable", fmt.Sprintf("%d", *req.Enable))
	}
	if req.PolicyIn != nil {
		form.Set("policy_in", *req.PolicyIn)
	}
	if req.PolicyOut != nil {
		form.Set("policy_out", *req.PolicyOut)
	}

	_, err = client.RequestForm(ctx, "PUT", fmt.Sprintf("/nodes/%s/firewall/options", node), form)
	if err != nil {
		return fmt.Errorf("failed to update node options: %w", err)
	}

	log.Info().Str("node", node).Msg("Updated node firewall options")
	return nil
}

// GetNodeRules returns node-level firewall rules
func (s *Service) GetNodeRules(ctx context.Context, connectionID, node string) ([]FirewallRule, error) {
	client, err := s.pve.GetClient(connectionID)
	if err != nil {
		return nil, err
	}

	data, err := client.Request(ctx, "GET", fmt.Sprintf("/nodes/%s/firewall/rules", node), nil)
	if err != nil {
		return nil, fmt.Errorf("failed to get node rules: %w", err)
	}

	var rules []FirewallRule
	if err := json.Unmarshal(data, &rules); err != nil {
		return nil, fmt.Errorf("failed to parse node rules: %w", err)
	}

	return rules, nil
}

// AddNodeRule adds a node-level firewall rule
func (s *Service) AddNodeRule(ctx context.Context, connectionID, node string, req CreateRuleRequest) error {
	client, err := s.pve.GetClient(connectionID)
	if err != nil {
		return err
	}

	form := s.ruleToForm(req)

	_, err = client.RequestForm(ctx, "POST", fmt.Sprintf("/nodes/%s/firewall/rules", node), form)
	if err != nil {
		return fmt.Errorf("failed to add node rule: %w", err)
	}

	log.Info().Str("node", node).Str("action", req.Action).Msg("Added node firewall rule")
	return nil
}

// ================================================================================
// VM/CT-LEVEL FIREWALL
// ================================================================================

// GetVMOptions returns VM/CT-level firewall options
func (s *Service) GetVMOptions(ctx context.Context, connectionID, node string, vmid int, vmType string) (*VMOptions, error) {
	client, err := s.pve.GetClient(connectionID)
	if err != nil {
		return nil, err
	}

	path := fmt.Sprintf("/nodes/%s/%s/%d/firewall/options", node, vmType, vmid)
	data, err := client.Request(ctx, "GET", path, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to get VM options: %w", err)
	}

	var options VMOptions
	if err := json.Unmarshal(data, &options); err != nil {
		return nil, fmt.Errorf("failed to parse VM options: %w", err)
	}

	return &options, nil
}

// UpdateVMOptions updates VM/CT-level firewall options
func (s *Service) UpdateVMOptions(ctx context.Context, connectionID, node string, vmid int, vmType string, req UpdateOptionsRequest) error {
	client, err := s.pve.GetClient(connectionID)
	if err != nil {
		return err
	}

	form := url.Values{}
	if req.Enable != nil {
		form.Set("enable", fmt.Sprintf("%d", *req.Enable))
	}
	if req.PolicyIn != nil {
		form.Set("policy_in", *req.PolicyIn)
	}
	if req.PolicyOut != nil {
		form.Set("policy_out", *req.PolicyOut)
	}

	path := fmt.Sprintf("/nodes/%s/%s/%d/firewall/options", node, vmType, vmid)
	_, err = client.RequestForm(ctx, "PUT", path, form)
	if err != nil {
		return fmt.Errorf("failed to update VM options: %w", err)
	}

	log.Info().Str("node", node).Int("vmid", vmid).Msg("Updated VM firewall options")
	return nil
}

// GetVMRules returns VM/CT-level firewall rules
func (s *Service) GetVMRules(ctx context.Context, connectionID, node string, vmid int, vmType string) ([]FirewallRule, error) {
	client, err := s.pve.GetClient(connectionID)
	if err != nil {
		return nil, err
	}

	path := fmt.Sprintf("/nodes/%s/%s/%d/firewall/rules", node, vmType, vmid)
	data, err := client.Request(ctx, "GET", path, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to get VM rules: %w", err)
	}

	var rules []FirewallRule
	if err := json.Unmarshal(data, &rules); err != nil {
		return nil, fmt.Errorf("failed to parse VM rules: %w", err)
	}

	return rules, nil
}

// AddVMRule adds a VM/CT-level firewall rule
func (s *Service) AddVMRule(ctx context.Context, connectionID, node string, vmid int, vmType string, req CreateRuleRequest) error {
	client, err := s.pve.GetClient(connectionID)
	if err != nil {
		return err
	}

	form := s.ruleToForm(req)

	path := fmt.Sprintf("/nodes/%s/%s/%d/firewall/rules", node, vmType, vmid)
	_, err = client.RequestForm(ctx, "POST", path, form)
	if err != nil {
		return fmt.Errorf("failed to add VM rule: %w", err)
	}

	log.Info().Str("node", node).Int("vmid", vmid).Str("action", req.Action).Msg("Added VM firewall rule")
	return nil
}

// DeleteVMRule deletes a VM/CT-level firewall rule
func (s *Service) DeleteVMRule(ctx context.Context, connectionID, node string, vmid int, vmType string, pos int) error {
	client, err := s.pve.GetClient(connectionID)
	if err != nil {
		return err
	}

	path := fmt.Sprintf("/nodes/%s/%s/%d/firewall/rules/%d", node, vmType, vmid, pos)
	_, err = client.Request(ctx, "DELETE", path, nil)
	if err != nil {
		return fmt.Errorf("failed to delete VM rule: %w", err)
	}

	log.Info().Str("node", node).Int("vmid", vmid).Int("pos", pos).Msg("Deleted VM firewall rule")
	return nil
}

// UpdateVMRule updates a VM/CT-level firewall rule
func (s *Service) UpdateVMRule(ctx context.Context, connectionID, node string, vmid int, vmType string, pos int, req UpdateRuleRequest) error {
	client, err := s.pve.GetClient(connectionID)
	if err != nil {
		return err
	}

	form := url.Values{}
	if req.Type != "" {
		form.Set("type", req.Type)
	}
	if req.Action != "" {
		form.Set("action", req.Action)
	}
	if req.Enable != nil {
		form.Set("enable", fmt.Sprintf("%d", *req.Enable))
	}
	if req.Source != "" {
		form.Set("source", req.Source)
	}
	if req.Dest != "" {
		form.Set("dest", req.Dest)
	}
	if req.Proto != "" {
		form.Set("proto", req.Proto)
	}
	if req.Dport != "" {
		form.Set("dport", req.Dport)
	}
	if req.Sport != "" {
		form.Set("sport", req.Sport)
	}
	if req.Macro != "" {
		form.Set("macro", req.Macro)
	}
	if req.Iface != "" {
		form.Set("iface", req.Iface)
	}
	if req.Log != "" {
		form.Set("log", req.Log)
	}
	if req.Comment != "" {
		form.Set("comment", req.Comment)
	}
	if req.Moveto != nil {
		form.Set("moveto", fmt.Sprintf("%d", *req.Moveto))
	}

	path := fmt.Sprintf("/nodes/%s/%s/%d/firewall/rules/%d", node, vmType, vmid, pos)
	_, err = client.RequestForm(ctx, "PUT", path, form)
	if err != nil {
		return fmt.Errorf("failed to update VM rule: %w", err)
	}

	log.Info().Str("node", node).Int("vmid", vmid).Int("pos", pos).Msg("Updated VM firewall rule")
	return nil
}

// FirewallLogEntry represents a firewall log entry
type FirewallLogEntry struct {
	N int    `json:"n"`
	T string `json:"t"`
}

// GetVMFirewallLog gets firewall logs for a VM/CT
func (s *Service) GetVMFirewallLog(ctx context.Context, connectionID, node string, vmid int, vmType string, limit int) ([]FirewallLogEntry, error) {
	client, err := s.pve.GetClient(connectionID)
	if err != nil {
		return nil, err
	}

	path := fmt.Sprintf("/nodes/%s/%s/%d/firewall/log?limit=%d", node, vmType, vmid, limit)
	data, err := client.Request(ctx, "GET", path, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to get firewall log: %w", err)
	}

	var logs []FirewallLogEntry
	if err := json.Unmarshal(data, &logs); err != nil {
		return nil, fmt.Errorf("failed to parse firewall log: %w", err)
	}

	return logs, nil
}

// ================================================================================
// STATUS & MACROS
// ================================================================================

// GetFirewallStatus returns the overall firewall status
func (s *Service) GetFirewallStatus(ctx context.Context, connectionID string) (*FirewallStatus, error) {
	client, err := s.pve.GetClient(connectionID)
	if err != nil {
		return nil, err
	}

	status := &FirewallStatus{}

	// Get cluster options
	clusterOpts, err := s.GetClusterOptions(ctx, connectionID)
	if err == nil {
		status.ClusterEnabled = clusterOpts.Enable == 1
	}

	// Get aliases count
	aliases, err := s.GetAliases(ctx, connectionID)
	if err == nil {
		status.TotalAliases = len(aliases)
	}

	// Get IP sets count
	ipsets, err := s.GetIPSets(ctx, connectionID)
	if err == nil {
		status.TotalIPSets = len(ipsets)
	}

	// Get security groups count
	groups, err := s.GetSecurityGroups(ctx, connectionID)
	if err == nil {
		status.TotalGroups = len(groups)
	}

	// Get cluster rules count
	rules, err := s.GetClusterRules(ctx, connectionID)
	if err == nil {
		status.TotalClusterRules = len(rules)
	}

	// Get nodes info
	nodes, err := client.GetNodes(ctx)
	if err == nil {
		status.TotalNodes = len(nodes)
		for _, node := range nodes {
			opts, err := s.GetNodeOptions(ctx, connectionID, node.Node)
			if err == nil && opts.Enable == 1 {
				status.ProtectedNodes++
			}
		}
	}

	// Get VMs info
	vms, err := client.GetVMs(ctx)
	if err == nil {
		status.TotalVMs = len(vms)
		for _, vm := range vms {
			vmType := "qemu"
			if vm.Type == "lxc" {
				vmType = "lxc"
			}
			opts, err := s.GetVMOptions(ctx, connectionID, vm.Node, vm.VMID, vmType)
			if err == nil && opts.Enable == 1 {
				status.ProtectedVMs++
			}
		}
	}

	if status.ClusterEnabled {
		status.Status = "enabled/running"
	} else {
		status.Status = "disabled"
	}

	return status, nil
}

// GetMacros returns available firewall macros
func (s *Service) GetMacros(ctx context.Context, connectionID string) ([]Macro, error) {
	client, err := s.pve.GetClient(connectionID)
	if err != nil {
		return nil, err
	}

	// Proxmox provides macros at /cluster/firewall/macros
	data, err := client.Request(ctx, "GET", "/cluster/firewall/macros", nil)
	if err != nil {
		// If not available, return common macros
		return CommonMacros, nil
	}

	var macros []Macro
	if err := json.Unmarshal(data, &macros); err != nil {
		return CommonMacros, nil
	}

	return macros, nil
}

// ================================================================================
// HELPERS
// ================================================================================

// ruleToForm converts a CreateRuleRequest to url.Values
func (s *Service) ruleToForm(req CreateRuleRequest) url.Values {
	form := url.Values{}

	form.Set("type", req.Type)
	form.Set("action", req.Action)

	if req.Enable != 0 {
		form.Set("enable", fmt.Sprintf("%d", req.Enable))
	} else {
		form.Set("enable", "1") // Default to enabled
	}

	if req.Source != "" {
		form.Set("source", req.Source)
	}
	if req.Dest != "" {
		form.Set("dest", req.Dest)
	}
	if req.Proto != "" {
		form.Set("proto", req.Proto)
	}
	if req.Dport != "" {
		form.Set("dport", req.Dport)
	}
	if req.Sport != "" {
		form.Set("sport", req.Sport)
	}
	if req.Macro != "" {
		form.Set("macro", req.Macro)
	}
	if req.Group != "" {
		form.Set("group", req.Group)
	}
	if req.Iface != "" {
		form.Set("iface", req.Iface)
	}
	if req.Log != "" {
		form.Set("log", req.Log)
	}
	if req.Comment != "" {
		form.Set("comment", req.Comment)
	}
	if req.Pos > 0 {
		form.Set("pos", fmt.Sprintf("%d", req.Pos))
	}

	return form
}

// ================================================================================
// MICRO-SEGMENTATION
// ================================================================================

// AnalyzeMicrosegmentation analyzes the current micro-segmentation state
func (s *Service) AnalyzeMicrosegmentation(ctx context.Context, connectionID string, gatewayOffset int) (*MicrosegAnalysis, error) {
	analysis := &MicrosegAnalysis{
		Networks:        []NetworkInfo{},
		GatewayAliases:  []string{},
		BaseSGs:         []string{},
		MissingGateways: []MissingGateway{},
		MissingBaseSGs:  []MissingBaseSG{},
	}

	// Default gateway offset
	if gatewayOffset <= 0 || gatewayOffset > 254 {
		gatewayOffset = 254
	}

	// Get all aliases
	aliases, err := s.GetAliases(ctx, connectionID)
	if err != nil {
		return nil, fmt.Errorf("failed to get aliases: %w", err)
	}

	// Build maps for quick lookup
	gwMap := make(map[string]string)    // gw-xxx -> IP
	netMap := make(map[string]Alias)    // net-xxx -> Alias

	for _, alias := range aliases {
		if len(alias.Name) > 3 && alias.Name[:3] == "gw-" {
			analysis.GatewayAliases = append(analysis.GatewayAliases, alias.Name)
			gwMap[alias.Name] = alias.CIDR
		} else if len(alias.Name) > 4 && alias.Name[:4] == "net-" {
			netMap[alias.Name] = alias
		}
	}

	// Get all security groups
	groups, err := s.GetSecurityGroups(ctx, connectionID)
	if err != nil {
		return nil, fmt.Errorf("failed to get security groups: %w", err)
	}

	// Build base SG map
	baseSGMap := make(map[string]bool)
	for _, group := range groups {
		if len(group.Group) > 8 && group.Group[:8] == "sg-base-" {
			analysis.BaseSGs = append(analysis.BaseSGs, group.Group)
			baseSGMap[group.Group] = true
		}
	}

	// Analyze each network
	for name, alias := range netMap {
		// Extract network suffix (e.g., "dmz-k8s" from "net-dmz-k8s")
		suffix := name[4:] // Remove "net-"
		gwName := "gw-" + suffix
		sgName := "sg-base-" + suffix

		// Compute gateway IP with configured offset
		gatewayIP := computeGatewayIP(alias.CIDR, gatewayOffset)

		netInfo := NetworkInfo{
			Name:       name,
			CIDR:       alias.CIDR,
			Comment:    alias.Comment,
			Gateway:    gatewayIP,
			HasGateway: gwMap[gwName] != "",
			HasBaseSG:  baseSGMap[sgName],
		}
		analysis.Networks = append(analysis.Networks, netInfo)

		// Track missing items
		if !netInfo.HasGateway {
			analysis.MissingGateways = append(analysis.MissingGateways, MissingGateway{
				NetworkName: name,
				AliasName:   gwName,
				GatewayIP:   gatewayIP,
			})
		}
		if !netInfo.HasBaseSG {
			analysis.MissingBaseSGs = append(analysis.MissingBaseSGs, MissingBaseSG{
				NetworkName: name,
				SGName:      sgName,
				GatewayName: gwName,
			})
		}
	}

	// Analyze VMs
	client, err := s.pve.GetClient(connectionID)
	if err != nil {
		return nil, fmt.Errorf("failed to get client: %w", err)
	}

	vms, err := client.GetVMs(ctx)
	if err != nil {
		log.Warn().Err(err).Msg("Failed to get VMs for analysis")
	} else {
		analysis.TotalVMs = len(vms)
		for _, vm := range vms {
			vmType := "qemu"
			if vm.Type == "lxc" {
				vmType = "lxc"
			}

			opts, err := s.GetVMOptions(ctx, connectionID, vm.Node, vm.VMID, vmType)
			if err != nil {
				continue
			}

			if opts.Enable != 1 {
				analysis.UnprotectedVMs++
				continue
			}

			// Check if VM has a base SG applied
			rules, err := s.GetVMRules(ctx, connectionID, vm.Node, vm.VMID, vmType)
			if err != nil {
				continue
			}

			hasBaseSG := false
			for _, rule := range rules {
				if rule.Type == "group" && len(rule.Action) > 8 && rule.Action[:8] == "sg-base-" {
					hasBaseSG = true
					break
				}
			}

			if hasBaseSG {
				analysis.IsolatedVMs++
			}
		}
	}

	analysis.SegmentationReady = len(analysis.MissingBaseSGs) == 0 && len(analysis.MissingGateways) == 0

	return analysis, nil
}

// GenerateBaseSGs generates gateway aliases and base security groups
func (s *Service) GenerateBaseSGs(ctx context.Context, connectionID string, req GenerateBaseSGsRequest) (*GenerateBaseSGsResult, error) {
	result := &GenerateBaseSGsResult{
		CreatedAliases: []string{},
		CreatedGroups:  []string{},
		Errors:         []string{},
		DryRun:         req.DryRun,
		Plan:           []PlannedAction{},
	}

	// Default gateway offset
	gwOffset := req.GatewayOffset
	if gwOffset == 0 {
		gwOffset = 254
	}

	// Get current analysis
	analysis, err := s.AnalyzeMicrosegmentation(ctx, connectionID, gwOffset)
	if err != nil {
		return nil, fmt.Errorf("failed to analyze: %w", err)
	}

	// Filter networks if specific ones requested
	networks := analysis.Networks
	if len(req.Networks) > 0 {
		filtered := []NetworkInfo{}
		netSet := make(map[string]bool)
		for _, n := range req.Networks {
			netSet[n] = true
		}
		for _, net := range networks {
			if netSet[net.Name] {
				filtered = append(filtered, net)
			}
		}
		networks = filtered
	}

	// Process each network
	for _, net := range networks {
		suffix := net.Name[4:] // Remove "net-"
		gwName := "gw-" + suffix
		sgName := "sg-base-" + suffix
		gwIP := computeGatewayIP(net.CIDR, gwOffset)

		// Create gateway alias if missing and requested
		if !net.HasGateway && req.CreateGateways {
			if req.DryRun {
				result.Plan = append(result.Plan, PlannedAction{
					Type:        "alias",
					Name:        gwName,
					Description: fmt.Sprintf("Gateway for %s: %s", net.Name, gwIP),
				})
			} else {
				err := s.CreateAlias(ctx, connectionID, CreateAliasRequest{
					Name:    gwName,
					CIDR:    gwIP,
					Comment: fmt.Sprintf("Gateway for %s", net.Name),
				})
				if err != nil {
					result.Errors = append(result.Errors, fmt.Sprintf("Failed to create alias %s: %v", gwName, err))
				} else {
					result.CreatedAliases = append(result.CreatedAliases, gwName)
				}
			}
		}

		// Create base security group if missing
		if !net.HasBaseSG {
			if req.DryRun {
				result.Plan = append(result.Plan, PlannedAction{
					Type:        "security_group",
					Name:        sgName,
					Description: fmt.Sprintf("Base isolation for %s (gateway: %s, block: %s)", net.Name, gwName, net.Name),
				})
			} else {
				// Create the security group
				err := s.CreateSecurityGroup(ctx, connectionID, CreateSecurityGroupRequest{
					Group:   sgName,
					Comment: fmt.Sprintf("Base VLAN isolation for %s", net.Name),
				})
				if err != nil {
					result.Errors = append(result.Errors, fmt.Sprintf("Failed to create SG %s: %v", sgName, err))
					continue
				}

				// Add rules to the security group
				// Rule 1: OUT ACCEPT to gateway
				s.AddSecurityGroupRule(ctx, connectionID, sgName, CreateRuleRequest{
					Type:    "out",
					Action:  "ACCEPT",
					Dest:    gwName,
					Enable:  1,
					Comment: "Allow gateway",
				})

				// Rule 2: IN ACCEPT from gateway
				s.AddSecurityGroupRule(ctx, connectionID, sgName, CreateRuleRequest{
					Type:    "in",
					Action:  "ACCEPT",
					Source:  gwName,
					Enable:  1,
					Comment: "Allow from gateway",
				})

				// Rule 3: OUT DROP to VLAN
				s.AddSecurityGroupRule(ctx, connectionID, sgName, CreateRuleRequest{
					Type:    "out",
					Action:  "DROP",
					Dest:    net.Name,
					Log:     "nolog",
					Enable:  1,
					Comment: "Block outbound to VLAN",
				})

				// Rule 4: IN DROP from VLAN
				s.AddSecurityGroupRule(ctx, connectionID, sgName, CreateRuleRequest{
					Type:    "in",
					Action:  "DROP",
					Source:  net.Name,
					Log:     "nolog",
					Enable:  1,
					Comment: "Block inbound from VLAN",
				})

				result.CreatedGroups = append(result.CreatedGroups, sgName)
			}
		}
	}

	return result, nil
}

// GetVMSegmentationStatus returns the segmentation status of a VM
func (s *Service) GetVMSegmentationStatus(ctx context.Context, connectionID, node string, vmid int, vmType string) (*VMSegmentationStatus, error) {
	status := &VMSegmentationStatus{
		VMID:            vmid,
		Node:            node,
		Networks:        []VMNetworkInfo{},
		AppliedBaseSGs:  []string{},
		AppliedSGs:      []string{},
		Recommendations: []string{},
	}

	client, err := s.pve.GetClient(connectionID)
	if err != nil {
		return nil, fmt.Errorf("failed to get client: %w", err)
	}

	// Get VM config based on type
	var vmConfig map[string]interface{}
	if vmType == "lxc" {
		vmConfig, err = client.GetLXCConfig(ctx, node, vmid)
	} else {
		vmConfig, err = client.GetVMConfig(ctx, node, vmid)
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get VM config: %w", err)
	}

	// Get VM name from config
	if name, ok := vmConfig["name"].(string); ok {
		status.Name = name
	}

	// Get firewall options
	opts, err := s.GetVMOptions(ctx, connectionID, node, vmid, vmType)
	if err == nil {
		status.FirewallEnabled = opts.Enable == 1
		status.PolicyIn = opts.PolicyIn
		status.PolicyOut = opts.PolicyOut
	}

	// Get firewall rules
	rules, err := s.GetVMRules(ctx, connectionID, node, vmid, vmType)
	if err == nil {
		for _, rule := range rules {
			if rule.Type == "group" {
				status.AppliedSGs = append(status.AppliedSGs, rule.Action)
				if len(rule.Action) > 8 && rule.Action[:8] == "sg-base-" {
					status.AppliedBaseSGs = append(status.AppliedBaseSGs, rule.Action)
				}
			} else {
				status.DirectRules++
			}
		}
	}

	status.IsIsolated = len(status.AppliedBaseSGs) > 0

	// Get aliases for network detection
	aliases, _ := s.GetAliases(ctx, connectionID)
	networkAliases := make(map[string]string) // alias name -> CIDR
	for _, alias := range aliases {
		if len(alias.Name) > 4 && alias.Name[:4] == "net-" {
			networkAliases[alias.Name] = alias.CIDR
		}
	}

	// Parse NICs and detect networks
	for i := 0; i < 10; i++ {
		netKey := fmt.Sprintf("net%d", i)
		if netConfig, ok := vmConfig[netKey]; ok {
			nicInfo := VMNetworkInfo{
				Interface: netKey,
			}

			// Parse NIC config (it's a string like "virtio=XX:XX:XX,bridge=vmbr0,firewall=1,ip=10.17.17.50/24")
			if configStr, ok := netConfig.(string); ok {
				parts := splitNicConfig(configStr)
				for k, v := range parts {
					switch k {
					case "bridge":
						nicInfo.Bridge = v
					case "firewall":
						nicInfo.Firewall = v == "1"
					case "ip":
						nicInfo.IPAddress = v
					case "tag":
						nicInfo.Tag = v
					}
				}
				
				// Method 1: Detect network by IP address
				if ip, ok := parts["ip"]; ok && ip != "" && ip != "dhcp" {
					ipAddr := ip
					if slashIdx := indexOf(ip, '/'); slashIdx > 0 {
						ipAddr = ip[:slashIdx]
					}
					nicInfo.IPAddress = ipAddr
					
					for aliasName, cidr := range networkAliases {
						if ipInCIDR(ipAddr, cidr) {
							nicInfo.Network = aliasName
							nicInfo.Gateway = "gw-" + aliasName[4:]
							nicInfo.BaseSG = "sg-base-" + aliasName[4:]
							break
						}
					}
				}
				
				// Method 2: Detect by VLAN tag
				if nicInfo.Network == "" {
					if tag, ok := parts["tag"]; ok && tag != "" {
						for aliasName, cidr := range networkAliases {
							if cidrContainsTag(cidr, tag) {
								nicInfo.Network = aliasName
								nicInfo.Gateway = "gw-" + aliasName[4:]
								nicInfo.BaseSG = "sg-base-" + aliasName[4:]
								break
							}
						}
					}
				}
				
				// Method 3: Detect by bridge name
				if nicInfo.Network == "" && nicInfo.Bridge != "" {
					bridgeLower := toLower(nicInfo.Bridge)
					for aliasName := range networkAliases {
						suffixLower := toLower(aliasName[4:])
						if containsString(bridgeLower, suffixLower) || containsString(suffixLower, bridgeLower) {
							nicInfo.Network = aliasName
							nicInfo.Gateway = "gw-" + aliasName[4:]
							nicInfo.BaseSG = "sg-base-" + aliasName[4:]
							break
						}
					}
				}
			}

			status.Networks = append(status.Networks, nicInfo)
		}
	}
	
	// For LXC, also parse ipconfig fields
	if vmType == "lxc" {
		for i := 0; i < 10; i++ {
			ipconfigKey := fmt.Sprintf("ipconfig%d", i)
			if ipconfig, ok := vmConfig[ipconfigKey]; ok {
				if configStr, ok := ipconfig.(string); ok {
					parts := splitNicConfig(configStr)
					if ip, ok := parts["ip"]; ok && ip != "" && ip != "dhcp" {
						ipAddr := ip
						if slashIdx := indexOf(ip, '/'); slashIdx > 0 {
							ipAddr = ip[:slashIdx]
						}
						
						// Update corresponding network info
						netKey := fmt.Sprintf("net%d", i)
						for idx, nic := range status.Networks {
							if nic.Interface == netKey {
								status.Networks[idx].IPAddress = ipAddr
								
								// Detect network if not already done
								if status.Networks[idx].Network == "" {
									for aliasName, cidr := range networkAliases {
										if ipInCIDR(ipAddr, cidr) {
											status.Networks[idx].Network = aliasName
											status.Networks[idx].Gateway = "gw-" + aliasName[4:]
											status.Networks[idx].BaseSG = "sg-base-" + aliasName[4:]
											break
										}
									}
								}
								break
							}
						}
					}
				}
			}
		}
	}

	// Generate recommendations
	if !status.FirewallEnabled {
		status.Recommendations = append(status.Recommendations, "Enable firewall on this VM")
	}
	if status.PolicyIn != "DROP" {
		status.Recommendations = append(status.Recommendations, "Set Policy IN to DROP for zero-trust")
	}
	if !status.IsIsolated {
		status.Recommendations = append(status.Recommendations, "Apply a sg-base-* security group to isolate from VLAN")
	}
	for _, nic := range status.Networks {
		if !nic.Firewall {
			status.Recommendations = append(status.Recommendations, fmt.Sprintf("Enable firewall on %s", nic.Interface))
		}
	}

	return status, nil
}

// IsolateVM applies isolation to a VM
func (s *Service) IsolateVM(ctx context.Context, connectionID, node string, vmid int, vmType string, req IsolateVMRequest) (*IsolateVMResult, error) {
	result := &IsolateVMResult{
		Success:     true,
		AppliedSGs:  []string{},
		EnabledNICs: []string{},
		Actions:     []string{},
		Errors:      []string{},
	}

	// Enable firewall if requested
	if req.EnableFirewall {
		enable := 1
		updateReq := UpdateOptionsRequest{
			Enable: &enable,
		}
		if req.SetPolicyInDrop {
			policyIn := "DROP"
			updateReq.PolicyIn = &policyIn
		}
		if req.SetPolicyOutDrop {
			policyOut := "DROP"
			updateReq.PolicyOut = &policyOut
		}
		if err := s.UpdateVMOptions(ctx, connectionID, node, vmid, vmType, updateReq); err != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("Failed to enable firewall: %v", err))
			result.Success = false
		} else {
			result.Actions = append(result.Actions, "Enabled firewall")
			if req.SetPolicyInDrop {
				result.Actions = append(result.Actions, "Set Policy IN to DROP")
			}
			if req.SetPolicyOutDrop {
				result.Actions = append(result.Actions, "Set Policy OUT to DROP (reinforced mode)")
			}
		}
	}

	// Get current status to know what SGs to apply
	status, err := s.GetVMSegmentationStatus(ctx, connectionID, node, vmid, vmType)
	if err != nil {
		return nil, fmt.Errorf("failed to get VM status: %w", err)
	}

	// Track already applied SGs (including ones we add during this request)
	appliedSet := make(map[string]bool)
	for _, sg := range status.AppliedSGs {
		appliedSet[sg] = true
	}

	// Get existing security groups to check what exists
	existingSGs, _ := s.GetSecurityGroups(ctx, connectionID)
	existingSGSet := make(map[string]bool)
	for _, sg := range existingSGs {
		existingSGSet[sg.Group] = true
	}

	// Get aliases to create SGs with proper gateway rules
	aliases, _ := s.GetAliases(ctx, connectionID)
	aliasMap := make(map[string]string) // net-xxx -> CIDR
	for _, alias := range aliases {
		if len(alias.Name) > 4 && alias.Name[:4] == "net-" {
			aliasMap[alias.Name] = alias.CIDR
		}
	}

	// Helper function to create a base SG with gateway rules
	createBaseSG := func(sgName, netName string) error {
		// Create the security group
		err := s.CreateSecurityGroup(ctx, connectionID, CreateSecurityGroupRequest{
			Group:   sgName,
			Comment: fmt.Sprintf("Base VLAN isolation for %s", netName),
		})
		if err != nil {
			return fmt.Errorf("failed to create SG: %w", err)
		}

		// Determine gateway alias name
		gwName := "gw-" + netName[4:] // net-xxx -> gw-xxx

		// Check if gateway alias exists, create it if not
		gwExists := false
		for _, alias := range aliases {
			if alias.Name == gwName {
				gwExists = true
				break
			}
		}
		
		if !gwExists {
			// Try to create gateway alias
			if cidr, ok := aliasMap[netName]; ok {
				// Compute gateway IP (last usable IP, e.g., .254 for /24)
				gwIP := computeGatewayIP(cidr, 254)
				if gwIP != "" {
					s.CreateAlias(ctx, connectionID, CreateAliasRequest{
						Name:    gwName,
						CIDR:    gwIP,
						Comment: fmt.Sprintf("Gateway for %s", netName),
					})
				}
			}
		}

		// Add rules to the security group
		// IMPORTANT: Proxmox adds rules at the end by default
		// We need ACCEPT rules BEFORE DROP rules, so we add DROP first, then insert ACCEPT at position 0
		
		// Step 1: Add DROP rules first (they will be at positions 0 and 1)
		// Rule: IN DROP from VLAN (block intra-VLAN)
		s.AddSecurityGroupRule(ctx, connectionID, sgName, CreateRuleRequest{
			Type:    "in",
			Action:  "DROP",
			Source:  netName,
			Log:     "nolog",
			Enable:  1,
			Comment: "Block inbound from VLAN",
		})

		// Rule: OUT DROP to VLAN (block intra-VLAN)
		s.AddSecurityGroupRule(ctx, connectionID, sgName, CreateRuleRequest{
			Type:    "out",
			Action:  "DROP",
			Dest:    netName,
			Log:     "nolog",
			Enable:  1,
			Comment: "Block outbound to VLAN",
		})

		// Step 2: Insert ACCEPT rules at position 0 (they will push DROP rules down)
		// Rule: OUT ACCEPT to gateway (insert at pos 0)
		err = s.AddSecurityGroupRuleAtPos(ctx, connectionID, sgName, 0, CreateRuleRequest{
			Type:    "out",
			Action:  "ACCEPT",
			Dest:    gwName,
			Enable:  1,
			Comment: "Allow to gateway",
		})
		if err != nil {
			// Log but continue
		}

		// Rule: IN ACCEPT from gateway (insert at pos 0, pushing others down)
		err = s.AddSecurityGroupRuleAtPos(ctx, connectionID, sgName, 0, CreateRuleRequest{
			Type:    "in",
			Action:  "ACCEPT",
			Source:  gwName,
			Enable:  1,
			Comment: "Allow from gateway",
		})
		if err != nil {
			// Log but continue
		}

		// Final order will be:
		// 0: IN ACCEPT from gateway
		// 1: OUT ACCEPT to gateway  
		// 2: IN DROP from VLAN
		// 3: OUT DROP to VLAN

		return nil
	}

	// Apply base SGs if requested - ONLY for the VM's detected networks
	if req.ApplyBaseSGs {
		// Use the VM's network info from status, not all cluster networks
		for _, vmNet := range status.Networks {
			if vmNet.Network == "" || vmNet.BaseSG == "" {
				continue
			}
			
			sgName := vmNet.BaseSG
			
			// Skip if already applied
			if appliedSet[sgName] {
				continue
			}

			// Check if SG exists, create it if not
			if !existingSGSet[sgName] {
				if err := createBaseSG(sgName, vmNet.Network); err != nil {
					result.Errors = append(result.Errors, fmt.Sprintf("Failed to create %s: %v", sgName, err))
					continue
				}
				result.Actions = append(result.Actions, fmt.Sprintf("Created %s with gateway rules", sgName))
				existingSGSet[sgName] = true
			}

			// Apply the security group to VM
			if err := s.AddVMRule(ctx, connectionID, node, vmid, vmType, CreateRuleRequest{
				Type:    "group",
				Action:  sgName,
				Enable:  1,
				Comment: fmt.Sprintf("VLAN isolation for %s", vmNet.Network),
			}); err != nil {
				result.Errors = append(result.Errors, fmt.Sprintf("Failed to apply %s: %v", sgName, err))
			} else {
				result.AppliedSGs = append(result.AppliedSGs, sgName)
				result.Actions = append(result.Actions, fmt.Sprintf("Applied %s", sgName))
				appliedSet[sgName] = true
			}
		}
	}

	// Apply additional SGs (skip if already applied, including by ApplyBaseSGs above)
	for _, sg := range req.AdditionalSGs {
		if appliedSet[sg] {
			continue
		}

		// Check if SG exists
		if !existingSGSet[sg] {
			// Try to create it if it looks like a base SG
			if len(sg) > 8 && sg[:8] == "sg-base-" {
				netName := "net-" + sg[8:]
				if _, exists := aliasMap[netName]; exists {
					if err := createBaseSG(sg, netName); err != nil {
						result.Errors = append(result.Errors, fmt.Sprintf("Failed to create %s: %v", sg, err))
						continue
					}
					result.Actions = append(result.Actions, fmt.Sprintf("Created %s with gateway rules", sg))
					existingSGSet[sg] = true
				} else {
					result.Errors = append(result.Errors, fmt.Sprintf("Cannot create %s: network alias %s not found", sg, netName))
					continue
				}
			} else {
				result.Errors = append(result.Errors, fmt.Sprintf("Security group %s does not exist", sg))
				continue
			}
		}

		if err := s.AddVMRule(ctx, connectionID, node, vmid, vmType, CreateRuleRequest{
			Type:   "group",
			Action: sg,
			Enable: 1,
		}); err != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("Failed to apply %s: %v", sg, err))
		} else {
			result.AppliedSGs = append(result.AppliedSGs, sg)
			result.Actions = append(result.Actions, fmt.Sprintf("Applied %s", sg))
			appliedSet[sg] = true
		}
	}

	if len(result.Errors) > 0 {
		result.Success = false
	}

	return result, nil
}

// Helper functions

func computeGatewayIP(cidr string, offset int) string {
	// Extract network part (e.g., "10.17.17" from "10.17.17.0/24")
	parts := splitCIDR(cidr)
	if len(parts) < 4 {
		return ""
	}
	return fmt.Sprintf("%s.%s.%s.%d", parts[0], parts[1], parts[2], offset)
}

func splitCIDR(cidr string) []string {
	// Remove /prefix if present
	ip := cidr
	if idx := indexOf(cidr, '/'); idx >= 0 {
		ip = cidr[:idx]
	}
	return splitString(ip, '.')
}

func extractNetworkPrefix(cidr string) string {
	parts := splitCIDR(cidr)
	if len(parts) >= 3 {
		return fmt.Sprintf("%s.%s.%s", parts[0], parts[1], parts[2])
	}
	return ""
}

func splitNicConfig(config string) map[string]string {
	result := make(map[string]string)
	for _, part := range splitString(config, ',') {
		if idx := indexOf(part, '='); idx >= 0 {
			result[part[:idx]] = part[idx+1:]
		}
	}
	return result
}

func indexOf(s string, c byte) int {
	for i := 0; i < len(s); i++ {
		if s[i] == c {
			return i
		}
	}
	return -1
}

func splitString(s string, sep byte) []string {
	var result []string
	start := 0
	for i := 0; i < len(s); i++ {
		if s[i] == sep {
			result = append(result, s[start:i])
			start = i + 1
		}
	}
	result = append(result, s[start:])
	return result
}

// ================================================================================
// VM LIST FOR SEGMENTATION
// ================================================================================

// ListVMsForSegmentation lists all VMs with their segmentation status
func (s *Service) ListVMsForSegmentation(ctx context.Context, connectionID string, networkFilter string) (*VMListForSegmentation, error) {
	client, err := s.pve.GetClient(connectionID)
	if err != nil {
		return nil, fmt.Errorf("failed to get client: %w", err)
	}

	// Get all resources (VMs and CTs)
	vms, err := client.GetVMs(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to get VMs: %w", err)
	}

	// Get aliases to detect networks
	aliases, err := s.GetAliases(ctx, connectionID)
	if err != nil {
		return nil, fmt.Errorf("failed to get aliases: %w", err)
	}

	// Build network map
	networkAliases := make(map[string]string) // bridge -> net-xxx alias name
	for _, alias := range aliases {
		if len(alias.Name) > 4 && alias.Name[:4] == "net-" {
			// Try to map CIDR to bridge (simplified - in real implementation would need more logic)
			networkAliases[alias.Name] = alias.CIDR
		}
	}

	// Get security groups
	groups, err := s.GetSecurityGroups(ctx, connectionID)
	if err != nil {
		return nil, fmt.Errorf("failed to get security groups: %w", err)
	}

	// Build base SG map
	baseSGs := make(map[string]bool)
	for _, g := range groups {
		if len(g.Group) > 8 && g.Group[:8] == "sg-base-" {
			baseSGs[g.Group] = true
		}
	}

	result := &VMListForSegmentation{
		VMs: []VMSegmentationSummary{},
	}

	for _, vm := range vms {
		if vm.Type != "qemu" && vm.Type != "lxc" {
			continue
		}

		vmid := vm.VMID
		vmType := vm.Type
		node := vm.Node

		// Get VM options
		opts, err := s.GetVMOptions(ctx, connectionID, node, vmid, vmType)
		if err != nil {
			continue // Skip if error
		}

		// Get VM rules to check applied SGs
		rules, err := s.GetVMRules(ctx, connectionID, node, vmid, vmType)
		if err != nil {
			rules = []FirewallRule{}
		}

		// Extract applied security groups
		var appliedSGs []string
		var appliedBaseSGs []string
		for _, rule := range rules {
			if rule.Type == "group" {
				appliedSGs = append(appliedSGs, rule.Action)
				if baseSGs[rule.Action] {
					appliedBaseSGs = append(appliedBaseSGs, rule.Action)
				}
			}
		}

		// Determine isolation status
		isIsolated := len(appliedBaseSGs) > 0 && opts.Enable == 1

		// Detect network from VM config
		var networks []string
		var vmConfig map[string]interface{}
		if vmType == "lxc" {
			vmConfig, _ = client.GetLXCConfig(ctx, node, vmid)
		} else {
			vmConfig, _ = client.GetVMConfig(ctx, node, vmid)
		}

		// Parse network interfaces to detect networks
		for key, val := range vmConfig {
			if len(key) >= 3 && key[:3] == "net" {
				netStr, ok := val.(string)
				if !ok {
					continue
				}
				
				// Parse NIC config
				parts := splitNicConfig(netStr)
				
				// Method 1: Try to match by IP address (most accurate)
				if ip, ok := parts["ip"]; ok && ip != "" && ip != "dhcp" {
					// Extract IP without CIDR suffix if present
					ipAddr := ip
					if slashIdx := indexOf(ip, '/'); slashIdx > 0 {
						ipAddr = ip[:slashIdx]
					}
					// Find which net-* CIDR contains this IP
					for aliasName, cidr := range networkAliases {
						if ipInCIDR(ipAddr, cidr) {
							if !containsStringSlice(networks, aliasName) {
								networks = append(networks, aliasName)
							}
							break
						}
					}
				}
				
				// Method 2: Try to match by bridge name (fallback)
				if len(networks) == 0 {
					if bridge, ok := parts["bridge"]; ok {
						for aliasName := range networkAliases {
							suffix := aliasName[4:] // remove "net-"
							// More flexible matching
							bridgeLower := toLower(bridge)
							suffixLower := toLower(suffix)
							if containsString(bridgeLower, suffixLower) || containsString(suffixLower, bridgeLower) {
								if !containsStringSlice(networks, aliasName) {
									networks = append(networks, aliasName)
								}
							}
						}
					}
				}
				
				// Method 3: Try to match by tag/VLAN ID
				if len(networks) == 0 {
					if tag, ok := parts["tag"]; ok && tag != "" {
						for aliasName, cidr := range networkAliases {
							// Check if tag matches the third octet (common pattern)
							// e.g., tag=17 matches 10.17.17.0/24
							if cidrContainsTag(cidr, tag) {
								if !containsStringSlice(networks, aliasName) {
									networks = append(networks, aliasName)
								}
							}
						}
					}
				}
			}
		}
		
		// For LXC, also check ipconfig fields
		if vmType == "lxc" && len(networks) == 0 {
			for key, val := range vmConfig {
				if len(key) >= 8 && key[:8] == "ipconfig" {
					ipStr, ok := val.(string)
					if !ok {
						continue
					}
					// Parse IP from ipconfig (format: ip=x.x.x.x/xx,gw=x.x.x.x)
					parts := splitNicConfig(ipStr)
					if ip, ok := parts["ip"]; ok && ip != "" && ip != "dhcp" {
						ipAddr := ip
						if slashIdx := indexOf(ip, '/'); slashIdx > 0 {
							ipAddr = ip[:slashIdx]
						}
						for aliasName, cidr := range networkAliases {
							if ipInCIDR(ipAddr, cidr) {
								if !containsStringSlice(networks, aliasName) {
									networks = append(networks, aliasName)
								}
								break
							}
						}
					}
				}
			}
		}

		// Check for missing base SGs
		var missingBaseSGs []string
		for _, net := range networks {
			baseSGName := "sg-base-" + net[4:] // net-xxx -> sg-base-xxx
			if baseSGs[baseSGName] && !containsStringSlice(appliedBaseSGs, baseSGName) {
				missingBaseSGs = append(missingBaseSGs, baseSGName)
			}
		}

		// Apply network filter if specified
		if networkFilter != "" {
			found := false
			for _, net := range networks {
				if net == networkFilter {
					found = true
					break
				}
			}
			if !found {
				continue
			}
		}

		summary := VMSegmentationSummary{
			VMID:            vmid,
			Name:            vm.Name,
			Node:            node,
			Type:            vmType,
			Status:          vm.Status,
			Networks:        networks,
			FirewallEnabled: opts.Enable == 1,
			IsIsolated:      isIsolated,
			MissingBaseSGs:  missingBaseSGs,
			AppliedSGs:      appliedSGs,
		}

		if len(networks) > 0 {
			summary.Network = networks[0]
		}

		result.VMs = append(result.VMs, summary)
		result.TotalVMs++

		if isIsolated {
			result.IsolatedVMs++
		}
		if opts.Enable != 1 {
			result.UnprotectedVMs++
		}
	}

	return result, nil
}

// SimulateIsolation simulates the impact of enabling micro-segmentation on a VM
func (s *Service) SimulateIsolation(ctx context.Context, connectionID, node string, vmid int, vmType string) (*ImpactSimulation, error) {
	// Get current VM status
	status, err := s.GetVMSegmentationStatus(ctx, connectionID, node, vmid, vmType)
	if err != nil {
		return nil, fmt.Errorf("failed to get VM status: %w", err)
	}

	// Get analysis for network info
	analysis, err := s.AnalyzeMicrosegmentation(ctx, connectionID, 254)
	if err != nil {
		return nil, fmt.Errorf("failed to analyze: %w", err)
	}

	simulation := &ImpactSimulation{
		VMID: vmid,
		Name: status.Name,
		CurrentState: VMIsolationState{
			FirewallEnabled: status.FirewallEnabled,
			PolicyIn:        status.PolicyIn,
			PolicyOut:       status.PolicyOut,
			IsIsolated:      status.IsIsolated,
			AppliedSGs:      status.AppliedSGs,
			Networks:        status.Networks,
		},
		SimulatedState: VMIsolationState{
			FirewallEnabled: true,
			PolicyIn:        "DROP",
			PolicyOut:       "ACCEPT",
			IsIsolated:      true,
			AppliedSGs:      status.AppliedSGs,
		},
		AllowedFlows:    []FlowAnalysis{},
		BlockedFlows:    []FlowAnalysis{},
		AffectedVMs:     []AffectedVM{},
		Warnings:        []string{},
		RequiredActions: []string{},
	}

	// Determine base SGs to apply
	var baseSGsToApply []string
	for _, net := range status.Networks {
		if net.Network != "" {
			baseSGName := "sg-base-" + net.Network[4:]
			if !containsStringSlice(status.AppliedBaseSGs, baseSGName) {
				baseSGsToApply = append(baseSGsToApply, baseSGName)
				simulation.SimulatedState.AppliedSGs = append(simulation.SimulatedState.AppliedSGs, baseSGName)
			}
		}
	}

	// Add required actions
	if !status.FirewallEnabled {
		simulation.RequiredActions = append(simulation.RequiredActions, "Activer le firewall sur la VM")
	}
	if status.PolicyIn != "DROP" {
		simulation.RequiredActions = append(simulation.RequiredActions, "Changer Policy IN en DROP")
	}
	for _, sg := range baseSGsToApply {
		simulation.RequiredActions = append(simulation.RequiredActions, fmt.Sprintf("Appliquer le Security Group %s", sg))
	}

	// Analyze allowed flows based on current SGs
	for _, sgName := range status.AppliedSGs {
		// Get SG rules
		groups, _ := s.GetSecurityGroups(ctx, connectionID)
		for _, g := range groups {
			if g.Group == sgName {
				for _, rule := range g.Rules {
					if rule.Action == "ACCEPT" && rule.Enable != 0 {
						flow := FlowAnalysis{
							Direction:   rule.Type, // "in" or "out"
							Protocol:    rule.Proto,
							Port:        rule.Dport,
							Source:      rule.Source,
							Destination: rule.Dest,
							Reason:      fmt.Sprintf("Autorisé par %s", sgName),
						}
						simulation.AllowedFlows = append(simulation.AllowedFlows, flow)
					}
				}
			}
		}
	}

	// Add gateway flows (always allowed with base SG)
	for _, net := range status.Networks {
		if net.Gateway != "" {
			simulation.AllowedFlows = append(simulation.AllowedFlows, FlowAnalysis{
				Direction:   "out",
				Protocol:    "any",
				Source:      "VM",
				Destination: net.Gateway,
				Reason:      "Passerelle autorisée par sg-base-*",
			})
			simulation.AllowedFlows = append(simulation.AllowedFlows, FlowAnalysis{
				Direction:   "in",
				Protocol:    "any",
				Source:      net.Gateway,
				Destination: "VM",
				Reason:      "Passerelle autorisée par sg-base-*",
			})
		}
	}

	// Analyze blocked flows (intra-VLAN traffic)
	for _, net := range status.Networks {
		if net.Network != "" {
			simulation.BlockedFlows = append(simulation.BlockedFlows, FlowAnalysis{
				Direction:   "out",
				Protocol:    "any",
				Source:      "VM",
				Destination: net.Network,
				Reason:      "Trafic intra-VLAN bloqué par sg-base-*",
				Critical:    true,
			})
			simulation.BlockedFlows = append(simulation.BlockedFlows, FlowAnalysis{
				Direction:   "in",
				Protocol:    "any",
				Source:      net.Network,
				Destination: "VM",
				Reason:      "Trafic intra-VLAN bloqué par sg-base-*",
				Critical:    true,
			})
		}
	}

	// Find affected VMs (other VMs in the same network)
	client, err := s.pve.GetClient(connectionID)
	if err == nil {
		allVMs, _ := client.GetVMs(ctx)
		for _, otherVM := range allVMs {
			if otherVM.VMID == vmid {
				continue
			}
			// Check if VM is in same network (simplified check)
			for _, net := range status.Networks {
				if net.Network != "" {
					affected := AffectedVM{
						VMID:       otherVM.VMID,
						Name:       otherVM.Name,
						Node:       otherVM.Node,
						Network:    net.Network,
						Impact:     "communication_blocked",
						CanResolve: true,
						Resolution: "Créer un Security Group autorisant la communication entre ces VMs",
					}
					// Only add if in same network (simplified)
					simulation.AffectedVMs = append(simulation.AffectedVMs, affected)
					break
				}
			}
		}
		// Limit to first 10 affected VMs
		if len(simulation.AffectedVMs) > 10 {
			simulation.AffectedVMs = simulation.AffectedVMs[:10]
			simulation.Warnings = append(simulation.Warnings, fmt.Sprintf("Plus de 10 VMs potentiellement affectées dans le même réseau"))
		}
	}

	// Add warnings
	if len(status.AppliedSGs) == 0 {
		simulation.Warnings = append(simulation.Warnings, "Aucun Security Group métier appliqué - seul le trafic vers la gateway sera autorisé")
	}
	
	// Check for network info
	networkInfoFound := false
	for _, net := range status.Networks {
		if net.Network != "" {
			networkInfoFound = true
			// Check if base SG exists
			found := false
			for _, n := range analysis.Networks {
				if n.Name == net.Network && n.HasBaseSG {
					found = true
					break
				}
			}
			if !found {
				simulation.Warnings = append(simulation.Warnings, fmt.Sprintf("Le Security Group sg-base-%s n'existe pas encore - générez-le d'abord", net.Network[4:]))
			}
		}
	}
	if !networkInfoFound {
		simulation.Warnings = append(simulation.Warnings, "Impossible de détecter le réseau de la VM - vérifiez la configuration réseau")
	}

	return simulation, nil
}

// Helper function to check if slice contains string
func containsStringSlice(slice []string, s string) bool {
	for _, item := range slice {
		if item == s {
			return true
		}
	}
	return false
}

// Helper function to check if string contains substring
func containsString(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(substr) == 0 || 
		(len(s) > len(substr) && findSubstring(s, substr) >= 0))
}

func findSubstring(s, substr string) int {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return i
		}
	}
	return -1
}

// toLower converts a string to lowercase
func toLower(s string) string {
	result := make([]byte, len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c >= 'A' && c <= 'Z' {
			c += 'a' - 'A'
		}
		result[i] = c
	}
	return string(result)
}

// ipInCIDR checks if an IP address is within a CIDR range
func ipInCIDR(ipStr, cidrStr string) bool {
	// Parse IP
	ip := parseIP(ipStr)
	if ip == 0 {
		return false
	}
	
	// Parse CIDR
	cidrParts := splitString(cidrStr, '/')
	if len(cidrParts) != 2 {
		return false
	}
	
	networkIP := parseIP(cidrParts[0])
	if networkIP == 0 {
		return false
	}
	
	// Parse prefix length
	prefixLen := 0
	for _, c := range cidrParts[1] {
		if c >= '0' && c <= '9' {
			prefixLen = prefixLen*10 + int(c-'0')
		}
	}
	if prefixLen < 0 || prefixLen > 32 {
		return false
	}
	
	// Create mask
	var mask uint32 = 0xFFFFFFFF << (32 - prefixLen)
	
	// Check if IP is in network
	return (ip & mask) == (networkIP & mask)
}

// parseIP parses an IP address string to uint32
func parseIP(ipStr string) uint32 {
	parts := splitString(ipStr, '.')
	if len(parts) != 4 {
		return 0
	}
	
	var ip uint32
	for i, part := range parts {
		val := 0
		for _, c := range part {
			if c >= '0' && c <= '9' {
				val = val*10 + int(c-'0')
			} else {
				return 0
			}
		}
		if val < 0 || val > 255 {
			return 0
		}
		ip |= uint32(val) << (24 - i*8)
	}
	return ip
}

// cidrContainsTag checks if a CIDR's network portion matches a VLAN tag
// Common pattern: tag 17 matches 10.17.17.0/24 or 192.168.17.0/24
func cidrContainsTag(cidr, tag string) bool {
	// Parse tag as number
	tagNum := 0
	for _, c := range tag {
		if c >= '0' && c <= '9' {
			tagNum = tagNum*10 + int(c-'0')
		}
	}
	if tagNum <= 0 || tagNum > 4094 {
		return false
	}
	
	// Parse CIDR to get network octets
	cidrParts := splitString(cidr, '/')
	if len(cidrParts) < 1 {
		return false
	}
	
	ipParts := splitString(cidrParts[0], '.')
	if len(ipParts) != 4 {
		return false
	}
	
	// Check if tag matches second or third octet
	for i := 1; i <= 2; i++ {
		octetVal := 0
		for _, c := range ipParts[i] {
			if c >= '0' && c <= '9' {
				octetVal = octetVal*10 + int(c-'0')
			}
		}
		if octetVal == tagNum {
			return true
		}
	}
	
	return false
}
