package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog/log"
	"golang.org/x/crypto/ssh"

	"github.com/proxcenter/orchestrator/internal/proxmox"
)

// SSHTestResult represents the result of testing SSH to a node
type SSHTestResult struct {
	Node   string `json:"node"`
	IP     string `json:"ip"`
	Status string `json:"status"` // "ok" or "error"
	Error  string `json:"error,omitempty"`
}

// SSHTestResponse is the response for SSH connection test
type SSHTestResponse struct {
	Success bool            `json:"success"`
	Nodes   []SSHTestResult `json:"nodes,omitempty"`
	Error   string          `json:"error,omitempty"`
}

// SSHCredentials holds the SSH connection info
type SSHCredentials struct {
	Enabled    bool   `json:"sshEnabled"`
	Port       int    `json:"sshPort"`
	User       string `json:"sshUser"`
	AuthMethod string `json:"sshAuthMethod"` // "key" or "password"
	Key        string `json:"sshKey,omitempty"`
	Passphrase string `json:"sshPassphrase,omitempty"`
	Password   string `json:"sshPassword,omitempty"`
}

// SSHExecRequest holds the request for executing a command via SSH
type SSHExecRequest struct {
	Host       string `json:"host"`
	Port       int    `json:"port"`
	User       string `json:"user"`
	Key        string `json:"key,omitempty"`
	Passphrase string `json:"passphrase,omitempty"`
	Password   string `json:"password,omitempty"`
	Command    string `json:"command"`
}

// SSHExecResponse holds the response for SSH command execution
type SSHExecResponse struct {
	Success  bool   `json:"success"`
	Output   string `json:"output,omitempty"`
	ExitCode int    `json:"exitCode"`
	Error    string `json:"error,omitempty"`
}

// RegisterSSHRoutes registers SSH-related API routes
func (s *Server) RegisterSSHRoutes(r chi.Router) {
	r.Post("/connections/{connectionId}/test-ssh", s.handleTestSSHConnection)
	r.Post("/ssh/exec", s.handleSSHExec)
}

