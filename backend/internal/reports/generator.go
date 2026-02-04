package reports

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"time"

	"github.com/jung-kurt/gofpdf"
	"github.com/rs/zerolog/log"

	"github.com/proxcenter/orchestrator/internal/metrics"
	"github.com/proxcenter/orchestrator/internal/proxmox"
)

// ProxCenter Theme Colors
var (
	colorOrange     = [3]int{229, 112, 0}   // #e57000 - Primary brand color
	colorOrangeDark = [3]int{204, 100, 0}   // Darker orange for accents
	colorSlate900   = [3]int{15, 23, 42}    // Dark text
	colorSlate700   = [3]int{51, 65, 85}    // Secondary text
	colorSlate500   = [3]int{100, 116, 139} // Muted text
	colorSlate200   = [3]int{226, 232, 240} // Borders
	colorSlate100   = [3]int{241, 245, 249} // Light backgrounds
	colorSlate50    = [3]int{248, 250, 252} // Very light backgrounds
	colorWhite      = [3]int{255, 255, 255}
	colorGreen      = [3]int{16, 185, 129}
	colorBlue       = [3]int{59, 130, 246}
	colorPurple     = [3]int{139, 92, 246}
	colorAmber      = [3]int{245, 158, 11}
	colorRed        = [3]int{239, 68, 68}
)

// Generator handles PDF report generation
type Generator struct {
	service    *Service
	connNames  map[string]string // Connection ID -> Name mapping
	aiAnalyzer *AIAnalyzer
	proxDBPath string
	logoPath   string
	tr         *Translations
	lang       string
	utf8       func(string) string // UTF-8 to cp1252 translator
}

// NewGenerator creates a new PDF generator
func NewGenerator(service *Service) *Generator {
	// Determine logo path relative to executable
	execPath, _ := os.Executable()
	execDir := filepath.Dir(execPath)
	logoPath := filepath.Join(execDir, "assets", "logo.png")

	// Fallback to common locations
	if _, err := os.Stat(logoPath); os.IsNotExist(err) {
		logoPath = "/root/saas/proxcenter-orchestrator/assets/logo.png"
	}

	return &Generator{
		service:   service,
		connNames: make(map[string]string),
		logoPath:  logoPath,
		tr:        GetTranslations(LangEnglish),
	}
}

// SetProxCenterDBPath sets the path to ProxCenter's database for loading connection names and AI settings
func (g *Generator) SetProxCenterDBPath(dbPath string) {
	g.proxDBPath = dbPath
	g.loadConnectionNames()
	g.loadAISettings()
}

// loadConnectionNames loads connection names from ProxCenter's database
func (g *Generator) loadConnectionNames() {
	if g.proxDBPath == "" {
		return
	}

	db, err := sql.Open("sqlite3", g.proxDBPath+"?mode=ro")
	if err != nil {
		log.Warn().Err(err).Msg("Failed to open ProxCenter database for connection names")
		return
	}
	defer db.Close()

	rows, err := db.Query("SELECT id, name FROM Connection WHERE type = 'pve'")
	if err != nil {
		log.Warn().Err(err).Msg("Failed to query connection names")
		return
	}
	defer rows.Close()

	for rows.Next() {
		var id, name string
		if err := rows.Scan(&id, &name); err != nil {
			continue
		}
		g.connNames[id] = name
	}

	log.Info().Int("count", len(g.connNames)).Msg("Loaded connection names from ProxCenter")
}

// loadAISettings loads AI settings from ProxCenter's database
func (g *Generator) loadAISettings() {
	settings, err := LoadAISettings(g.proxDBPath)
	if err != nil {
		log.Warn().Err(err).Msg("Failed to load AI settings")
		return
	}

	g.aiAnalyzer = NewAIAnalyzer(settings)
	if settings.Enabled {
		log.Info().Str("provider", settings.Provider).Msg("AI analysis enabled for reports")
	}
}

// getConnectionName returns the display name for a connection ID
func (g *Generator) getConnectionName(connID string) string {
	if name, ok := g.connNames[connID]; ok && name != "" {
		return name
	}
	if len(connID) > 12 {
		return connID[:8] + "..."
	}
	return connID
}

// Generate creates a PDF report and returns the file path and size
func (g *Generator) Generate(ctx context.Context, report *ReportRecord) (string, int64, error) {
	// Set language for this report
	lang := Language(report.Language)
	if lang == "" {
		lang = LangEnglish
	}
	g.tr = GetTranslations(lang)
	g.lang = string(lang)

	// Initialize UTF-8 to cp1252 translator for proper character encoding (French accents, etc.)
	g.utf8 = utf8ToCp1252

	log.Info().
		Int("conn_names", len(g.connNames)).
		Bool("ai_enabled", g.aiAnalyzer != nil && g.aiAnalyzer.IsEnabled()).
		Str("type", string(report.Type)).
		Str("language", string(lang)).
		Msg("Starting PDF generation")

	// Create PDF
	pdf := gofpdf.New("P", "mm", "A4", "")
	pdf.SetTitle(report.Name, true)
	pdf.SetAuthor("ProxCenter", true)
	pdf.SetCreator("ProxCenter Enterprise Reports", true)

	// Setup margins
	pdf.SetMargins(15, 20, 15)
	pdf.SetAutoPageBreak(true, 20)

	// Add cover page
	g.addCoverPage(pdf, report)

	// Add header/footer for subsequent pages
	g.setupHeaderFooter(pdf, report)

	// Generate content based on report type
	switch report.Type {
	case ReportTypeInfrastructure:
		g.generateInfrastructureReport(ctx, pdf, report)
	case ReportTypeAlerts:
		g.generateAlertsReport(ctx, pdf, report)
	case ReportTypeUtilization:
		g.generateUtilizationReport(ctx, pdf, report)
	case ReportTypeInventory:
		g.generateInventoryReport(ctx, pdf, report)
	case ReportTypeCapacity:
		g.generateCapacityReport(ctx, pdf, report)
	default:
		return "", 0, fmt.Errorf("unsupported report type: %s", report.Type)
	}

	// Save PDF
	filePath := g.service.GetFilePath(report)
	if err := pdf.OutputFileAndClose(filePath); err != nil {
		return "", 0, fmt.Errorf("failed to save PDF: %w", err)
	}

	// Get file size
	info, err := os.Stat(filePath)
	if err != nil {
		return filePath, 0, nil
	}

	log.Info().
		Str("file_path", filePath).
		Int64("file_size", info.Size()).
		Msg("PDF generation completed")

	return filePath, info.Size(), nil
}

