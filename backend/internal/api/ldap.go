package api

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog/log"

	"github.com/proxcenter/orchestrator/internal/ldap"
)

// ldapService est le service LDAP utilisé par les handlers
var ldapService *ldap.Service

// initLDAP initialise le service LDAP
func initLDAP() {
	if ldapService == nil {
		ldapService = ldap.NewService()
	}
}

// RegisterLDAPRoutes enregistre les routes LDAP
func (s *Server) RegisterLDAPRoutes(r chi.Router) {
	initLDAP()

	r.Route("/auth/ldap", func(r chi.Router) {
		r.Post("/authenticate", s.handleLDAPAuthenticate)
		r.Post("/test", s.handleLDAPTest)
	})
}

// handleLDAPAuthenticate gère l'authentification LDAP
// POST /api/v1/auth/ldap/authenticate
func (s *Server) handleLDAPAuthenticate(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
		// Config LDAP envoyée par Next.js (évite d'accéder à la DB ProxCenter)
		Config *struct {
			URL            string `json:"url"`
			BindDN         string `json:"bind_dn"`
			BindPassword   string `json:"bind_password"`
			BaseDN         string `json:"base_dn"`
			UserFilter     string `json:"user_filter"`
			EmailAttribute string `json:"email_attribute"`
			NameAttribute  string `json:"name_attribute"`
			TLSInsecure    bool   `json:"tls_insecure"`
		} `json:"config"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	var config *ldap.Config

	// Utiliser la config fournie dans la requête si présente
	if req.Config != nil {
		config = &ldap.Config{
			Enabled:        true,
			URL:            req.Config.URL,
			BindDN:         req.Config.BindDN,
			BindPassword:   req.Config.BindPassword,
			BaseDN:         req.Config.BaseDN,
			UserFilter:     req.Config.UserFilter,
			EmailAttribute: req.Config.EmailAttribute,
			NameAttribute:  req.Config.NameAttribute,
			TLSInsecure:    req.Config.TLSInsecure,
		}
	} else {
		// Fallback: charger depuis la DB (si configuré)
		var err error
		config, err = s.loadLDAPConfig()
		if err != nil {
			log.Error().Err(err).Msg("Failed to load LDAP configuration")
			respondError(w, http.StatusInternalServerError, "Failed to load LDAP configuration")
			return
		}
	}

	if config == nil || !config.Enabled {
		respondJSON(w, http.StatusOK, ldap.AuthResponse{
			Success: false,
			Error:   "LDAP authentication is not enabled",
		})
		return
	}

	// Authentifier l'utilisateur
	authReq := &ldap.AuthRequest{
		Username: req.Username,
		Password: req.Password,
	}
	response := ldapService.Authenticate(config, authReq)

	respondJSON(w, http.StatusOK, response)
}

// handleLDAPTest gère le test de connexion LDAP
// POST /api/v1/auth/ldap/test
func (s *Server) handleLDAPTest(w http.ResponseWriter, r *http.Request) {
	var req ldap.TestRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	log.Info().
		Str("url", req.URL).
		Str("base_dn", req.BaseDN).
		Bool("tls_insecure", req.TLSInsecure).
		Msg("Testing LDAP connection")

	// Tester la connexion
	response := ldapService.TestConnection(&req)

	respondJSON(w, http.StatusOK, response)
}

// LdapConfigRecord représente la configuration LDAP en base de données
type LdapConfigRecord struct {
	ID              string `gorm:"column:id"`
	Enabled         int    `gorm:"column:enabled"`
	URL             string `gorm:"column:url"`
	BindDN          string `gorm:"column:bind_dn"`
	BindPasswordEnc string `gorm:"column:bind_password_enc"`
	BaseDN          string `gorm:"column:base_dn"`
	UserFilter      string `gorm:"column:user_filter"`
	EmailAttribute  string `gorm:"column:email_attribute"`
	NameAttribute   string `gorm:"column:name_attribute"`
	TLSInsecure     int    `gorm:"column:tls_insecure"`
}

// loadLDAPConfig charge la configuration LDAP depuis la base de données ProxCenter
func (s *Server) loadLDAPConfig() (*ldap.Config, error) {
	if s.db == nil {
		return nil, nil
	}

	// Utiliser GORM pour charger la configuration
	db := s.db.DB()

	var config LdapConfigRecord

	result := db.Table("ldap_config").Where("id = ?", "default").First(&config)
	if result.Error != nil {
		// Table ou enregistrement n'existe pas
		log.Debug().Err(result.Error).Msg("LDAP config not found in database")
		return nil, nil
	}

	// Déchiffrer le mot de passe si présent
	bindPassword := ""
	if config.BindPasswordEnc != "" {
		appSecret := s.pve.GetAppSecret()
		if appSecret != "" {
			decrypted, err := decryptAESGCM(config.BindPasswordEnc, appSecret)
			if err != nil {
				log.Warn().Err(err).Msg("Failed to decrypt LDAP bind password")
			} else {
				bindPassword = decrypted
			}
		}
	}

	return &ldap.Config{
		Enabled:        config.Enabled == 1,
		URL:            config.URL,
		BindDN:         config.BindDN,
		BindPassword:   bindPassword,
		BaseDN:         config.BaseDN,
		UserFilter:     config.UserFilter,
		EmailAttribute: config.EmailAttribute,
		NameAttribute:  config.NameAttribute,
		TLSInsecure:    config.TLSInsecure == 1,
	}, nil
}

// decryptAESGCM déchiffre une chaîne chiffrée avec AES-256-GCM
// Format attendu: base64(nonce + ciphertext + tag)
// Compatible avec le chiffrement de ProxCenter (lib/crypto/secret.ts)
func decryptAESGCM(encrypted string, key string) (string, error) {
	if encrypted == "" {
		return "", nil
	}

	// Dériver une clé de 32 bytes à partir du secret
	keyBytes := deriveKey(key)

	// Décoder le base64
	data, err := base64.StdEncoding.DecodeString(encrypted)
	if err != nil {
		// Essayer avec URLEncoding
		data, err = base64.URLEncoding.DecodeString(encrypted)
		if err != nil {
			return "", err
		}
	}

	// Le format est: nonce (12 bytes) + ciphertext + tag (16 bytes)
	if len(data) < 12+16 {
		return "", err
	}

	nonce := data[:12]
	ciphertext := data[12:]

	// Créer le cipher AES
	block, err := aes.NewCipher(keyBytes)
	if err != nil {
		return "", err
	}

	// Créer le GCM
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	// Déchiffrer
	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", err
	}

	return string(plaintext), nil
}

// deriveKey dérive une clé de 32 bytes à partir d'un secret
func deriveKey(secret string) []byte {
	// ProxCenter utilise les 32 premiers bytes du secret ou le hash SHA-256
	if len(secret) >= 32 {
		return []byte(secret[:32])
	}

	// Si le secret est trop court, utiliser SHA-256
	hash := sha256.Sum256([]byte(secret))
	return hash[:]
}