// handleTestSSHConnection tests SSH connectivity to all nodes in a cluster
func (s *Server) handleTestSSHConnection(w http.ResponseWriter, r *http.Request) {
	connectionID := chi.URLParam(r, "connectionId")
	if connectionID == "" {
		respondJSON(w, http.StatusBadRequest, map[string]string{"error": "connectionId is required"})
		return
	}

	log.Info().Str("connectionId", connectionID).Msg("Starting SSH connection test")

	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()

	// Get the Proxmox client for this connection
	client, err := s.pve.GetClient(connectionID)
	if err != nil {
		log.Error().Err(err).Str("connectionId", connectionID).Msg("Failed to get Proxmox client")
		respondJSON(w, http.StatusNotFound, map[string]string{"error": fmt.Sprintf("Connection not found: %v", err)})
		return
	}

	// Get SSH credentials from request body
	var creds SSHCredentials
	if err := json.NewDecoder(r.Body).Decode(&creds); err != nil {
		log.Error().Err(err).Msg("Failed to decode SSH credentials")
		respondJSON(w, http.StatusBadRequest, SSHTestResponse{
			Success: false,
			Error:   "Invalid request body: " + err.Error(),
		})
		return
	}

	log.Info().
		Bool("enabled", creds.Enabled).
		Int("port", creds.Port).
		Str("user", creds.User).
		Str("authMethod", creds.AuthMethod).
		Bool("hasKey", creds.Key != "").
		Bool("hasPassword", creds.Password != "").
		Msg("SSH credentials received")

	if !creds.Enabled {
		respondJSON(w, http.StatusBadRequest, SSHTestResponse{
			Success: false,
			Error:   "SSH is not enabled for this connection",
		})
		return
	}

	// Set defaults
	if creds.Port == 0 {
		creds.Port = 22
	}
	if creds.User == "" {
		creds.User = "root"
	}

	// Get all nodes in the cluster
	nodes, err := client.GetNodes(ctx)
	if err != nil {
		log.Error().Err(err).Msg("Failed to get nodes")
		respondJSON(w, http.StatusInternalServerError, SSHTestResponse{
			Success: false,
			Error:   fmt.Sprintf("Failed to get nodes: %v", err),
		})
		return
	}

	log.Info().Int("nodeCount", len(nodes)).Msg("Found nodes in cluster")

	// Get the base URL to extract the host as fallback
	baseHost := ""
	if clientURL := client.BaseURL; clientURL != "" {
		if u, err := url.Parse(clientURL); err == nil {
			baseHost = u.Hostname()
		}
	}

	log.Info().Str("baseHost", baseHost).Msg("Base host for fallback")

	// Test SSH to each node in parallel
	results := make([]SSHTestResult, len(nodes))
	resultsChan := make(chan struct {
		index  int
		result SSHTestResult
	}, len(nodes))

	for i, node := range nodes {
		go func(idx int, n proxmox.Node) {
			result := SSHTestResult{
				Node: n.Node,
			}

			// Try to get the node's IP address
			nodeIP := ""

			// First, try to resolve the node name as a hostname
			if ips, err := net.LookupIP(n.Node); err == nil && len(ips) > 0 {
				for _, ip := range ips {
					if ipv4 := ip.To4(); ipv4 != nil {
						nodeIP = ipv4.String()
						break
					}
				}
				log.Debug().Str("node", n.Node).Str("resolvedIP", nodeIP).Msg("Resolved node IP via DNS")
			} else {
				log.Debug().Str("node", n.Node).Err(err).Msg("Could not resolve node via DNS")
			}

			// If we couldn't resolve, use the base host (single node scenario or same IP for all)
			if nodeIP == "" && baseHost != "" {
				nodeIP = baseHost
				log.Debug().Str("node", n.Node).Str("ip", nodeIP).Msg("Using base host as fallback")
			}

			// Last resort: use node name as host
			if nodeIP == "" {
				nodeIP = n.Node
				log.Debug().Str("node", n.Node).Msg("Using node name as host (last resort)")
			}

			result.IP = nodeIP

			log.Info().Str("node", n.Node).Str("ip", nodeIP).Int("port", creds.Port).Msg("Testing SSH connection")

			// Test SSH connection
			err := testSSHConnection(nodeIP, creds)
			if err != nil {
				log.Warn().Err(err).Str("node", n.Node).Str("ip", nodeIP).Msg("SSH test failed")
				result.Status = "error"
				result.Error = err.Error()
			} else {
				log.Info().Str("node", n.Node).Str("ip", nodeIP).Msg("SSH test succeeded")
				result.Status = "ok"
			}

			resultsChan <- struct {
				index  int
				result SSHTestResult
			}{idx, result}
		}(i, node)
	}

	// Collect results
	allSuccess := true
	for range nodes {
		r := <-resultsChan
		results[r.index] = r.result
		if r.result.Status != "ok" {
			allSuccess = false
		}
	}

	response := SSHTestResponse{
		Success: allSuccess,
		Nodes:   results,
	}

	if !allSuccess {
		response.Error = "Some nodes failed SSH connection test"
	}

	log.Info().Bool("success", allSuccess).Int("testedNodes", len(results)).Msg("SSH test completed")

	respondJSON(w, http.StatusOK, response)
}

// testSSHConnection tests SSH connectivity to a single host
func testSSHConnection(host string, creds SSHCredentials) error {
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
			return fmt.Errorf("failed to parse SSH key: %w", err)
		}

		authMethods = append(authMethods, ssh.PublicKeys(signer))
	} else if creds.AuthMethod == "password" && creds.Password != "" {
		authMethods = append(authMethods, ssh.Password(creds.Password))
	} else {
		return fmt.Errorf("no valid SSH authentication method configured")
	}

	config := &ssh.ClientConfig{
		User:            creds.User,
		Auth:            authMethods,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(), // TODO: Implement proper host key verification
		Timeout:         10 * time.Second,
	}

	addr := fmt.Sprintf("%s:%d", host, creds.Port)

	log.Debug().Str("host", addr).Str("user", creds.User).Msg("Dialing SSH")

	conn, err := ssh.Dial("tcp", addr, config)
	if err != nil {
		// Check if it's a network error
		if netErr, ok := err.(net.Error); ok && netErr.Timeout() {
			return fmt.Errorf("connection timeout")
		}
		return fmt.Errorf("SSH connection failed: %w", err)
	}
	defer conn.Close()

	log.Debug().Str("host", addr).Msg("SSH connected, creating session")

	// Try to create a session to verify the connection works
	session, err := conn.NewSession()
	if err != nil {
		return fmt.Errorf("failed to create SSH session: %w", err)
	}
	defer session.Close()

	log.Debug().Str("host", addr).Msg("Running test command")

	// Run a simple command to verify
	output, err := session.Output("echo ok")
	if err != nil {
		return fmt.Errorf("failed to execute test command: %w", err)
	}

	if string(output) != "ok\n" && string(output) != "ok" {
		return fmt.Errorf("unexpected command output: %q", string(output))
	}

	log.Info().Str("host", addr).Msg("SSH connection test successful")
	return nil
}