// addCoverPage creates an elegant cover page
func (g *Generator) addCoverPage(pdf *gofpdf.Fpdf, report *ReportRecord) {
	pdf.AddPage()

	pageWidth, pageHeight := pdf.GetPageSize()

	// Orange header bar
	pdf.SetFillColor(colorOrange[0], colorOrange[1], colorOrange[2])
	pdf.Rect(0, 0, pageWidth, 60, "F")

	// Add logo if exists
	if _, err := os.Stat(g.logoPath); err == nil {
		pdf.ImageOptions(g.logoPath, 15, 15, 30, 0, false, gofpdf.ImageOptions{ImageType: "PNG"}, 0, "")
		// Logo text next to logo
		pdf.SetFont("Arial", "B", 24)
		pdf.SetTextColor(colorWhite[0], colorWhite[1], colorWhite[2])
		pdf.SetXY(50, 20)
		pdf.CellFormat(0, 12, "PROXCENTER", "", 0, "L", false, 0, "")
	} else {
		// Fallback: text only
		pdf.SetFont("Arial", "B", 28)
		pdf.SetTextColor(colorWhite[0], colorWhite[1], colorWhite[2])
		pdf.SetXY(15, 20)
		pdf.CellFormat(0, 12, "PROXCENTER", "", 0, "L", false, 0, "")
	}

	// Subtitle "Enterprise Report"
	pdf.SetFont("Arial", "", 14)
	pdf.SetXY(15, 40)
	pdf.CellFormat(0, 8, g.utf8(g.tr.EnterpriseReport), "", 0, "L", false, 0, "")

	// Main title area
	pdf.SetY(100)
	pdf.SetFont("Arial", "B", 32)
	pdf.SetTextColor(colorSlate900[0], colorSlate900[1], colorSlate900[2])
	pdf.MultiCell(0, 14, g.utf8(report.Name), "", "C", false)

	// Report type badge
	pdf.Ln(10)
	pdf.SetFont("Arial", "", 14)
	pdf.SetTextColor(colorSlate500[0], colorSlate500[1], colorSlate500[2])
	typeLabel := g.getReportTypeLabel(report.Type)
	pdf.CellFormat(0, 8, g.utf8(typeLabel), "", 1, "C", false, 0, "")

	// Decorative line
	pdf.Ln(15)
	lineY := pdf.GetY()
	pdf.SetDrawColor(colorOrange[0], colorOrange[1], colorOrange[2])
	pdf.SetLineWidth(1)
	pdf.Line(pageWidth/2-40, lineY, pageWidth/2+40, lineY)

	// Report details box
	pdf.SetY(180)
	boxX := pageWidth/2 - 60
	boxWidth := 120.0
	boxHeight := 60.0

	// Box background
	pdf.SetFillColor(colorSlate50[0], colorSlate50[1], colorSlate50[2])
	pdf.SetDrawColor(colorSlate200[0], colorSlate200[1], colorSlate200[2])
	pdf.SetLineWidth(0.3)
	pdf.RoundedRect(boxX, pdf.GetY(), boxWidth, boxHeight, 3, "1234", "FD")

	// Box content
	pdf.SetXY(boxX+10, pdf.GetY()+10)
	pdf.SetFont("Arial", "B", 10)
	pdf.SetTextColor(colorSlate700[0], colorSlate700[1], colorSlate700[2])
	pdf.CellFormat(boxWidth-20, 6, g.utf8(g.tr.ReportPeriod), "", 1, "C", false, 0, "")

	pdf.SetXY(boxX+10, pdf.GetY()+2)
	pdf.SetFont("Arial", "", 11)
	pdf.SetTextColor(colorSlate900[0], colorSlate900[1], colorSlate900[2])
	periodStr := fmt.Sprintf("%s - %s", report.DateFrom.Format("02/01/2006"), report.DateTo.Format("02/01/2006"))
	pdf.CellFormat(boxWidth-20, 6, periodStr, "", 1, "C", false, 0, "")

	pdf.SetXY(boxX+10, pdf.GetY()+8)
	pdf.SetFont("Arial", "B", 10)
	pdf.SetTextColor(colorSlate700[0], colorSlate700[1], colorSlate700[2])
	pdf.CellFormat(boxWidth-20, 6, g.utf8(g.tr.Generated), "", 1, "C", false, 0, "")

	pdf.SetXY(boxX+10, pdf.GetY()+2)
	pdf.SetFont("Arial", "", 11)
	pdf.SetTextColor(colorSlate900[0], colorSlate900[1], colorSlate900[2])
	pdf.CellFormat(boxWidth-20, 6, time.Now().Format("02/01/2006 15:04"), "", 1, "C", false, 0, "")

	// Footer on cover
	pdf.SetY(pageHeight - 30)
	pdf.SetFont("Arial", "", 9)
	pdf.SetTextColor(colorSlate500[0], colorSlate500[1], colorSlate500[2])
	pdf.CellFormat(0, 5, g.utf8(g.tr.GeneratedBy), "", 1, "C", false, 0, "")
	pdf.CellFormat(0, 5, fmt.Sprintf("%s: %s", g.tr.ReportID, report.ID[:8]), "", 1, "C", false, 0, "")
}

// setupHeaderFooter configures the PDF header and footer
func (g *Generator) setupHeaderFooter(pdf *gofpdf.Fpdf, report *ReportRecord) {
	pdf.SetHeaderFunc(func() {
		if pdf.PageNo() == 1 {
			return // Skip header on cover page
		}

		pageWidth, _ := pdf.GetPageSize()

		// Header line
		pdf.SetDrawColor(colorOrange[0], colorOrange[1], colorOrange[2])
		pdf.SetLineWidth(0.8)
		pdf.Line(15, 15, pageWidth-15, 15)

		// Logo text
		pdf.SetFont("Arial", "B", 10)
		pdf.SetTextColor(colorOrange[0], colorOrange[1], colorOrange[2])
		pdf.SetXY(15, 8)
		pdf.CellFormat(40, 6, "PROXCENTER", "", 0, "L", false, 0, "")

		// Report name on right
		pdf.SetFont("Arial", "", 9)
		pdf.SetTextColor(colorSlate500[0], colorSlate500[1], colorSlate500[2])
		pdf.SetXY(pageWidth-100, 8)
		pdf.CellFormat(85, 6, truncateString(report.Name, 40), "", 0, "R", false, 0, "")

		pdf.SetY(20)
	})

	pdf.SetFooterFunc(func() {
		if pdf.PageNo() == 1 {
			return // Skip footer on cover page
		}

		pageWidth, _ := pdf.GetPageSize()

		pdf.SetY(-15)

		// Footer line
		pdf.SetDrawColor(colorSlate200[0], colorSlate200[1], colorSlate200[2])
		pdf.SetLineWidth(0.3)
		pdf.Line(15, pdf.GetY(), pageWidth-15, pdf.GetY())

		// Page number
		pdf.SetFont("Arial", "", 9)
		pdf.SetTextColor(colorSlate500[0], colorSlate500[1], colorSlate500[2])
		pdf.SetY(-12)
		pdf.CellFormat(0, 8, fmt.Sprintf(g.tr.Page, pdf.PageNo()-1), "", 0, "C", false, 0, "")
	})
}

// getReportTypeLabel returns the localized label for a report type
func (g *Generator) getReportTypeLabel(t ReportType) string {
	switch t {
	case ReportTypeInfrastructure:
		return g.tr.InfrastructureReport
	case ReportTypeAlerts:
		return g.tr.AlertsReport
	case ReportTypeUtilization:
		return g.tr.UtilizationReport
	case ReportTypeInventory:
		return g.tr.InventoryReport
	case ReportTypeCapacity:
		return g.tr.CapacityPlanningReport
	default:
		return string(t)
	}
}

// addSectionHeader adds a styled section header
func (g *Generator) addSectionHeader(pdf *gofpdf.Fpdf, title string) {
	pdf.Ln(8)

	// Orange accent bar
	pdf.SetFillColor(colorOrange[0], colorOrange[1], colorOrange[2])
	pdf.Rect(15, pdf.GetY(), 4, 10, "F")

	// Title
	pdf.SetX(22)
	pdf.SetFont("Arial", "B", 16)
	pdf.SetTextColor(colorSlate900[0], colorSlate900[1], colorSlate900[2])
	pdf.CellFormat(0, 10, g.utf8(title), "", 1, "L", false, 0, "")

	pdf.Ln(3)
}

