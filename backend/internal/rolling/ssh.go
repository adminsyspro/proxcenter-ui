package rolling

import (
	"bytes"
	"context"
	"fmt"
	"net"
	"strings"
	"time"

	"github.com/rs/zerolog/log"
	"golang.org/x/crypto/ssh"
)

// SSHCredentials holds SSH connection info for rolling updates
type SSHCredentials struct {
	Enabled    bool   `json:"sshEnabled"`
	Port       int    `json:"sshPort"`
	User       string `json:"sshUser"`
	AuthMethod string `json:"sshAuthMethod"` // "key" or "password"
	Key        string `json:"sshKey,omitempty"`
	Passphrase string `json:"sshPassphrase,omitempty"`
	Password   string `json:"sshPassword,omitempty"`
}

// SSHClient wraps an SSH connection to a node
type SSHClient struct {
	host   string
	port   int
	config *ssh.ClientConfig
	conn   *ssh.Client
}

// NewSSHClient creates a new SSH client for a host
func NewSSHClient(host string, creds SSHCredentials) (*SSHClient, error) {
	var authMethods []ssh.AuthMethod

	if creds.AuthMethod == "key" && creds.Key != "" {
		var signer ssh.Signer
		var err error

		if creds.Passphrase != "" {
			signer, err = ssh.ParsePrivateKeyWithPassphrase([]byte(creds.Key), []byte(creds.Passphrase))
		} else {
			signer, err = ssh.ParsePrivateKey([]byte(creds.Key))
		}

		if err != nil {
			return nil, fmt.Errorf("failed to parse SSH key: %w", err)
		}

		authMethods = append(authMethods, ssh.PublicKeys(signer))
	} else if creds.AuthMethod == "password" && creds.Password != "" {
		authMethods = append(authMethods, ssh.Password(creds.Password))
	} else {
		return nil, fmt.Errorf("no valid SSH authentication method configured")
	}

	port := creds.Port
	if port == 0 {
		port = 22
	}

	user := creds.User
	if user == "" {
		user = "root"
	}

	config := &ssh.ClientConfig{
		User:            user,
		Auth:            authMethods,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(), // TODO: Implement proper host key verification
		Timeout:         30 * time.Second,
	}

	return &SSHClient{
		host:   host,
		port:   port,
		config: config,
	}, nil
}

// Connect establishes the SSH connection
func (c *SSHClient) Connect() error {
	addr := fmt.Sprintf("%s:%d", c.host, c.port)
	log.Debug().Str("host", addr).Str("user", c.config.User).Msg("Connecting via SSH")

	conn, err := ssh.Dial("tcp", addr, c.config)
	if err != nil {
		if netErr, ok := err.(net.Error); ok && netErr.Timeout() {
			return fmt.Errorf("SSH connection timeout to %s", addr)
		}
		return fmt.Errorf("SSH connection failed to %s: %w", addr, err)
	}

	c.conn = conn
	log.Info().Str("host", addr).Msg("SSH connected")
	return nil
}

// Close closes the SSH connection
func (c *SSHClient) Close() error {
	if c.conn != nil {
		return c.conn.Close()
	}
	return nil
}

// RunCommand executes a command and returns stdout, stderr, and error
func (c *SSHClient) RunCommand(ctx context.Context, command string) (string, string, error) {
	if c.conn == nil {
		return "", "", fmt.Errorf("SSH not connected")
	}

	session, err := c.conn.NewSession()
	if err != nil {
		return "", "", fmt.Errorf("failed to create SSH session: %w", err)
	}
	defer session.Close()

	var stdout, stderr bytes.Buffer
	session.Stdout = &stdout
	session.Stderr = &stderr

	log.Debug().Str("host", c.host).Str("command", command).Msg("Executing SSH command")

	// Run with context timeout
	done := make(chan error, 1)
	go func() {
		done <- session.Run(command)
	}()

	select {
	case <-ctx.Done():
		session.Signal(ssh.SIGTERM)
		return stdout.String(), stderr.String(), ctx.Err()
	case err := <-done:
		if err != nil {
			// Check if it's just a non-zero exit code
			if exitErr, ok := err.(*ssh.ExitError); ok {
				log.Debug().
					Str("host", c.host).
					Int("exit_code", exitErr.ExitStatus()).
					Str("stderr", stderr.String()).
					Msg("Command exited with non-zero status")
			}
			return stdout.String(), stderr.String(), err
		}
	}

	return stdout.String(), stderr.String(), nil
}

