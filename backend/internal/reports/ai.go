package reports

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"github.com/rs/zerolog/log"
)

// AISettings represents the AI configuration from ProxCenter
type AISettings struct {
	Enabled        bool   `json:"enabled"`
	Provider       string `json:"provider"` // ollama, openai, anthropic
	OllamaURL      string `json:"ollamaUrl"`
	OllamaModel    string `json:"ollamaModel"`
	OpenAIKey      string `json:"openaiKey"`
	OpenAIModel    string `json:"openaiModel"`
	AnthropicKey   string `json:"anthropicKey"`
	AnthropicModel string `json:"anthropicModel"`
}

// DefaultAISettings returns the default AI settings
func DefaultAISettings() AISettings {
	return AISettings{
		Enabled:        false,
		Provider:       "ollama",
		OllamaURL:      "http://localhost:11434",
		OllamaModel:    "mistral:7b",
		OpenAIKey:      "",
		OpenAIModel:    "gpt-4o-mini",
		AnthropicKey:   "",
		AnthropicModel: "claude-3-haiku-20240307",
	}
}

// LoadAISettings loads AI settings from ProxCenter's database
func LoadAISettings(dbPath string) (AISettings, error) {
	settings := DefaultAISettings()

	if dbPath == "" {
		return settings, nil
	}

	db, err := sql.Open("sqlite3", dbPath+"?mode=ro")
	if err != nil {
		return settings, fmt.Errorf("failed to open ProxCenter database: %w", err)
	}
	defer db.Close()

	var value string
	err = db.QueryRow("SELECT value FROM settings WHERE key = 'ai'").Scan(&value)
	if err != nil {
		if err == sql.ErrNoRows {
			return settings, nil
		}
		return settings, fmt.Errorf("failed to query AI settings: %w", err)
	}

	if err := json.Unmarshal([]byte(value), &settings); err != nil {
		return settings, fmt.Errorf("failed to parse AI settings: %w", err)
	}

	return settings, nil
}

// AIAnalyzer provides AI-powered analysis for reports
type AIAnalyzer struct {
	settings AISettings
	client   *http.Client
}

// NewAIAnalyzer creates a new AI analyzer
func NewAIAnalyzer(settings AISettings) *AIAnalyzer {
	return &AIAnalyzer{
		settings: settings,
		client: &http.Client{
			Timeout: 120 * time.Second,
		},
	}
}

// IsEnabled returns whether AI analysis is enabled
func (a *AIAnalyzer) IsEnabled() bool {
	return a.settings.Enabled
}

// GenerateAnalysis generates an AI analysis based on the provided context
func (a *AIAnalyzer) GenerateAnalysis(ctx context.Context, reportType ReportType, data map[string]interface{}) (string, error) {
	return a.GenerateAnalysisWithLanguage(ctx, reportType, data, "en")
}

// GenerateAnalysisWithLanguage generates an AI analysis in the specified language
func (a *AIAnalyzer) GenerateAnalysisWithLanguage(ctx context.Context, reportType ReportType, data map[string]interface{}, language string) (string, error) {
	if !a.settings.Enabled {
		log.Debug().Msg("AI analysis disabled")
		return "", nil
	}

	log.Info().
		Str("provider", a.settings.Provider).
		Str("report_type", string(reportType)).
		Str("language", language).
		Msg("Generating AI analysis")

	// Build prompt based on report type and language
	prompt := a.buildPromptWithLanguage(reportType, data, language)

	var result string
	var err error

	switch a.settings.Provider {
	case "ollama":
		log.Debug().Str("url", a.settings.OllamaURL).Str("model", a.settings.OllamaModel).Msg("Calling Ollama")
		result, err = a.callOllama(ctx, prompt)
	case "openai":
		log.Debug().Str("model", a.settings.OpenAIModel).Msg("Calling OpenAI")
		result, err = a.callOpenAI(ctx, prompt)
	case "anthropic":
		log.Debug().Str("model", a.settings.AnthropicModel).Msg("Calling Anthropic")
		result, err = a.callAnthropic(ctx, prompt)
	default:
		return "", fmt.Errorf("unsupported AI provider: %s", a.settings.Provider)
	}

	if err != nil {
		log.Error().Err(err).Str("provider", a.settings.Provider).Msg("AI analysis failed")
		return "", err
	}

	log.Info().Int("response_length", len(result)).Msg("AI analysis completed")
	return result, nil
}

