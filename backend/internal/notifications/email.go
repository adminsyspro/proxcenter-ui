package notifications

import (
	"crypto/tls"
	"fmt"
	"net/smtp"
	"strings"

	"github.com/rs/zerolog/log"
)

// EmailProvider gère l'envoi d'emails via SMTP
type EmailProvider struct {
	config EmailConfig
}

// NewEmailProvider crée un nouveau provider email
func NewEmailProvider(config EmailConfig) *EmailProvider {
	return &EmailProvider{
		config: config,
	}
}

// UpdateConfig met à jour la configuration SMTP
func (p *EmailProvider) UpdateConfig(config EmailConfig) {
	p.config = config
}

// IsEnabled retourne true si l'email est activé et configuré
func (p *EmailProvider) IsEnabled() bool {
	return p.config.Enabled &&
		p.config.SMTPHost != "" &&
		p.config.SMTPFrom != ""
}

// Send envoie un email
func (p *EmailProvider) Send(to []string, subject, htmlBody, textBody string) error {
	if !p.IsEnabled() {
		return fmt.Errorf("email provider is not enabled or configured")
	}

	if len(to) == 0 {
		return fmt.Errorf("no recipients specified")
	}

	// Construire le message MIME
	msg := p.buildMessage(to, subject, htmlBody, textBody)

	// Envoyer via SMTP
	addr := fmt.Sprintf("%s:%d", p.config.SMTPHost, p.config.SMTPPort)

	var auth smtp.Auth
	if p.config.SMTPUser != "" && p.config.SMTPPassword != "" {
		auth = smtp.PlainAuth("", p.config.SMTPUser, p.config.SMTPPassword, p.config.SMTPHost)
	}

	// Choisir la méthode d'envoi selon la configuration TLS
	if p.config.UseTLS {
		return p.sendWithTLS(addr, auth, to, msg)
	} else if p.config.UseStartTLS {
		return p.sendWithStartTLS(addr, auth, to, msg)
	} else {
		return smtp.SendMail(addr, auth, p.config.SMTPFrom, to, msg)
	}
}

// buildMessage construit le message MIME multipart
func (p *EmailProvider) buildMessage(to []string, subject, htmlBody, textBody string) []byte {
	boundary := "==ProxCenterBoundary=="

	fromHeader := p.config.SMTPFrom
	if p.config.SMTPFromName != "" {
		fromHeader = fmt.Sprintf("%s <%s>", p.config.SMTPFromName, p.config.SMTPFrom)
	}

	var msg strings.Builder

	// Headers
	msg.WriteString(fmt.Sprintf("From: %s\r\n", fromHeader))
	msg.WriteString(fmt.Sprintf("To: %s\r\n", strings.Join(to, ", ")))
	msg.WriteString(fmt.Sprintf("Subject: %s\r\n", subject))
	msg.WriteString("MIME-Version: 1.0\r\n")
	msg.WriteString(fmt.Sprintf("Content-Type: multipart/alternative; boundary=\"%s\"\r\n", boundary))
	msg.WriteString("\r\n")

	// Plain text part
	if textBody != "" {
		msg.WriteString(fmt.Sprintf("--%s\r\n", boundary))
		msg.WriteString("Content-Type: text/plain; charset=\"UTF-8\"\r\n")
		msg.WriteString("Content-Transfer-Encoding: quoted-printable\r\n")
		msg.WriteString("\r\n")
		msg.WriteString(textBody)
		msg.WriteString("\r\n")
	}

	// HTML part
	if htmlBody != "" {
		msg.WriteString(fmt.Sprintf("--%s\r\n", boundary))
		msg.WriteString("Content-Type: text/html; charset=\"UTF-8\"\r\n")
		msg.WriteString("Content-Transfer-Encoding: quoted-printable\r\n")
		msg.WriteString("\r\n")
		msg.WriteString(htmlBody)
		msg.WriteString("\r\n")
	}

	// End boundary
	msg.WriteString(fmt.Sprintf("--%s--\r\n", boundary))

	return []byte(msg.String())
}