// RunCommandWithOutput executes a command and logs output in real-time
func (c *SSHClient) RunCommandWithOutput(ctx context.Context, command string, logPrefix string) (string, error) {
	if c.conn == nil {
		return "", fmt.Errorf("SSH not connected")
	}

	session, err := c.conn.NewSession()
	if err != nil {
		return "", fmt.Errorf("failed to create SSH session: %w", err)
	}
	defer session.Close()

	var output bytes.Buffer
	session.Stdout = &output
	session.Stderr = &output

	log.Info().Str("host", c.host).Str("command", command).Msg(logPrefix + " - Starting")

	err = session.Run(command)
	
	result := output.String()
	if err != nil {
		log.Warn().Str("host", c.host).Err(err).Str("output", result).Msg(logPrefix + " - Failed")
		return result, err
	}

	log.Info().Str("host", c.host).Msg(logPrefix + " - Completed")
	return result, nil
}

// NodeSSHOperations provides SSH operations for a specific node
type NodeSSHOperations struct {
	client   *SSHClient
	nodeName string
}

// NewNodeSSHOperations creates SSH operations for a node
func NewNodeSSHOperations(host, nodeName string, creds SSHCredentials) (*NodeSSHOperations, error) {
	client, err := NewSSHClient(host, creds)
	if err != nil {
		return nil, err
	}

	if err := client.Connect(); err != nil {
		return nil, err
	}

	return &NodeSSHOperations{
		client:   client,
		nodeName: nodeName,
	}, nil
}

// Close closes the SSH connection
func (n *NodeSSHOperations) Close() error {
	return n.client.Close()
}

// CheckUpdatesAvailable checks if updates are available
func (n *NodeSSHOperations) CheckUpdatesAvailable(ctx context.Context) (bool, int, error) {
	// Update package list
	_, _, err := n.client.RunCommand(ctx, "apt-get update -qq")
	if err != nil {
		return false, 0, fmt.Errorf("apt-get update failed: %w", err)
	}

	// Check number of upgradable packages
	stdout, _, err := n.client.RunCommand(ctx, "apt list --upgradable 2>/dev/null | grep -c upgradable || echo 0")
	if err != nil {
		// grep returns exit 1 if no matches, that's OK
		if !strings.Contains(err.Error(), "exit status 1") {
			return false, 0, fmt.Errorf("failed to check updates: %w", err)
		}
	}

	count := 0
	fmt.Sscanf(strings.TrimSpace(stdout), "%d", &count)

	return count > 0, count, nil
}

// GetUpgradablePackages returns list of packages that can be upgraded
func (n *NodeSSHOperations) GetUpgradablePackages(ctx context.Context) ([]string, error) {
	stdout, _, err := n.client.RunCommand(ctx, "apt list --upgradable 2>/dev/null | tail -n +2")
	if err != nil {
		return nil, err
	}

	lines := strings.Split(strings.TrimSpace(stdout), "\n")
	var packages []string
	for _, line := range lines {
		if line != "" {
			// Format: package/repo version arch [upgradable from: old_version]
			parts := strings.Split(line, "/")
			if len(parts) > 0 {
				packages = append(packages, parts[0])
			}
		}
	}

	return packages, nil
}

// PerformUpdate runs apt-get upgrade
func (n *NodeSSHOperations) PerformUpdate(ctx context.Context) (string, error) {
	log.Info().Str("node", n.nodeName).Msg("Starting package update")

	// Set environment for non-interactive
	cmd := `DEBIAN_FRONTEND=noninteractive apt-get -y -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold" dist-upgrade`

	output, err := n.client.RunCommandWithOutput(ctx, cmd, "Package update")
	if err != nil {
		return output, fmt.Errorf("apt upgrade failed: %w", err)
	}

	log.Info().Str("node", n.nodeName).Msg("Package update completed")
	return output, nil
}

// CheckRebootRequired checks if a reboot is required
func (n *NodeSSHOperations) CheckRebootRequired(ctx context.Context) (bool, error) {
	stdout, _, err := n.client.RunCommand(ctx, "test -f /var/run/reboot-required && echo yes || echo no")
	if err != nil {
		return false, err
	}

	return strings.TrimSpace(stdout) == "yes", nil
}

// GetKernelVersion returns the running kernel version
func (n *NodeSSHOperations) GetKernelVersion(ctx context.Context) (string, error) {
	stdout, _, err := n.client.RunCommand(ctx, "uname -r")
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(stdout), nil
}