// addSubHeader adds a sub-section header
func (g *Generator) addSubHeader(pdf *gofpdf.Fpdf, title string) {
	pdf.Ln(5)
	pdf.SetFont("Arial", "B", 12)
	pdf.SetTextColor(colorSlate700[0], colorSlate700[1], colorSlate700[2])
	pdf.CellFormat(0, 8, g.utf8(title), "", 1, "L", false, 0, "")
	pdf.Ln(2)
}

// addParagraph adds a paragraph of text
func (g *Generator) addParagraph(pdf *gofpdf.Fpdf, text string) {
	pdf.SetFont("Arial", "", 10)
	pdf.SetTextColor(colorSlate700[0], colorSlate700[1], colorSlate700[2])
	pdf.MultiCell(0, 5.5, g.utf8(text), "", "L", false)
	pdf.Ln(3)
}

// addKeyValue adds a key-value pair
func (g *Generator) addKeyValue(pdf *gofpdf.Fpdf, key, value string) {
	pdf.SetFont("Arial", "", 10)
	pdf.SetTextColor(colorSlate500[0], colorSlate500[1], colorSlate500[2])
	pdf.CellFormat(55, 6, g.utf8(key), "", 0, "L", false, 0, "")
	pdf.SetFont("Arial", "B", 10)
	pdf.SetTextColor(colorSlate900[0], colorSlate900[1], colorSlate900[2])
	pdf.CellFormat(0, 6, g.utf8(value), "", 1, "L", false, 0, "")
}

// addTable adds a styled table
func (g *Generator) addTable(pdf *gofpdf.Fpdf, headers []string, widths []float64, data [][]string) {
	if len(data) == 0 {
		return
	}

	// Header
	pdf.SetFont("Arial", "B", 9)
	pdf.SetFillColor(colorSlate100[0], colorSlate100[1], colorSlate100[2])
	pdf.SetTextColor(colorSlate700[0], colorSlate700[1], colorSlate700[2])
	pdf.SetDrawColor(colorSlate200[0], colorSlate200[1], colorSlate200[2])
	pdf.SetLineWidth(0.3)

	for i, header := range headers {
		pdf.CellFormat(widths[i], 8, g.utf8(header), "1", 0, "C", true, 0, "")
	}
	pdf.Ln(-1)

	// Data rows
	pdf.SetFont("Arial", "", 9)
	pdf.SetTextColor(colorSlate700[0], colorSlate700[1], colorSlate700[2])

	for rowIdx, row := range data {
		// Alternate row colors
		if rowIdx%2 == 0 {
			pdf.SetFillColor(colorWhite[0], colorWhite[1], colorWhite[2])
		} else {
			pdf.SetFillColor(colorSlate50[0], colorSlate50[1], colorSlate50[2])
		}

		for i, cell := range row {
			if i < len(widths) {
				pdf.CellFormat(widths[i], 7, g.utf8(cell), "1", 0, "L", true, 0, "")
			}
		}
		pdf.Ln(-1)
	}
	pdf.Ln(5)
}

// addStatCard adds a statistics card with icon
func (g *Generator) addStatCard(pdf *gofpdf.Fpdf, label string, value string, color [3]int, x, y float64) {
	cardWidth := 42.0
	cardHeight := 28.0

	// Card shadow effect (subtle)
	pdf.SetFillColor(colorSlate200[0], colorSlate200[1], colorSlate200[2])
	pdf.RoundedRect(x+1, y+1, cardWidth, cardHeight, 3, "1234", "F")

	// Card background
	pdf.SetFillColor(colorWhite[0], colorWhite[1], colorWhite[2])
	pdf.SetDrawColor(colorSlate200[0], colorSlate200[1], colorSlate200[2])
	pdf.SetLineWidth(0.3)
	pdf.RoundedRect(x, y, cardWidth, cardHeight, 3, "1234", "FD")

	// Color accent bar on top
	pdf.SetFillColor(color[0], color[1], color[2])
	pdf.Rect(x, y, cardWidth, 3, "F")

	// Value
	pdf.SetXY(x, y+8)
	pdf.SetFont("Arial", "B", 18)
	pdf.SetTextColor(colorSlate900[0], colorSlate900[1], colorSlate900[2])
	pdf.CellFormat(cardWidth, 8, g.utf8(value), "", 0, "C", false, 0, "")

	// Label
	pdf.SetXY(x, y+18)
	pdf.SetFont("Arial", "", 8)
	pdf.SetTextColor(colorSlate500[0], colorSlate500[1], colorSlate500[2])
	pdf.CellFormat(cardWidth, 6, g.utf8(label), "", 0, "C", false, 0, "")
}

// addMetricBar adds a horizontal metric bar
func (g *Generator) addMetricBar(pdf *gofpdf.Fpdf, label string, value float64, x, y, width float64) {
	barHeight := 8.0

	// Label
	pdf.SetFont("Arial", "", 9)
	pdf.SetTextColor(colorSlate700[0], colorSlate700[1], colorSlate700[2])
	pdf.SetXY(x, y)
	pdf.CellFormat(50, barHeight, g.utf8(label), "", 0, "L", false, 0, "")

	// Background bar
	barX := x + 52
	barWidth := width - 75
	pdf.SetFillColor(colorSlate100[0], colorSlate100[1], colorSlate100[2])
	pdf.RoundedRect(barX, y+1, barWidth, barHeight-2, 1.5, "1234", "F")

	// Value bar with color based on percentage
	var color [3]int
	if value < 50 {
		color = colorGreen
	} else if value < 75 {
		color = colorAmber
	} else {
		color = colorRed
	}

	fillWidth := (value / 100) * barWidth
	if fillWidth > 0 {
		pdf.SetFillColor(color[0], color[1], color[2])
		pdf.RoundedRect(barX, y+1, fillWidth, barHeight-2, 1.5, "1234", "F")
	}

	// Value text
	pdf.SetFont("Arial", "B", 9)
	pdf.SetTextColor(color[0], color[1], color[2])
	pdf.SetXY(barX+barWidth+3, y)
	pdf.CellFormat(20, barHeight, fmt.Sprintf("%.1f%%", value), "", 0, "L", false, 0, "")
}

// addInfoBox adds an information box
func (g *Generator) addInfoBox(pdf *gofpdf.Fpdf, title, content string, color [3]int) {
	pageWidth, _ := pdf.GetPageSize()
	boxWidth := pageWidth - 30

	startY := pdf.GetY()

	// Box background
	pdf.SetFillColor(colorSlate50[0], colorSlate50[1], colorSlate50[2])
	pdf.SetDrawColor(color[0], color[1], color[2])
	pdf.SetLineWidth(0.5)

	// Calculate content height (use utf8 encoded content for accurate line count)
	pdf.SetFont("Arial", "", 10)
	encodedContent := g.utf8(content)
	contentLines := pdf.SplitLines([]byte(encodedContent), boxWidth-20)
	boxHeight := float64(len(contentLines))*5.5 + 25

	pdf.RoundedRect(15, startY, boxWidth, boxHeight, 3, "1234", "FD")

	// Left accent bar
	pdf.SetFillColor(color[0], color[1], color[2])
	pdf.Rect(15, startY, 4, boxHeight, "F")

	// Title
	pdf.SetXY(25, startY+5)
	pdf.SetFont("Arial", "B", 11)
	pdf.SetTextColor(color[0], color[1], color[2])
	pdf.CellFormat(0, 6, g.utf8(title), "", 1, "L", false, 0, "")

	// Content
	pdf.SetXY(25, startY+14)
	pdf.SetFont("Arial", "", 10)
	pdf.SetTextColor(colorSlate700[0], colorSlate700[1], colorSlate700[2])
	pdf.MultiCell(boxWidth-20, 5.5, encodedContent, "", "L", false)

	pdf.SetY(startY + boxHeight + 5)
}

