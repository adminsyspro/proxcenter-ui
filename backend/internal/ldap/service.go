package ldap

import (
	"crypto/tls"
	"encoding/base64"
	"fmt"
	"strings"
	"time"

	"github.com/go-ldap/ldap/v3"
	"github.com/rs/zerolog/log"
)

// Config représente la configuration LDAP
type Config struct {
	Enabled        bool   `json:"enabled"`
	URL            string `json:"url"`
	BindDN         string `json:"bind_dn,omitempty"`
	BindPassword   string `json:"bind_password,omitempty"`
	BaseDN         string `json:"base_dn"`
	UserFilter     string `json:"user_filter"`
	EmailAttribute string `json:"email_attribute"`
	NameAttribute  string `json:"name_attribute"`
	TLSInsecure    bool   `json:"tls_insecure"`
}

// User représente un utilisateur authentifié via LDAP
type User struct {
	DN     string `json:"dn"`
	Email  string `json:"email"`
	Name   string `json:"name"`
	Avatar string `json:"avatar,omitempty"`
}

// AuthRequest représente une demande d'authentification
type AuthRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

// AuthResponse représente la réponse d'authentification
type AuthResponse struct {
	Success bool   `json:"success"`
	User    *User  `json:"user,omitempty"`
	Error   string `json:"error,omitempty"`
}

// TestRequest représente une demande de test de connexion
type TestRequest struct {
	URL          string `json:"url"`
	BindDN       string `json:"bind_dn,omitempty"`
	BindPassword string `json:"bind_password,omitempty"`
	BaseDN       string `json:"base_dn"`
	UserFilter   string `json:"user_filter,omitempty"`
	TLSInsecure  bool   `json:"tls_insecure"`
}

// TestResponse représente la réponse du test de connexion
type TestResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
}

// Service gère l'authentification LDAP
type Service struct {
	timeout time.Duration
}

// NewService crée un nouveau service LDAP
func NewService() *Service {
	return &Service{
		timeout: 10 * time.Second,
	}
}

// Authenticate authentifie un utilisateur via LDAP
func (s *Service) Authenticate(config *Config, req *AuthRequest) *AuthResponse {
	if config == nil || !config.Enabled {
		return &AuthResponse{
			Success: false,
			Error:   "LDAP authentication is not enabled",
		}
	}

	if req.Username == "" || req.Password == "" {
		return &AuthResponse{
			Success: false,
			Error:   "Username and password are required",
		}
	}

	// Connexion au serveur LDAP
	conn, err := s.connect(config.URL, config.TLSInsecure)
	if err != nil {
		log.Error().Err(err).Str("url", config.URL).Msg("Failed to connect to LDAP server")
		return &AuthResponse{
			Success: false,
			Error:   fmt.Sprintf("Failed to connect to LDAP server: %v", s.friendlyError(err)),
		}
	}
	defer conn.Close()

	// Bind avec le compte de service si configuré
	if config.BindDN != "" && config.BindPassword != "" {
		if err := conn.Bind(config.BindDN, config.BindPassword); err != nil {
			log.Error().Err(err).Str("bind_dn", config.BindDN).Msg("Failed to bind with service account")
			return &AuthResponse{
				Success: false,
				Error:   fmt.Sprintf("Failed to bind with service account: %v", s.friendlyError(err)),
			}
		}
	}

	// Rechercher l'utilisateur
	userFilter := config.UserFilter
	if userFilter == "" {
		userFilter = "(uid={{username}})"
	}
	filter := strings.ReplaceAll(userFilter, "{{username}}", ldap.EscapeFilter(req.Username))

	searchReq := ldap.NewSearchRequest(
		config.BaseDN,
		ldap.ScopeWholeSubtree,
		ldap.NeverDerefAliases,
		1,    // SizeLimit
		10,   // TimeLimit (seconds)
		false,
		filter,
		s.getSearchAttributes(config),
		nil,
	)

	result, err := conn.Search(searchReq)
	if err != nil {
		log.Error().Err(err).Str("filter", filter).Msg("LDAP search failed")
		return &AuthResponse{
			Success: false,
			Error:   fmt.Sprintf("LDAP search failed: %v", s.friendlyError(err)),
		}
	}

	if len(result.Entries) == 0 {
		log.Debug().Str("username", req.Username).Msg("User not found in LDAP")
		return &AuthResponse{
			Success: false,
			Error:   "Invalid credentials",
		}
	}

	userEntry := result.Entries[0]
	userDN := userEntry.DN

	// Fermer la connexion actuelle et en ouvrir une nouvelle pour le bind utilisateur
	conn.Close()

	userConn, err := s.connect(config.URL, config.TLSInsecure)
	if err != nil {
		return &AuthResponse{
			Success: false,
			Error:   fmt.Sprintf("Failed to connect for user bind: %v", s.friendlyError(err)),
		}
	}
	defer userConn.Close()

	// Tenter le bind avec les credentials de l'utilisateur
	if err := userConn.Bind(userDN, req.Password); err != nil {
		log.Debug().Err(err).Str("dn", userDN).Msg("User bind failed - invalid password")
		return &AuthResponse{
			Success: false,
			Error:   "Invalid credentials",
		}
	}

	// Extraire les attributs
	user := s.extractUser(userEntry, config)

	log.Info().
		Str("username", req.Username).
		Str("email", user.Email).
		Str("dn", user.DN).
		Msg("LDAP authentication successful")

	return &AuthResponse{
		Success: true,
		User:    user,
	}
}