// GetProxmoxVersion returns the Proxmox VE version
func (n *NodeSSHOperations) GetProxmoxVersion(ctx context.Context) (string, error) {
	stdout, _, err := n.client.RunCommand(ctx, "pveversion 2>/dev/null || echo unknown")
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(stdout), nil
}

// Reboot initiates a system reboot
func (n *NodeSSHOperations) Reboot(ctx context.Context) error {
	log.Info().Str("node", n.nodeName).Msg("Initiating reboot")

	// Use nohup and disown to ensure reboot continues after SSH disconnects
	_, _, err := n.client.RunCommand(ctx, "nohup sh -c 'sleep 2 && reboot' >/dev/null 2>&1 &")
	if err != nil {
		// Connection might be closed immediately, that's expected
		if !strings.Contains(err.Error(), "connection") {
			return err
		}
	}

	return nil
}

// WaitForReboot waits for the node to come back online after reboot
func (n *NodeSSHOperations) WaitForReboot(ctx context.Context, timeout time.Duration, creds SSHCredentials) error {
	log.Info().Str("node", n.nodeName).Dur("timeout", timeout).Msg("Waiting for node to come back online")

	// First, wait a bit for the reboot to initiate
	time.Sleep(10 * time.Second)

	deadline := time.Now().Add(timeout)

	for time.Now().Before(deadline) {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		// Try to connect
		newClient, err := NewSSHClient(n.client.host, creds)
		if err != nil {
			time.Sleep(5 * time.Second)
			continue
		}

		if err := newClient.Connect(); err != nil {
			newClient.Close()
			log.Debug().Str("node", n.nodeName).Msg("Node not yet available, retrying...")
			time.Sleep(5 * time.Second)
			continue
		}

		// Verify the node is really up by running a command
		_, _, err = newClient.RunCommand(ctx, "uptime")
		if err != nil {
			newClient.Close()
			time.Sleep(5 * time.Second)
			continue
		}

		// Success! Replace the client
		n.client.Close()
		n.client = newClient

		log.Info().Str("node", n.nodeName).Msg("Node is back online")
		return nil
	}

	return fmt.Errorf("timeout waiting for node %s to come back online", n.nodeName)
}

// RunCustomCommand runs a custom command
func (n *NodeSSHOperations) RunCustomCommand(ctx context.Context, command string) (string, string, error) {
	return n.client.RunCommand(ctx, command)
}

// SetCephNoout sets the Ceph noout flag
func (n *NodeSSHOperations) SetCephNoout(ctx context.Context) error {
	log.Info().Str("node", n.nodeName).Msg("Setting Ceph noout flag")
	_, stderr, err := n.client.RunCommand(ctx, "ceph osd set noout")
	if err != nil {
		return fmt.Errorf("failed to set noout: %s - %w", stderr, err)
	}
	return nil
}

// UnsetCephNoout unsets the Ceph noout flag
func (n *NodeSSHOperations) UnsetCephNoout(ctx context.Context) error {
	log.Info().Str("node", n.nodeName).Msg("Unsetting Ceph noout flag")
	_, stderr, err := n.client.RunCommand(ctx, "ceph osd unset noout")
	if err != nil {
		return fmt.Errorf("failed to unset noout: %s - %w", stderr, err)
	}
	return nil
}

// GetCephHealth gets Ceph cluster health
func (n *NodeSSHOperations) GetCephHealth(ctx context.Context) (string, error) {
	stdout, _, err := n.client.RunCommand(ctx, "ceph health 2>/dev/null || echo HEALTH_UNKNOWN")
	if err != nil {
		return "HEALTH_UNKNOWN", nil
	}
	return strings.TrimSpace(stdout), nil
}

// WaitForCephHealthy waits for Ceph to become healthy
func (n *NodeSSHOperations) WaitForCephHealthy(ctx context.Context, timeout time.Duration) error {
	log.Info().Str("node", n.nodeName).Dur("timeout", timeout).Msg("Waiting for Ceph to become healthy")

	deadline := time.Now().Add(timeout)

	for time.Now().Before(deadline) {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		health, err := n.GetCephHealth(ctx)
		if err != nil {
			time.Sleep(5 * time.Second)
			continue
		}

		if health == "HEALTH_OK" {
			log.Info().Str("node", n.nodeName).Msg("Ceph is healthy")
			return nil
		}

		log.Debug().Str("node", n.nodeName).Str("health", health).Msg("Ceph not yet healthy")
		time.Sleep(10 * time.Second)
	}

	return fmt.Errorf("timeout waiting for Ceph to become healthy")
}