// generateInfrastructureReport generates an infrastructure report
func (g *Generator) generateInfrastructureReport(ctx context.Context, pdf *gofpdf.Fpdf, report *ReportRecord) {
	log.Info().Int("conn_names_count", len(g.connNames)).Msg("Generating infrastructure report")

	metricsCollector := g.service.GetMetricsCollector()
	pve := g.service.GetProxmoxManager()

	allMetrics := metricsCollector.GetAllLatestMetrics()
	if len(allMetrics) == 0 {
		log.Info().Msg("No cached metrics available, fetching fresh data from Proxmox")
		allMetrics = g.fetchFreshMetrics(ctx, pve)
	}

	var totalNodes, totalVMs, runningVMs, totalStorage, usedStorage int64
	var avgCPU, avgMem float64
	var nodeCount int

	for _, m := range allMetrics {
		totalNodes += int64(m.Summary.TotalNodes)
		totalVMs += int64(m.Summary.TotalVMs)
		runningVMs += int64(m.Summary.RunningVMs)
		totalStorage += m.Summary.TotalStorage
		usedStorage += m.Summary.UsedStorage
		avgCPU += m.Summary.AvgCPUUsage
		avgMem += m.Summary.AvgMemoryUsage
		nodeCount++
	}

	if nodeCount > 0 {
		avgCPU /= float64(nodeCount)
		avgMem /= float64(nodeCount)
	}

	storageUtil := 0.0
	if totalStorage > 0 {
		storageUtil = float64(usedStorage) / float64(totalStorage) * 100
	}

	shouldInclude := func(section string) bool {
		if len(report.Sections) == 0 {
			return true
		}
		for _, s := range report.Sections {
			if s == section {
				return true
			}
		}
		return false
	}

	// Executive Summary
	if shouldInclude("summary") {
		pdf.AddPage()
		g.addSectionHeader(pdf, g.tr.ExecutiveSummary)

		// Stats cards row
		y := pdf.GetY() + 5
		g.addStatCard(pdf, g.tr.Clusters, fmt.Sprintf("%d", len(allMetrics)), colorBlue, 15, y)
		g.addStatCard(pdf, g.tr.Nodes, fmt.Sprintf("%d", totalNodes), colorGreen, 62, y)
		g.addStatCard(pdf, g.tr.TotalVMs, fmt.Sprintf("%d", totalVMs), colorPurple, 109, y)
		g.addStatCard(pdf, g.tr.RunningVMs, fmt.Sprintf("%d", runningVMs), colorOrange, 156, y)

		pdf.SetY(y + 40)

		// Summary paragraph
		g.addParagraph(pdf, fmt.Sprintf(g.tr.InfraReportIntro,
			report.DateFrom.Format("02/01/2006"),
			report.DateTo.Format("02/01/2006"),
			len(allMetrics), totalNodes, totalVMs, runningVMs,
		))

		pdf.Ln(5)

		// Resource utilization section
		g.addSubHeader(pdf, g.tr.ResourceUtilization)

		barY := pdf.GetY() + 3
		g.addMetricBar(pdf, g.tr.CPUUsage, avgCPU, 15, barY, 180)
		g.addMetricBar(pdf, g.tr.MemoryUsage, avgMem, 15, barY+14, 180)
		g.addMetricBar(pdf, g.tr.StorageUsage, storageUtil, 15, barY+28, 180)

		pdf.SetY(barY + 50)

		// Key metrics
		g.addSubHeader(pdf, g.tr.KeyMetrics)
		g.addKeyValue(pdf, g.tr.TotalStorageCapacity, formatBytes(totalStorage))
		g.addKeyValue(pdf, g.tr.UsedStorage, fmt.Sprintf("%s (%.1f%%)", formatBytes(usedStorage), storageUtil))
		g.addKeyValue(pdf, g.tr.AverageCPUUtilization, fmt.Sprintf("%.1f%%", avgCPU))
		g.addKeyValue(pdf, g.tr.AverageMemoryUtilization, fmt.Sprintf("%.1f%%", avgMem))

		// AI Analysis
		if g.aiAnalyzer != nil && g.aiAnalyzer.IsEnabled() {
			log.Info().Msg("Generating AI analysis for infrastructure report")

			aiData := map[string]interface{}{
				"clusters":         len(allMetrics),
				"total_nodes":      totalNodes,
				"total_vms":        totalVMs,
				"running_vms":      runningVMs,
				"avg_cpu_usage":    fmt.Sprintf("%.1f%%", avgCPU),
				"avg_memory_usage": fmt.Sprintf("%.1f%%", avgMem),
				"storage_util":     fmt.Sprintf("%.1f%%", storageUtil),
				"total_storage":    formatBytes(totalStorage),
			}

			analysis, err := g.aiAnalyzer.GenerateAnalysisWithLanguage(ctx, ReportTypeInfrastructure, aiData, g.lang)
			if err != nil {
				log.Warn().Err(err).Msg("Failed to generate AI analysis")
			} else if analysis != "" {
				log.Info().Int("length", len(analysis)).Msg("AI analysis generated")
				pdf.Ln(10)
				g.addInfoBox(pdf, g.tr.AIPoweredInsights, analysis, colorOrange)
			}
		}
	}

	// Clusters section
	if shouldInclude("clusters") && len(allMetrics) > 0 {
		pdf.AddPage()
		g.addSectionHeader(pdf, g.tr.ClustersOverview)

		clusterData := [][]string{}
		for connID, m := range allMetrics {
			clusterName := g.getConnectionName(connID)
			clusterData = append(clusterData, []string{
				clusterName,
				fmt.Sprintf("%d", m.Summary.TotalNodes),
				fmt.Sprintf("%d", m.Summary.TotalVMs),
				fmt.Sprintf("%d", m.Summary.RunningVMs),
				fmt.Sprintf("%.1f%%", m.Summary.AvgCPUUsage),
				fmt.Sprintf("%.1f%%", m.Summary.AvgMemoryUsage),
			})
		}

		g.addTable(pdf,
			[]string{g.tr.ClusterName, g.tr.Nodes, g.tr.TotalVMs, g.tr.Running, g.tr.CPU, g.tr.Memory},
			[]float64{50, 20, 25, 25, 25, 30},
			clusterData)

		// Per-cluster details
		for connID, m := range allMetrics {
			clusterName := g.getConnectionName(connID)
			pdf.Ln(5)
			g.addSubHeader(pdf, clusterName)

			barY := pdf.GetY()
			g.addMetricBar(pdf, g.tr.CPUUtilization, m.Summary.AvgCPUUsage, 15, barY, 180)
			g.addMetricBar(pdf, g.tr.MemoryUtilization, m.Summary.AvgMemoryUsage, 15, barY+12, 180)

			storageUsage := 0.0
			if m.Summary.TotalStorage > 0 {
				storageUsage = float64(m.Summary.UsedStorage) / float64(m.Summary.TotalStorage) * 100
			}
			g.addMetricBar(pdf, g.tr.StorageUsage, storageUsage, 15, barY+24, 180)

			pdf.SetY(barY + 40)
		}
	}

	// Nodes section
	if shouldInclude("nodes") {
		hasNodes := false
		for _, m := range allMetrics {
			if len(m.Nodes) > 0 {
				hasNodes = true
				break
			}
		}

		if hasNodes {
			pdf.AddPage()
			g.addSectionHeader(pdf, g.tr.NodesDetail)

			for connID, m := range allMetrics {
				if len(m.Nodes) == 0 {
					continue
				}

				clusterName := g.getConnectionName(connID)
				g.addSubHeader(pdf, fmt.Sprintf("%s (%d %s)", clusterName, len(m.Nodes), g.tr.Nodes))

				nodeData := [][]string{}
				for _, node := range m.Nodes {
					status := g.tr.Online
					if node.Status != "online" {
						status = g.tr.Offline
					}
					nodeData = append(nodeData, []string{
						node.Node,
						status,
						fmt.Sprintf("%d", node.CPUCores),
						fmt.Sprintf("%.1f%%", node.CPUUsage*100),
						formatBytes(node.MemoryTotal),
						fmt.Sprintf("%.1f%%", node.MemoryUsage*100),
					})
				}

				g.addTable(pdf,
					[]string{g.tr.Node, g.tr.Status, g.tr.Cores, g.tr.CPU, g.tr.Memory, g.tr.MemPct},
					[]float64{35, 22, 18, 22, 35, 22},
					nodeData)

				pdf.Ln(3)
			}
		}
	}

	// VMs section
	if shouldInclude("vms") {
		hasVMs := false
		for _, m := range allMetrics {
			if len(m.VMs) > 0 {
				hasVMs = true
				break
			}
		}

		if hasVMs {
			pdf.AddPage()
			g.addSectionHeader(pdf, g.tr.VirtualMachines)

			for connID, m := range allMetrics {
				if len(m.VMs) == 0 {
					continue
				}

				clusterName := g.getConnectionName(connID)

				// Sort VMs by CPU usage
				vms := make([]metrics.VMMetrics, len(m.VMs))
				copy(vms, m.VMs)
				sort.Slice(vms, func(i, j int) bool {
					return vms[i].CPUUsage > vms[j].CPUUsage
				})

				// Limit to top 15
				displayVMs := vms
				if len(displayVMs) > 15 {
					displayVMs = displayVMs[:15]
				}

				g.addSubHeader(pdf, fmt.Sprintf("%s (%d VMs)", clusterName, len(m.VMs)))

				if len(displayVMs) < len(vms) {
					pdf.SetFont("Arial", "I", 9)
					pdf.SetTextColor(colorSlate500[0], colorSlate500[1], colorSlate500[2])
					pdf.CellFormat(0, 5, fmt.Sprintf(g.tr.ShowingTopVMs, len(displayVMs)), "", 1, "L", false, 0, "")
					pdf.Ln(2)
				}

				vmData := [][]string{}
				for _, vm := range displayVMs {
					vmData = append(vmData, []string{
						vm.Name,
						vm.Node,
						vm.Status,
						fmt.Sprintf("%d", vm.CPUs),
						formatBytes(vm.MemoryTotal),
						fmt.Sprintf("%.1f%%", vm.CPUUsage*100),
					})
				}

				g.addTable(pdf,
					[]string{g.tr.VMName, g.tr.Node, g.tr.Status, g.tr.VCPUs, g.tr.Memory, g.tr.CPU},
					[]float64{45, 30, 22, 18, 30, 22},
					vmData)

				pdf.Ln(3)
			}
		}
	}

	// Storage section
	if shouldInclude("storage") {
		pdf.AddPage()
		g.addSectionHeader(pdf, g.tr.StorageOverview)

		clients := pve.GetAllClients()
		log.Debug().Int("clients_count", len(clients)).Msg("Fetching storage data for report")

		hasStorageData := false

		for connID, client := range clients {
			storages, err := client.GetStorages(ctx)
			if err != nil {
				log.Warn().Err(err).Str("connection", connID).Msg("Failed to get storages for report")
				continue
			}

			log.Debug().Str("connection", connID).Int("storages_count", len(storages)).Msg("Got storages")

			if len(storages) == 0 {
				continue
			}

			clusterName := g.getConnectionName(connID)
			g.addSubHeader(pdf, clusterName)

			storageData := [][]string{}
			for _, storage := range storages {
				if storage.Total == 0 {
					continue
				}
				usage := float64(storage.Used) / float64(storage.Total) * 100
				storageData = append(storageData, []string{
					storage.Storage,
					storage.Type,
					formatBytes(storage.Total),
					formatBytes(storage.Used),
					formatBytes(storage.Total - storage.Used),
					fmt.Sprintf("%.1f%%", usage),
				})
			}

			if len(storageData) > 0 {
				hasStorageData = true
				g.addTable(pdf,
					[]string{g.tr.Storage, g.tr.Type, g.tr.Total, g.tr.Used, g.tr.Free, g.tr.Usage},
					[]float64{35, 25, 28, 28, 28, 22},
					storageData)
			}

			pdf.Ln(3)
		}

		// If no storage data from clients, show summary from metrics
		if !hasStorageData && len(allMetrics) > 0 {
			log.Info().Msg("No detailed storage data available, showing summary from metrics")

			storageData := [][]string{}
			for connID, m := range allMetrics {
				if m.Summary.TotalStorage > 0 {
					clusterName := g.getConnectionName(connID)
					usage := float64(m.Summary.UsedStorage) / float64(m.Summary.TotalStorage) * 100
					storageData = append(storageData, []string{
						clusterName,
						g.tr.ClusterTotal,
						formatBytes(m.Summary.TotalStorage),
						formatBytes(m.Summary.UsedStorage),
						formatBytes(m.Summary.TotalStorage - m.Summary.UsedStorage),
						fmt.Sprintf("%.1f%%", usage),
					})
				}
			}

			if len(storageData) > 0 {
				g.addTable(pdf,
					[]string{g.tr.ClusterName, g.tr.Type, g.tr.Total, g.tr.Used, g.tr.Free, g.tr.Usage},
					[]float64{50, 25, 28, 28, 28, 22},
					storageData)
			} else {
				g.addParagraph(pdf, g.tr.NoStorageData)
			}
		}
	}
}