// TestConnection teste la connexion LDAP avec les paramètres fournis
func (s *Service) TestConnection(req *TestRequest) *TestResponse {
	if req.URL == "" {
		return &TestResponse{
			Success: false,
			Message: "LDAP URL is required",
		}
	}

	// Connexion au serveur
	conn, err := s.connect(req.URL, req.TLSInsecure)
	if err != nil {
		return &TestResponse{
			Success: false,
			Message: fmt.Sprintf("Connection failed: %v", s.friendlyError(err)),
		}
	}
	defer conn.Close()

	// Tester le bind
	if req.BindDN != "" && req.BindPassword != "" {
		if err := conn.Bind(req.BindDN, req.BindPassword); err != nil {
			return &TestResponse{
				Success: false,
				Message: fmt.Sprintf("Bind failed: %v", s.friendlyError(err)),
			}
		}
	} else {
		// Anonymous bind
		if err := conn.UnauthenticatedBind(""); err != nil {
			// Certains serveurs n'autorisent pas l'anonymous bind, ce n'est pas forcément une erreur
			log.Debug().Err(err).Msg("Anonymous bind failed (may be expected)")
		}
	}

	// Tester la recherche sur le BaseDN si fourni
	if req.BaseDN != "" {
		searchReq := ldap.NewSearchRequest(
			req.BaseDN,
			ldap.ScopeBaseObject,
			ldap.NeverDerefAliases,
			1,
			5,
			false,
			"(objectClass=*)",
			[]string{"dn"},
			nil,
		)

		_, err := conn.Search(searchReq)
		if err != nil {
			return &TestResponse{
				Success: false,
				Message: fmt.Sprintf("Base DN not found or not accessible: %v", s.friendlyError(err)),
			}
		}
	}

	return &TestResponse{
		Success: true,
		Message: "LDAP connection successful",
	}
}

// connect établit une connexion au serveur LDAP
func (s *Service) connect(url string, tlsInsecure bool) (*ldap.Conn, error) {
	var conn *ldap.Conn
	var err error

	// Déterminer si c'est LDAPS
	isLDAPS := strings.HasPrefix(strings.ToLower(url), "ldaps://")

	if isLDAPS {
		tlsConfig := &tls.Config{
			InsecureSkipVerify: tlsInsecure,
		}
		conn, err = ldap.DialURL(url, ldap.DialWithTLSConfig(tlsConfig))
	} else {
		conn, err = ldap.DialURL(url)
	}

	if err != nil {
		return nil, err
	}

	// Configurer le timeout
	conn.SetTimeout(s.timeout)

	return conn, nil
}

// getSearchAttributes retourne les attributs à rechercher
func (s *Service) getSearchAttributes(config *Config) []string {
	attrs := []string{
		"dn",
		"mail",
		"userPrincipalName",
		"sAMAccountName",
		"uid",
		"cn",
		"displayName",
		"givenName",
		"sn",
		"thumbnailPhoto",
		"jpegPhoto",
	}

	// Ajouter les attributs personnalisés s'ils ne sont pas déjà présents
	if config.EmailAttribute != "" && !contains(attrs, config.EmailAttribute) {
		attrs = append(attrs, config.EmailAttribute)
	}
	if config.NameAttribute != "" && !contains(attrs, config.NameAttribute) {
		attrs = append(attrs, config.NameAttribute)
	}

	return attrs
}