// handleSSHExec executes a command on a remote host via SSH
func (s *Server) handleSSHExec(w http.ResponseWriter, r *http.Request) {
	var req SSHExecRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		log.Error().Err(err).Msg("Failed to decode SSH exec request")
		respondJSON(w, http.StatusBadRequest, SSHExecResponse{
			Success: false,
			Error:   "Invalid request body: " + err.Error(),
		})
		return
	}

	// Validate required fields
	if req.Host == "" {
		respondJSON(w, http.StatusBadRequest, SSHExecResponse{
			Success: false,
			Error:   "host is required",
		})
		return
	}

	if req.Command == "" {
		respondJSON(w, http.StatusBadRequest, SSHExecResponse{
			Success: false,
			Error:   "command is required",
		})
		return
	}

	// Security: Only allow specific commands for VM management
	allowedCommands := []string{"qm unlock", "pct unlock", "qm status", "pct status"}
	commandAllowed := false
	for _, allowed := range allowedCommands {
		if strings.HasPrefix(req.Command, allowed) {
			commandAllowed = true
			break
		}
	}

	if !commandAllowed {
		log.Warn().Str("command", req.Command).Msg("SSH command not in allowlist")
		respondJSON(w, http.StatusForbidden, SSHExecResponse{
			Success: false,
			Error:   "Command not allowed. Only VM management commands are permitted.",
		})
		return
	}

	// Set defaults
	if req.Port == 0 {
		req.Port = 22
	}
	if req.User == "" {
		req.User = "root"
	}

	log.Info().
		Str("host", req.Host).
		Int("port", req.Port).
		Str("user", req.User).
		Str("command", req.Command).
		Msg("Executing SSH command")

	// Execute command
	output, exitCode, err := executeSSHCommand(req)
	if err != nil {
		log.Error().Err(err).Str("host", req.Host).Str("command", req.Command).Msg("SSH command failed")
		respondJSON(w, http.StatusOK, SSHExecResponse{
			Success:  false,
			Output:   output,
			ExitCode: exitCode,
			Error:    err.Error(),
		})
		return
	}

	log.Info().
		Str("host", req.Host).
		Str("command", req.Command).
		Int("exitCode", exitCode).
		Msg("SSH command executed successfully")

	respondJSON(w, http.StatusOK, SSHExecResponse{
		Success:  true,
		Output:   output,
		ExitCode: exitCode,
	})
}

// executeSSHCommand executes a command on a remote host and returns the output
func executeSSHCommand(req SSHExecRequest) (string, int, error) {
	var authMethods []ssh.AuthMethod

	// Configure authentication
	if req.Key != "" {
		var signer ssh.Signer
		var err error

		if req.Passphrase != "" {
			signer, err = ssh.ParsePrivateKeyWithPassphrase([]byte(req.Key), []byte(req.Passphrase))
		} else {
			signer, err = ssh.ParsePrivateKey([]byte(req.Key))
		}

		if err != nil {
			return "", -1, fmt.Errorf("failed to parse SSH key: %w", err)
		}

		authMethods = append(authMethods, ssh.PublicKeys(signer))
	} else if req.Password != "" {
		authMethods = append(authMethods, ssh.Password(req.Password))
	} else {
		return "", -1, fmt.Errorf("no valid SSH authentication method provided")
	}

	config := &ssh.ClientConfig{
		User:            req.User,
		Auth:            authMethods,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(), // TODO: Implement proper host key verification
		Timeout:         30 * time.Second,
	}

	addr := fmt.Sprintf("%s:%d", req.Host, req.Port)

	log.Debug().Str("host", addr).Str("user", req.User).Msg("Dialing SSH for command execution")

	conn, err := ssh.Dial("tcp", addr, config)
	if err != nil {
		if netErr, ok := err.(net.Error); ok && netErr.Timeout() {
			return "", -1, fmt.Errorf("connection timeout")
		}
		return "", -1, fmt.Errorf("SSH connection failed: %w", err)
	}
	defer conn.Close()

	session, err := conn.NewSession()
	if err != nil {
		return "", -1, fmt.Errorf("failed to create SSH session: %w", err)
	}
	defer session.Close()

	// Execute command and capture output
	output, err := session.CombinedOutput(req.Command)
	outputStr := strings.TrimSpace(string(output))

	if err != nil {
		// Try to get the exit code
		exitCode := 1
		if exitErr, ok := err.(*ssh.ExitError); ok {
			exitCode = exitErr.ExitStatus()
		}
		return outputStr, exitCode, fmt.Errorf("command failed: %w", err)
	}

	return outputStr, 0, nil
}