// generateAlertsReport generates an alerts report
func (g *Generator) generateAlertsReport(ctx context.Context, pdf *gofpdf.Fpdf, report *ReportRecord) {
	alertsService := g.service.GetAlertsService()

	activeAlerts, _ := alertsService.GetActiveAlerts("")
	allAlerts, _, _ := alertsService.GetAllAlerts("", "", 1000, 0)

	criticalCount := 0
	warningCount := 0
	infoCount := 0
	for _, alert := range activeAlerts {
		switch string(alert.Severity) {
		case "critical":
			criticalCount++
		case "warning":
			warningCount++
		default:
			infoCount++
		}
	}

	shouldInclude := func(section string) bool {
		if len(report.Sections) == 0 {
			return true
		}
		for _, s := range report.Sections {
			if s == section {
				return true
			}
		}
		return false
	}

	// Summary
	if shouldInclude("summary") {
		pdf.AddPage()
		g.addSectionHeader(pdf, g.tr.AlertsSummary)

		y := pdf.GetY() + 5
		g.addStatCard(pdf, g.tr.ActiveAlerts, fmt.Sprintf("%d", len(activeAlerts)), colorRed, 15, y)
		g.addStatCard(pdf, g.tr.Critical, fmt.Sprintf("%d", criticalCount), [3]int{220, 38, 38}, 62, y)
		g.addStatCard(pdf, g.tr.Warning, fmt.Sprintf("%d", warningCount), colorAmber, 109, y)
		g.addStatCard(pdf, g.tr.Info, fmt.Sprintf("%d", infoCount), colorBlue, 156, y)

		pdf.SetY(y + 40)

		g.addParagraph(pdf, fmt.Sprintf(g.tr.AlertsReportIntro,
			report.DateFrom.Format("02/01/2006"),
			report.DateTo.Format("02/01/2006"),
			len(activeAlerts), criticalCount, warningCount,
		))

		// AI Analysis
		if g.aiAnalyzer != nil && g.aiAnalyzer.IsEnabled() {
			aiData := map[string]interface{}{
				"active_alerts":  len(activeAlerts),
				"critical_count": criticalCount,
				"warning_count":  warningCount,
				"info_count":     infoCount,
				"total_alerts":   len(allAlerts),
			}

			analysis, err := g.aiAnalyzer.GenerateAnalysisWithLanguage(ctx, ReportTypeAlerts, aiData, g.lang)
			if err == nil && analysis != "" {
				pdf.Ln(10)
				g.addInfoBox(pdf, g.tr.AIPoweredInsights, analysis, colorOrange)
			}
		}
	}

	// Active alerts
	if shouldInclude("active") && len(activeAlerts) > 0 {
		pdf.AddPage()
		g.addSectionHeader(pdf, g.tr.ActiveAlerts)

		alertData := [][]string{}
		for _, alert := range activeAlerts {
			alertData = append(alertData, []string{
				string(alert.Severity),
				alert.Resource,
				truncateString(alert.Message, 45),
				fmt.Sprintf("%d", alert.Occurrences),
			})
		}

		g.addTable(pdf,
			[]string{g.tr.Severity, g.tr.Resource, g.tr.Message, g.tr.Count},
			[]float64{25, 40, 90, 20},
			alertData)
	}

	// History
	if shouldInclude("history") && len(allAlerts) > 0 {
		pdf.AddPage()
		g.addSectionHeader(pdf, g.tr.AlertHistory)

		historyAlerts := allAlerts
		if len(historyAlerts) > 30 {
			historyAlerts = historyAlerts[:30]
			pdf.SetFont("Arial", "I", 9)
			pdf.SetTextColor(colorSlate500[0], colorSlate500[1], colorSlate500[2])
			pdf.CellFormat(0, 5, fmt.Sprintf(g.tr.ShowingRecentAlerts, 30, len(allAlerts)), "", 1, "L", false, 0, "")
			pdf.Ln(3)
		}

		alertData := [][]string{}
		for _, alert := range historyAlerts {
			alertData = append(alertData, []string{
				string(alert.Severity),
				string(alert.Status),
				alert.Resource,
				truncateString(alert.Message, 40),
			})
		}

		g.addTable(pdf,
			[]string{g.tr.Severity, g.tr.Status, g.tr.Resource, g.tr.Message},
			[]float64{25, 25, 40, 85},
			alertData)
	}
}