// extractUser extrait les informations utilisateur d'une entrée LDAP
func (s *Service) extractUser(entry *ldap.Entry, config *Config) *User {
	user := &User{
		DN: entry.DN,
	}

	// Extraire l'email
	emailAttr := config.EmailAttribute
	if emailAttr == "" {
		emailAttr = "mail"
	}
	user.Email = s.getAttribute(entry, emailAttr)
	if user.Email == "" {
		user.Email = s.getAttribute(entry, "mail")
	}
	if user.Email == "" {
		user.Email = s.getAttribute(entry, "userPrincipalName")
	}

	// Extraire le nom
	nameAttr := config.NameAttribute
	if nameAttr == "" {
		nameAttr = "cn"
	}
	user.Name = s.getAttribute(entry, nameAttr)
	if user.Name == "" {
		user.Name = s.getAttribute(entry, "displayName")
	}
	if user.Name == "" {
		user.Name = s.getAttribute(entry, "cn")
	}
	if user.Name == "" {
		// Construire à partir de givenName + sn
		givenName := s.getAttribute(entry, "givenName")
		sn := s.getAttribute(entry, "sn")
		if givenName != "" && sn != "" {
			user.Name = givenName + " " + sn
		}
	}

	// Extraire l'avatar (photo)
	photoData := entry.GetRawAttributeValue("thumbnailPhoto")
	if len(photoData) == 0 {
		photoData = entry.GetRawAttributeValue("jpegPhoto")
	}
	if len(photoData) > 0 {
		// Encoder en base64 pour créer une data URL
		user.Avatar = fmt.Sprintf("data:image/jpeg;base64,%s", base64.StdEncoding.EncodeToString(photoData))
	}

	// Fallback pour l'email: construire à partir du DN si possible
	if user.Email == "" {
		user.Email = s.extractEmailFromDN(entry.DN, config.BaseDN)
	}

	return user
}

// getAttribute récupère un attribut d'une entrée LDAP
func (s *Service) getAttribute(entry *ldap.Entry, attr string) string {
	values := entry.GetAttributeValues(attr)
	if len(values) > 0 {
		return values[0]
	}
	return ""
}

// extractEmailFromDN tente d'extraire une adresse email à partir du DN et du BaseDN
func (s *Service) extractEmailFromDN(dn, baseDN string) string {
	// Extraire le cn du DN
	parts := strings.Split(dn, ",")
	if len(parts) == 0 {
		return ""
	}

	var cn string
	for _, part := range parts {
		if strings.HasPrefix(strings.ToLower(part), "cn=") {
			cn = strings.TrimPrefix(part, "cn=")
			cn = strings.TrimPrefix(cn, "CN=")
			break
		}
		if strings.HasPrefix(strings.ToLower(part), "uid=") {
			cn = strings.TrimPrefix(part, "uid=")
			cn = strings.TrimPrefix(cn, "UID=")
			break
		}
	}

	if cn == "" {
		return ""
	}

	// Extraire le domaine du BaseDN
	var domainParts []string
	for _, part := range strings.Split(baseDN, ",") {
		if strings.HasPrefix(strings.ToLower(part), "dc=") {
			dc := strings.TrimPrefix(part, "dc=")
			dc = strings.TrimPrefix(dc, "DC=")
			domainParts = append(domainParts, dc)
		}
	}

	if len(domainParts) == 0 {
		return ""
	}

	domain := strings.Join(domainParts, ".")
	return fmt.Sprintf("%s@%s", cn, domain)
}

// friendlyError convertit les erreurs LDAP en messages plus lisibles
func (s *Service) friendlyError(err error) string {
	errStr := err.Error()

	if strings.Contains(errStr, "connection refused") {
		return "Connection refused. Check the URL and port."
	}
	if strings.Contains(errStr, "connection reset") {
		return "Connection reset. Try using ldaps:// on port 636."
	}
	if strings.Contains(errStr, "i/o timeout") || strings.Contains(errStr, "timeout") {
		return "Connection timeout. Check that the server is accessible."
	}
	if strings.Contains(errStr, "certificate") {
		return "TLS certificate error. Enable 'Ignore TLS certificate' option."
	}
	if strings.Contains(errStr, "invalid DN") || strings.Contains(errStr, "Invalid DN") {
		return "Invalid DN format. Check the Bind DN syntax."
	}
	if strings.Contains(errStr, "No Such Object") {
		return "Base DN not found. Check the Base DN path."
	}
	if strings.Contains(errStr, "Invalid Credentials") {
		return "Invalid credentials for service account."
	}

	return errStr
}

// contains vérifie si un slice contient un élément
func contains(slice []string, item string) bool {
	for _, s := range slice {
		if s == item {
			return true
		}
	}
	return false
}
