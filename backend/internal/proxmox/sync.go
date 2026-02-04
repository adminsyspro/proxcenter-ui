package proxmox

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"fmt"
	"strings"

	_ "github.com/mattn/go-sqlite3"
	"github.com/rs/zerolog/log"
)

// ProxCenterConnection represents a connection from ProxCenter's database
type ProxCenterConnection struct {
	ID          string
	Name        string
	Type        string // "pve" or "pbs"
	BaseURL     string
	InsecureTLS bool
	APITokenEnc string // Encrypted token
}

// LoadConnectionsFromProxCenter reads connections from ProxCenter's SQLite database
func (m *Manager) LoadConnectionsFromProxCenter(dbPath, appSecret string) error {
	if dbPath == "" {
		log.Warn().Msg("No ProxCenter database path configured, skipping connection sync")
		return nil
	}

	db, err := sql.Open("sqlite3", dbPath+"?mode=ro")
	if err != nil {
		return fmt.Errorf("failed to open ProxCenter database: %w", err)
	}
	defer db.Close()

	rows, err := db.Query(`
		SELECT id, name, type, baseUrl, insecureTLS, apiTokenEnc 
		FROM Connection 
		WHERE type = 'pve'
	`)
	if err != nil {
		return fmt.Errorf("failed to query connections: %w", err)
	}
	defer rows.Close()

	count := 0
	for rows.Next() {
		var conn ProxCenterConnection
		var insecure bool

		err := rows.Scan(
			&conn.ID,
			&conn.Name,
			&conn.Type,
			&conn.BaseURL,
			&insecure,
			&conn.APITokenEnc,
		)
		if err != nil {
			log.Error().Err(err).Msg("Failed to scan connection row")
			continue
		}

		conn.InsecureTLS = insecure

		// Decrypt the API token
		apiToken, err := decryptSecret(conn.APITokenEnc, appSecret)
		if err != nil {
			log.Error().Err(err).Str("connection", conn.Name).Msg("Failed to decrypt API token")
			continue
		}

		// Add to manager
		m.AddConnection(conn.ID, conn.BaseURL, apiToken, "")
		log.Info().
			Str("id", conn.ID).
			Str("name", conn.Name).
			Str("url", conn.BaseURL).
			Msg("Loaded connection from ProxCenter")

		count++
	}

	if err := rows.Err(); err != nil {
		return fmt.Errorf("error iterating connections: %w", err)
	}

	log.Info().Int("count", count).Msg("Connections loaded from ProxCenter database")
	return nil
}

// decryptSecret decrypts a secret encrypted by ProxCenter
// Format: iv.tag.data (base64)
// Algorithm: AES-256-GCM
func decryptSecret(payload, appSecret string) (string, error) {
	parts := strings.Split(payload, ".")
	if len(parts) != 3 {
		return "", fmt.Errorf("invalid secret payload format")
	}

	iv, err := base64.StdEncoding.DecodeString(parts[0])
	if err != nil {
		return "", fmt.Errorf("failed to decode IV: %w", err)
	}

	tag, err := base64.StdEncoding.DecodeString(parts[1])
	if err != nil {
		return "", fmt.Errorf("failed to decode tag: %w", err)
	}

	data, err := base64.StdEncoding.DecodeString(parts[2])
	if err != nil {
		return "", fmt.Errorf("failed to decode data: %w", err)
	}

	// Derive key from APP_SECRET using SHA-256
	hash := sha256.Sum256([]byte(appSecret))
	key := hash[:]

	// Create AES cipher
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("failed to create cipher: %w", err)
	}

	// Create GCM
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("failed to create GCM: %w", err)
	}

	// Combine data + tag for Go's GCM (it expects them together)
	ciphertext := append(data, tag...)

	// Decrypt
	plaintext, err := gcm.Open(nil, iv, ciphertext, nil)
	if err != nil {
		return "", fmt.Errorf("failed to decrypt: %w", err)
	}

	return string(plaintext), nil
}