// generateUtilizationReport generates a utilization report
func (g *Generator) generateUtilizationReport(ctx context.Context, pdf *gofpdf.Fpdf, report *ReportRecord) {
	metricsCollector := g.service.GetMetricsCollector()
	pve := g.service.GetProxmoxManager()

	allMetrics := metricsCollector.GetAllLatestMetrics()
	if len(allMetrics) == 0 {
		allMetrics = g.fetchFreshMetrics(ctx, pve)
	}

	var totalCPU, totalMem, totalStorage float64
	var count int

	for _, m := range allMetrics {
		totalCPU += m.Summary.AvgCPUUsage
		totalMem += m.Summary.AvgMemoryUsage
		if m.Summary.TotalStorage > 0 {
			totalStorage += float64(m.Summary.UsedStorage) / float64(m.Summary.TotalStorage) * 100
		}
		count++
	}

	avgCPU := totalCPU / float64(count+1)
	avgMem := totalMem / float64(count+1)
	avgStorage := totalStorage / float64(count+1)

	shouldInclude := func(section string) bool {
		if len(report.Sections) == 0 {
			return true
		}
		for _, s := range report.Sections {
			if s == section {
				return true
			}
		}
		return false
	}

	// Summary
	if shouldInclude("summary") {
		pdf.AddPage()
		g.addSectionHeader(pdf, g.tr.UtilizationSummary)

		y := pdf.GetY() + 5
		g.addStatCard(pdf, g.tr.AvgCPU, fmt.Sprintf("%.0f%%", avgCPU), colorBlue, 15, y)
		g.addStatCard(pdf, g.tr.AvgMemory, fmt.Sprintf("%.0f%%", avgMem), colorGreen, 62, y)
		g.addStatCard(pdf, g.tr.AvgStorage, fmt.Sprintf("%.0f%%", avgStorage), colorPurple, 109, y)
		g.addStatCard(pdf, g.tr.Clusters, fmt.Sprintf("%d", len(allMetrics)), colorOrange, 156, y)

		pdf.SetY(y + 40)

		g.addParagraph(pdf, fmt.Sprintf(g.tr.UtilizationReportIntro,
			report.DateFrom.Format("02/01/2006"),
			report.DateTo.Format("02/01/2006"),
			avgCPU, avgMem, avgStorage,
		))

		// AI Analysis
		if g.aiAnalyzer != nil && g.aiAnalyzer.IsEnabled() {
			aiData := map[string]interface{}{
				"avg_cpu":     avgCPU,
				"avg_memory":  avgMem,
				"avg_storage": avgStorage,
				"clusters":    len(allMetrics),
			}

			analysis, err := g.aiAnalyzer.GenerateAnalysisWithLanguage(ctx, ReportTypeUtilization, aiData, g.lang)
			if err == nil && analysis != "" {
				pdf.Ln(10)
				g.addInfoBox(pdf, g.tr.AIPoweredInsights, analysis, colorOrange)
			}
		}
	}

	// CPU section
	if shouldInclude("cpu") {
		hasNodes := false
		for _, m := range allMetrics {
			if len(m.Nodes) > 0 {
				hasNodes = true
				break
			}
		}

		if hasNodes {
			pdf.AddPage()
			g.addSectionHeader(pdf, g.tr.CPUUtilization)

			for connID, m := range allMetrics {
				if len(m.Nodes) == 0 {
					continue
				}

				clusterName := g.getConnectionName(connID)
				g.addSubHeader(pdf, clusterName)

				for _, node := range m.Nodes {
					cpuPct := node.CPUUsage * 100
					g.addMetricBar(pdf, node.Node, cpuPct, 15, pdf.GetY(), 180)
					pdf.SetY(pdf.GetY() + 12)
				}
				pdf.Ln(5)
			}
		}
	}

	// Memory section
	if shouldInclude("memory") {
		hasNodes := false
		for _, m := range allMetrics {
			if len(m.Nodes) > 0 {
				hasNodes = true
				break
			}
		}

		if hasNodes {
			pdf.AddPage()
			g.addSectionHeader(pdf, g.tr.MemoryUtilization)

			for connID, m := range allMetrics {
				if len(m.Nodes) == 0 {
					continue
				}

				clusterName := g.getConnectionName(connID)
				g.addSubHeader(pdf, clusterName)

				for _, node := range m.Nodes {
					memPct := node.MemoryUsage * 100
					label := fmt.Sprintf("%s (%s)", node.Node, formatBytes(node.MemoryTotal))
					g.addMetricBar(pdf, label, memPct, 15, pdf.GetY(), 180)
					pdf.SetY(pdf.GetY() + 12)
				}
				pdf.Ln(5)
			}
		}
	}
}