// buildPrompt creates a prompt for the AI based on report type and data (defaults to English)
func (a *AIAnalyzer) buildPrompt(reportType ReportType, data map[string]interface{}) string {
	return a.buildPromptWithLanguage(reportType, data, "en")
}

// buildPromptWithLanguage creates a prompt for the AI based on report type, data, and language
func (a *AIAnalyzer) buildPromptWithLanguage(reportType ReportType, data map[string]interface{}, language string) string {
	var sb strings.Builder

	// Language-specific instructions
	if language == "fr" {
		sb.WriteString("Tu es un analyste d'infrastructure pour un environnement de virtualisation Proxmox. ")
		sb.WriteString("Analyse les donnees suivantes et fournis une analyse concise et professionnelle en 2-3 paragraphes. ")
		sb.WriteString("Concentre-toi sur les points cles, les problemes potentiels et les recommandations actionnables. ")
		sb.WriteString("Sois precis avec les chiffres et les pourcentages. N'utilise pas de formatage markdown. ")
		sb.WriteString("IMPORTANT: Reponds UNIQUEMENT en francais.\n\n")

		switch reportType {
		case ReportTypeInfrastructure:
			sb.WriteString("Ceci est un Rapport d'Infrastructure. Analyse l'etat general et la sante de l'infrastructure.\n\n")
		case ReportTypeAlerts:
			sb.WriteString("Ceci est un Rapport d'Alertes. Analyse les tendances des alertes et suggere des actions correctives.\n\n")
		case ReportTypeUtilization:
			sb.WriteString("Ceci est un Rapport d'Utilisation. Analyse les tendances d'utilisation des ressources et l'efficacite.\n\n")
		case ReportTypeInventory:
			sb.WriteString("Ceci est un Rapport d'Inventaire. Analyse l'allocation et la distribution des ressources.\n\n")
		case ReportTypeCapacity:
			sb.WriteString("Ceci est un Rapport de Planification de Capacite. Analyse les tendances de capacite et fournis des recommandations de croissance.\n\n")
		}
	} else {
		sb.WriteString("You are an infrastructure analyst for a Proxmox virtualization environment. ")
		sb.WriteString("Analyze the following data and provide a concise, professional analysis in 2-3 paragraphs. ")
		sb.WriteString("Focus on key insights, potential issues, and actionable recommendations. ")
		sb.WriteString("Be specific with numbers and percentages. Do not use markdown formatting.\n\n")

		switch reportType {
		case ReportTypeInfrastructure:
			sb.WriteString("This is an Infrastructure Report. Analyze the overall health and status of the infrastructure.\n\n")
		case ReportTypeAlerts:
			sb.WriteString("This is an Alerts Report. Analyze the alert patterns and suggest remediation actions.\n\n")
		case ReportTypeUtilization:
			sb.WriteString("This is a Utilization Report. Analyze resource usage patterns and efficiency.\n\n")
		case ReportTypeInventory:
			sb.WriteString("This is an Inventory Report. Analyze the resource allocation and distribution.\n\n")
		case ReportTypeCapacity:
			sb.WriteString("This is a Capacity Planning Report. Analyze capacity trends and provide growth recommendations.\n\n")
		}
	}

	sb.WriteString("Data:\n")
	jsonData, _ := json.MarshalIndent(data, "", "  ")
	sb.WriteString(string(jsonData))

	if language == "fr" {
		sb.WriteString("\n\nFournis ton analyse en francais:")
	} else {
		sb.WriteString("\n\nProvide your analysis:")
	}

	return sb.String()
}