// sendWithTLS envoie via connexion TLS directe (port 465)
func (p *EmailProvider) sendWithTLS(addr string, auth smtp.Auth, to []string, msg []byte) error {
	tlsConfig := &tls.Config{
		InsecureSkipVerify: p.config.SkipVerify,
		ServerName:         p.config.SMTPHost,
	}

	conn, err := tls.Dial("tcp", addr, tlsConfig)
	if err != nil {
		return fmt.Errorf("TLS dial failed: %w", err)
	}
	defer conn.Close()

	client, err := smtp.NewClient(conn, p.config.SMTPHost)
	if err != nil {
		return fmt.Errorf("SMTP client creation failed: %w", err)
	}
	defer client.Close()

	return p.sendWithClient(client, auth, to, msg)
}

// sendWithStartTLS envoie via STARTTLS (port 587)
func (p *EmailProvider) sendWithStartTLS(addr string, auth smtp.Auth, to []string, msg []byte) error {
	client, err := smtp.Dial(addr)
	if err != nil {
		return fmt.Errorf("SMTP dial failed: %w", err)
	}
	defer client.Close()

	// STARTTLS
	tlsConfig := &tls.Config{
		InsecureSkipVerify: p.config.SkipVerify,
		ServerName:         p.config.SMTPHost,
	}

	if err := client.StartTLS(tlsConfig); err != nil {
		return fmt.Errorf("STARTTLS failed: %w", err)
	}

	return p.sendWithClient(client, auth, to, msg)
}

// sendWithClient envoie le message via un client SMTP
func (p *EmailProvider) sendWithClient(client *smtp.Client, auth smtp.Auth, to []string, msg []byte) error {
	// Auth si configuré
	if auth != nil {
		if err := client.Auth(auth); err != nil {
			return fmt.Errorf("SMTP auth failed: %w", err)
		}
	}

	// From
	if err := client.Mail(p.config.SMTPFrom); err != nil {
		return fmt.Errorf("MAIL FROM failed: %w", err)
	}

	// To
	for _, recipient := range to {
		if err := client.Rcpt(recipient); err != nil {
			return fmt.Errorf("RCPT TO failed for %s: %w", recipient, err)
		}
	}

	// Data
	w, err := client.Data()
	if err != nil {
		return fmt.Errorf("DATA failed: %w", err)
	}

	_, err = w.Write(msg)
	if err != nil {
		return fmt.Errorf("write failed: %w", err)
	}

	if err := w.Close(); err != nil {
		return fmt.Errorf("close failed: %w", err)
	}

	return client.Quit()
}

// TestConnection teste la connexion SMTP
func (p *EmailProvider) TestConnection() error {
	if !p.config.Enabled {
		return fmt.Errorf("email provider is not enabled")
	}

	if p.config.SMTPHost == "" {
		return fmt.Errorf("SMTP host is not configured")
	}

	addr := fmt.Sprintf("%s:%d", p.config.SMTPHost, p.config.SMTPPort)

	log.Debug().
		Str("host", p.config.SMTPHost).
		Int("port", p.config.SMTPPort).
		Bool("tls", p.config.UseTLS).
		Bool("starttls", p.config.UseStartTLS).
		Msg("Testing SMTP connection")

	if p.config.UseTLS {
		tlsConfig := &tls.Config{
			InsecureSkipVerify: p.config.SkipVerify,
			ServerName:         p.config.SMTPHost,
		}
		conn, err := tls.Dial("tcp", addr, tlsConfig)
		if err != nil {
			return fmt.Errorf("TLS connection failed: %w", err)
		}
		conn.Close()
		return nil
	}

	client, err := smtp.Dial(addr)
	if err != nil {
		return fmt.Errorf("SMTP connection failed: %w", err)
	}
	defer client.Close()

	if p.config.UseStartTLS {
		tlsConfig := &tls.Config{
			InsecureSkipVerify: p.config.SkipVerify,
			ServerName:         p.config.SMTPHost,
		}
		if err := client.StartTLS(tlsConfig); err != nil {
			return fmt.Errorf("STARTTLS failed: %w", err)
		}
	}

	// Test auth si configuré
	if p.config.SMTPUser != "" && p.config.SMTPPassword != "" {
		auth := smtp.PlainAuth("", p.config.SMTPUser, p.config.SMTPPassword, p.config.SMTPHost)
		if err := client.Auth(auth); err != nil {
			return fmt.Errorf("authentication failed: %w", err)
		}
	}

	return client.Quit()
}