// generateInventoryReport generates an inventory report
func (g *Generator) generateInventoryReport(ctx context.Context, pdf *gofpdf.Fpdf, report *ReportRecord) {
	metricsCollector := g.service.GetMetricsCollector()
	pve := g.service.GetProxmoxManager()

	allMetrics := metricsCollector.GetAllLatestMetrics()
	if len(allMetrics) == 0 {
		allMetrics = g.fetchFreshMetrics(ctx, pve)
	}

	var totalVMs, runningVMs, stoppedVMs int

	for _, m := range allMetrics {
		totalVMs += len(m.VMs)
		for _, vm := range m.VMs {
			if vm.Status == "running" {
				runningVMs++
			} else {
				stoppedVMs++
			}
		}
	}

	shouldInclude := func(section string) bool {
		if len(report.Sections) == 0 {
			return true
		}
		for _, s := range report.Sections {
			if s == section {
				return true
			}
		}
		return false
	}

	// Summary
	if shouldInclude("summary") {
		pdf.AddPage()
		g.addSectionHeader(pdf, g.tr.InventorySummary)

		y := pdf.GetY() + 5
		g.addStatCard(pdf, g.tr.TotalVMs, fmt.Sprintf("%d", totalVMs), colorBlue, 15, y)
		g.addStatCard(pdf, g.tr.Running, fmt.Sprintf("%d", runningVMs), colorGreen, 62, y)
		g.addStatCard(pdf, g.tr.Stopped, fmt.Sprintf("%d", stoppedVMs), colorAmber, 109, y)
		g.addStatCard(pdf, g.tr.Clusters, fmt.Sprintf("%d", len(allMetrics)), colorPurple, 156, y)

		pdf.SetY(y + 40)

		g.addParagraph(pdf, fmt.Sprintf(g.tr.InventoryReportIntro,
			time.Now().Format("02/01/2006"),
			totalVMs, len(allMetrics), runningVMs, stoppedVMs,
		))
	}

	// VMs
	if shouldInclude("vms") {
		hasVMs := false
		for _, m := range allMetrics {
			if len(m.VMs) > 0 {
				hasVMs = true
				break
			}
		}

		if hasVMs {
			pdf.AddPage()
			g.addSectionHeader(pdf, g.tr.VMInventory)

			for connID, m := range allMetrics {
				if len(m.VMs) == 0 {
					continue
				}

				clusterName := g.getConnectionName(connID)
				g.addSubHeader(pdf, fmt.Sprintf("%s (%d VMs)", clusterName, len(m.VMs)))

				vmData := [][]string{}
				for _, vm := range m.VMs {
					vmData = append(vmData, []string{
						fmt.Sprintf("%d", vm.VMID),
						vm.Name,
						vm.Node,
						vm.Status,
						fmt.Sprintf("%d", vm.CPUs),
						formatBytes(vm.MemoryTotal),
					})
				}

				g.addTable(pdf,
					[]string{g.tr.VMID, g.tr.VMName, g.tr.Node, g.tr.Status, g.tr.VCPUs, g.tr.Memory},
					[]float64{18, 48, 32, 22, 18, 30},
					vmData)

				pdf.Ln(5)
			}
		}
	}

	// Specs summary
	if shouldInclude("specs") {
		var totalCPUs int
		var totalMemory int64

		for _, m := range allMetrics {
			for _, vm := range m.VMs {
				totalCPUs += vm.CPUs
				totalMemory += vm.MemoryTotal
			}
		}

		if totalVMs > 0 {
			pdf.AddPage()
			g.addSectionHeader(pdf, g.tr.HardwareSpecsSummary)

			g.addKeyValue(pdf, g.tr.TotalAllocatedVCPUs, fmt.Sprintf("%d", totalCPUs))
			g.addKeyValue(pdf, g.tr.TotalAllocatedMemory, formatBytes(totalMemory))
			g.addKeyValue(pdf, g.tr.AverageVCPUsPerVM, fmt.Sprintf("%.1f", float64(totalCPUs)/float64(totalVMs)))
			g.addKeyValue(pdf, g.tr.AverageMemoryPerVM, formatBytes(totalMemory/int64(totalVMs)))
		}
	}
}

// generateCapacityReport generates a capacity planning report
func (g *Generator) generateCapacityReport(ctx context.Context, pdf *gofpdf.Fpdf, report *ReportRecord) {
	metricsCollector := g.service.GetMetricsCollector()
	pve := g.service.GetProxmoxManager()

	allMetrics := metricsCollector.GetAllLatestMetrics()
	if len(allMetrics) == 0 {
		allMetrics = g.fetchFreshMetrics(ctx, pve)
	}

	shouldInclude := func(section string) bool {
		if len(report.Sections) == 0 {
			return true
		}
		for _, s := range report.Sections {
			if s == section {
				return true
			}
		}
		return false
	}

	// Summary
	if shouldInclude("summary") {
		pdf.AddPage()
		g.addSectionHeader(pdf, g.tr.CapacityPlanningSummary)

		g.addParagraph(pdf, fmt.Sprintf(g.tr.CapacityReportIntro,
			report.DateFrom.Format("02/01/2006"),
			report.DateTo.Format("02/01/2006"),
		))

		// AI Analysis
		if g.aiAnalyzer != nil && g.aiAnalyzer.IsEnabled() {
			clusterList := []map[string]interface{}{}
			for connID, m := range allMetrics {
				storageUsage := 0.0
				if m.Summary.TotalStorage > 0 {
					storageUsage = float64(m.Summary.UsedStorage) / float64(m.Summary.TotalStorage) * 100
				}
				clusterList = append(clusterList, map[string]interface{}{
					"name":          g.getConnectionName(connID),
					"cpu_usage":     m.Summary.AvgCPUUsage,
					"memory_usage":  m.Summary.AvgMemoryUsage,
					"storage_usage": storageUsage,
					"nodes":         m.Summary.TotalNodes,
					"vms":           m.Summary.TotalVMs,
				})
			}

			analysis, err := g.aiAnalyzer.GenerateAnalysisWithLanguage(ctx, ReportTypeCapacity, map[string]interface{}{"clusters": clusterList}, g.lang)
			if err == nil && analysis != "" {
				pdf.Ln(5)
				g.addInfoBox(pdf, g.tr.AIPoweredCapacityAnalysis, analysis, colorOrange)
			}
		}
	}

	// Current capacity
	if shouldInclude("current") && len(allMetrics) > 0 {
		pdf.AddPage()
		g.addSectionHeader(pdf, g.tr.CurrentCapacity)

		for connID, m := range allMetrics {
			clusterName := g.getConnectionName(connID)
			g.addSubHeader(pdf, clusterName)

			g.addKeyValue(pdf, g.tr.TotalNodes, fmt.Sprintf("%d", m.Summary.TotalNodes))
			g.addKeyValue(pdf, g.tr.TotalCPUCores, fmt.Sprintf("%d", m.Summary.TotalCPUCores))
			g.addKeyValue(pdf, g.tr.TotalMemory, formatBytes(m.Summary.TotalMemory))
			g.addKeyValue(pdf, g.tr.TotalStorage, formatBytes(m.Summary.TotalStorage))

			pdf.Ln(5)

			// Resource bars
			g.addMetricBar(pdf, g.tr.CPUUsage, m.Summary.AvgCPUUsage, 15, pdf.GetY(), 180)
			pdf.SetY(pdf.GetY() + 12)
			g.addMetricBar(pdf, g.tr.MemoryUsage, m.Summary.AvgMemoryUsage, 15, pdf.GetY(), 180)
			pdf.SetY(pdf.GetY() + 12)

			storageUsage := 0.0
			if m.Summary.TotalStorage > 0 {
				storageUsage = float64(m.Summary.UsedStorage) / float64(m.Summary.TotalStorage) * 100
			}
			g.addMetricBar(pdf, g.tr.StorageUsage, storageUsage, 15, pdf.GetY(), 180)

			pdf.Ln(20)
		}
	}

	// Recommendations
	if shouldInclude("recommendations") {
		recommendations := []string{}

		for connID, m := range allMetrics {
			clusterName := g.getConnectionName(connID)

			if m.Summary.AvgCPUUsage > 80 {
				recommendations = append(recommendations, fmt.Sprintf(g.tr.HighCPURecommendation, clusterName, m.Summary.AvgCPUUsage))
			}
			if m.Summary.AvgMemoryUsage > 85 {
				recommendations = append(recommendations, fmt.Sprintf(g.tr.HighMemoryRecommendation, clusterName, m.Summary.AvgMemoryUsage))
			}
			storageUsage := 0.0
			if m.Summary.TotalStorage > 0 {
				storageUsage = float64(m.Summary.UsedStorage) / float64(m.Summary.TotalStorage) * 100
			}
			if storageUsage > 80 {
				recommendations = append(recommendations, fmt.Sprintf(g.tr.HighStorageRecommendation, clusterName, storageUsage))
			}
			if m.Summary.AvgCPUUsage < 30 && m.Summary.AvgMemoryUsage < 30 {
				recommendations = append(recommendations, fmt.Sprintf(g.tr.LowUtilRecommendation, clusterName))
			}
		}

		if len(recommendations) > 0 {
			pdf.AddPage()
			g.addSectionHeader(pdf, g.tr.Recommendations)

			for _, rec := range recommendations {
				g.addParagraph(pdf, "• "+rec)
			}
		}
	}
}

