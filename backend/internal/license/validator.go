package license

import (
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	_ "embed"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"
)

//go:embed public_key.pem
var embeddedPublicKey []byte

const (
	licenseHeader    = "-----BEGIN PROXCENTER LICENSE-----"
	signatureHeader  = "-----BEGIN SIGNATURE-----"
	licenseFooter    = "-----END PROXCENTER LICENSE-----"
)

// Validator handles license validation and storage
type Validator struct {
	mu         sync.RWMutex
	publicKey  *rsa.PublicKey
	license    *License
	filePath   string
}

// NewValidator creates a new license validator
func NewValidator(licenseFilePath string) (*Validator, error) {
	// Parse embedded public key
	block, _ := pem.Decode(embeddedPublicKey)
	if block == nil {
		return nil, errors.New("failed to decode embedded public key PEM")
	}

	pub, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("failed to parse public key: %w", err)
	}

	rsaPub, ok := pub.(*rsa.PublicKey)
	if !ok {
		return nil, errors.New("embedded key is not an RSA public key")
	}

	v := &Validator{
		publicKey: rsaPub,
		filePath:  licenseFilePath,
	}

	// Try to load existing license from file
	if licenseFilePath != "" {
		if content, err := os.ReadFile(licenseFilePath); err == nil {
			if license, err := v.parseLicense(string(content)); err == nil {
				v.license = license
			}
		}
	}

	return v, nil
}

// parseLicense parses and validates a license string
func (v *Validator) parseLicense(content string) (*License, error) {
	content = strings.TrimSpace(content)

	// Find header
	headerIdx := strings.Index(content, licenseHeader)
	if headerIdx == -1 {
		return nil, errors.New("invalid license format: missing header")
	}

	// Find signature section
	sigIdx := strings.Index(content, signatureHeader)
	if sigIdx == -1 {
		return nil, errors.New("invalid license format: missing signature section")
	}

	// Find footer
	footerIdx := strings.Index(content, licenseFooter)
	if footerIdx == -1 {
		return nil, errors.New("invalid license format: missing footer")
	}

	// Extract payload (between header and signature)
	payloadStart := headerIdx + len(licenseHeader)
	payloadB64 := strings.TrimSpace(content[payloadStart:sigIdx])

	// Extract signature (between signature header and footer)
	sigStart := sigIdx + len(signatureHeader)
	sigB64 := strings.TrimSpace(content[sigStart:footerIdx])

	// Decode payload
	payloadBytes, err := base64.StdEncoding.DecodeString(payloadB64)
	if err != nil {
		return nil, fmt.Errorf("failed to decode payload: %w", err)
	}

	// Decode signature
	signature, err := base64.StdEncoding.DecodeString(sigB64)
	if err != nil {
		return nil, fmt.Errorf("failed to decode signature: %w", err)
	}

	// Verify signature
	hash := sha256.Sum256(payloadBytes)
	err = rsa.VerifyPKCS1v15(v.publicKey, crypto.SHA256, hash[:], signature)
	if err != nil {
		return nil, fmt.Errorf("signature verification failed: %w", err)
	}

	// Parse payload JSON
	var payload LicensePayload
	if err := json.Unmarshal(payloadBytes, &payload); err != nil {
		return nil, fmt.Errorf("failed to parse license payload: %w", err)
	}

	return &License{
		Payload:   payload,
		Raw:       content,
		Valid:     true,
		Signature: signature,
	}, nil
}

// Activate validates and activates a new license
func (v *Validator) Activate(licenseContent string) (*License, error) {
	license, err := v.parseLicense(licenseContent)
	if err != nil {
		return nil, err
	}

	// Check if expired
	if license.IsExpired() {
		return nil, errors.New("license has expired")
	}

	// Save to file if path is configured
	if v.filePath != "" {
		if err := os.WriteFile(v.filePath, []byte(licenseContent), 0600); err != nil {
			return nil, fmt.Errorf("failed to save license file: %w", err)
		}
	}

	v.mu.Lock()
	v.license = license
	v.mu.Unlock()

	return license, nil
}

// Deactivate removes the current license
func (v *Validator) Deactivate() error {
	v.mu.Lock()
	defer v.mu.Unlock()

	v.license = nil

	// Remove license file if it exists
	if v.filePath != "" {
		if err := os.Remove(v.filePath); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("failed to remove license file: %w", err)
		}
	}

	return nil
}

// GetLicense returns the current license (thread-safe)
func (v *Validator) GetLicense() *License {
	v.mu.RLock()
	defer v.mu.RUnlock()
	return v.license
}

// GetStatus returns the current license status
func (v *Validator) GetStatus() LicenseStatus {
	license := v.GetLicense()
	return license.ToStatus()
}

// HasFeature checks if the current license includes a specific feature
func (v *Validator) HasFeature(feature Feature) bool {
	license := v.GetLicense()
	if license == nil || !license.Valid || license.IsExpired() {
		return false
	}
	return license.HasFeature(feature)
}

// IsEnterprise checks if the current license is enterprise
func (v *Validator) IsEnterprise() bool {
	license := v.GetLicense()
	if license == nil || !license.Valid || license.IsExpired() {
		return false
	}
	return license.IsEnterprise()
}

// IsLicensed checks if a valid, non-expired license is active
func (v *Validator) IsLicensed() bool {
	license := v.GetLicense()
	return license != nil && license.Valid && !license.IsExpired()
}

// CheckLimits checks if usage is within license limits
func (v *Validator) CheckLimits(nodes, vms, connections int) error {
	license := v.GetLicense()
	if license == nil || !license.Valid {
		return nil // No limits for community edition
	}

	limits := license.Payload.Limits

	if limits.MaxNodes > 0 && nodes > limits.MaxNodes {
		return fmt.Errorf("node limit exceeded: %d > %d", nodes, limits.MaxNodes)
	}

	if limits.MaxVMs > 0 && vms > limits.MaxVMs {
		return fmt.Errorf("VM limit exceeded: %d > %d", vms, limits.MaxVMs)
	}

	if limits.MaxConnections > 0 && connections > limits.MaxConnections {
		return fmt.Errorf("connection limit exceeded: %d > %d", connections, limits.MaxConnections)
	}

	return nil
}