// callOllama calls the Ollama API
func (a *AIAnalyzer) callOllama(ctx context.Context, prompt string) (string, error) {
	url := strings.TrimSuffix(a.settings.OllamaURL, "/") + "/api/generate"

	reqBody := map[string]interface{}{
		"model":  a.settings.OllamaModel,
		"prompt": prompt,
		"stream": false,
		"options": map[string]interface{}{
			"temperature": 0.7,
			"num_predict": 1000,
		},
	}

	jsonBody, err := json.Marshal(reqBody)
	if err != nil {
		return "", err
	}

	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewBuffer(jsonBody))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := a.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("ollama request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("ollama returned status %d: %s", resp.StatusCode, string(body))
	}

	var result struct {
		Response string `json:"response"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return "", err
	}

	return strings.TrimSpace(result.Response), nil
}

// callOpenAI calls the OpenAI API
func (a *AIAnalyzer) callOpenAI(ctx context.Context, prompt string) (string, error) {
	if a.settings.OpenAIKey == "" {
		return "", fmt.Errorf("OpenAI API key not configured")
	}

	url := "https://api.openai.com/v1/chat/completions"

	reqBody := map[string]interface{}{
		"model": a.settings.OpenAIModel,
		"messages": []map[string]string{
			{"role": "user", "content": prompt},
		},
		"temperature": 0.7,
		"max_tokens":  1000,
	}

	jsonBody, err := json.Marshal(reqBody)
	if err != nil {
		return "", err
	}

	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewBuffer(jsonBody))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+a.settings.OpenAIKey)

	resp, err := a.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("openai request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("openai returned status %d: %s", resp.StatusCode, string(body))
	}

	var result struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return "", err
	}

	if len(result.Choices) == 0 {
		return "", fmt.Errorf("no response from OpenAI")
	}

	return strings.TrimSpace(result.Choices[0].Message.Content), nil
}

// callAnthropic calls the Anthropic API
func (a *AIAnalyzer) callAnthropic(ctx context.Context, prompt string) (string, error) {
	if a.settings.AnthropicKey == "" {
		return "", fmt.Errorf("Anthropic API key not configured")
	}

	url := "https://api.anthropic.com/v1/messages"

	reqBody := map[string]interface{}{
		"model": a.settings.AnthropicModel,
		"messages": []map[string]string{
			{"role": "user", "content": prompt},
		},
		"max_tokens": 1000,
	}

	jsonBody, err := json.Marshal(reqBody)
	if err != nil {
		return "", err
	}

	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewBuffer(jsonBody))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", a.settings.AnthropicKey)
	req.Header.Set("anthropic-version", "2023-06-01")

	resp, err := a.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("anthropic request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("anthropic returned status %d: %s", resp.StatusCode, string(body))
	}

	var result struct {
		Content []struct {
			Text string `json:"text"`
		} `json:"content"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return "", err
	}

	if len(result.Content) == 0 {
		return "", fmt.Errorf("no response from Anthropic")
	}

	return strings.TrimSpace(result.Content[0].Text), nil
}

// SummarizeData creates a summary of infrastructure data for AI analysis
func SummarizeData(allMetrics map[string]interface{}, connNames map[string]string) map[string]interface{} {
	summary := make(map[string]interface{})

	// Add cluster names mapping
	clusters := []map[string]interface{}{}
	for connID, name := range connNames {
		clusters = append(clusters, map[string]interface{}{
			"id":   connID,
			"name": name,
		})
	}
	summary["clusters"] = clusters
	summary["metrics"] = allMetrics

	return summary
}

// LogAIAnalysisAttempt logs an AI analysis attempt
func LogAIAnalysisAttempt(reportType ReportType, provider string, success bool, err error) {
	if success {
		log.Info().
			Str("report_type", string(reportType)).
			Str("provider", provider).
			Msg("AI analysis generated successfully")
	} else {
		log.Warn().
			Err(err).
			Str("report_type", string(reportType)).
			Str("provider", provider).
			Msg("AI analysis failed")
	}
}