// fetchFreshMetrics fetches current metrics directly from Proxmox
func (g *Generator) fetchFreshMetrics(ctx context.Context, pve *proxmox.Manager) map[string]*metrics.ClusterMetrics {
	result := make(map[string]*metrics.ClusterMetrics)
	clients := pve.GetAllClients()

	for connID, client := range clients {
		cm := &metrics.ClusterMetrics{
			ConnectionID: connID,
			CollectedAt:  time.Now(),
			Nodes:        []metrics.NodeMetrics{},
			VMs:          []metrics.VMMetrics{},
		}

		nodes, err := client.GetNodes(ctx)
		if err != nil {
			log.Warn().Err(err).Str("connection", connID).Msg("Failed to get nodes for report")
			continue
		}

		var totalCPU, totalMem float64
		var totalMemBytes, usedMemBytes int64
		var totalStorageBytes, usedStorageBytes int64

		for _, node := range nodes {
			status := "online"
			if node.Status != "online" {
				status = "offline"
			}

			nm := metrics.NodeMetrics{
				Node:        node.Node,
				Status:      status,
				CPUUsage:    node.CPU,
				CPUCores:    node.MaxCPU,
				MemoryUsed:  node.Mem,
				MemoryTotal: node.MaxMem,
				MemoryUsage: float64(node.Mem) / float64(node.MaxMem),
				DiskUsed:    node.Disk,
				DiskTotal:   node.MaxDisk,
				Uptime:      node.Uptime,
			}
			if node.MaxDisk > 0 {
				nm.DiskUsage = float64(node.Disk) / float64(node.MaxDisk)
			}

			cm.Nodes = append(cm.Nodes, nm)

			if status == "online" {
				cm.Summary.OnlineNodes++
				totalCPU += node.CPU
				totalMem += nm.MemoryUsage
				totalMemBytes += node.MaxMem
				usedMemBytes += node.Mem
				totalStorageBytes += node.MaxDisk
				usedStorageBytes += node.Disk
			}
		}

		cm.Summary.TotalNodes = len(nodes)
		if cm.Summary.OnlineNodes > 0 {
			cm.Summary.AvgCPUUsage = totalCPU / float64(cm.Summary.OnlineNodes) * 100
			cm.Summary.AvgMemoryUsage = totalMem / float64(cm.Summary.OnlineNodes) * 100
		}
		cm.Summary.TotalMemory = totalMemBytes
		cm.Summary.UsedMemory = usedMemBytes
		cm.Summary.TotalStorage = totalStorageBytes
		cm.Summary.UsedStorage = usedStorageBytes

		vms, err := client.GetVMs(ctx)
		if err != nil {
			log.Warn().Err(err).Str("connection", connID).Msg("Failed to get VMs for report")
		} else {
			for _, vm := range vms {
				vmm := metrics.VMMetrics{
					VMID:        vm.VMID,
					Name:        vm.Name,
					Node:        vm.Node,
					Status:      vm.Status,
					CPUUsage:    vm.CPU,
					CPUs:        vm.CPUs,
					MemoryUsed:  vm.Mem,
					MemoryTotal: vm.MaxMem,
				}
				if vm.MaxMem > 0 {
					vmm.MemoryUsage = float64(vm.Mem) / float64(vm.MaxMem)
				}
				cm.VMs = append(cm.VMs, vmm)

				if vm.Status == "running" {
					cm.Summary.RunningVMs++
				}
			}
			cm.Summary.TotalVMs = len(vms)
		}

		result[connID] = cm
	}

	return result
}

// Helper functions

// utf8ToCp1252 converts a UTF-8 string to cp1252 (Windows-1252) encoding
// This is needed for proper display of French accented characters in PDF
func utf8ToCp1252(s string) string {
	// cp1252 character map for common accented characters
	// Using Unicode code points to avoid Go syntax issues with some characters
	replacements := map[rune]byte{
		0x20AC: 0x80, // €
		0x201A: 0x82, // ‚
		0x0192: 0x83, // ƒ
		0x201E: 0x84, // „
		0x2026: 0x85, // …
		0x2020: 0x86, // †
		0x2021: 0x87, // ‡
		0x02C6: 0x88, // ˆ
		0x2030: 0x89, // ‰
		0x0160: 0x8A, // Š
		0x2039: 0x8B, // ‹
		0x0152: 0x8C, // Œ
		0x017D: 0x8E, // Ž
		0x2018: 0x91, // '
		0x2019: 0x92, // '
		0x201C: 0x93, // "
		0x201D: 0x94, // "
		0x2022: 0x95, // •
		0x2013: 0x96, // –
		0x2014: 0x97, // —
		0x02DC: 0x98, // ˜
		0x2122: 0x99, // ™
		0x0161: 0x9A, // š
		0x203A: 0x9B, // ›
		0x0153: 0x9C, // œ
		0x017E: 0x9E, // ž
		0x0178: 0x9F, // Ÿ
	}

	result := make([]byte, 0, len(s))
	for _, r := range s {
		if r < 128 {
			// ASCII character, pass through
			result = append(result, byte(r))
		} else if r >= 0xA0 && r <= 0xFF {
			// Latin-1 supplement (same in cp1252)
			result = append(result, byte(r))
		} else if b, ok := replacements[r]; ok {
			// Known cp1252-specific replacement
			result = append(result, b)
		} else {
			// Unknown character, use '?' as fallback
			result = append(result, '?')
		}
	}
	return string(result)
}

func formatBytes(bytes int64) string {
	const unit = 1024
	if bytes < unit {
		return fmt.Sprintf("%d B", bytes)
	}
	div, exp := int64(unit), 0
	for n := bytes / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(bytes)/float64(div), "KMGTPE"[exp])
}

func truncateString(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen-3] + "..."
}
