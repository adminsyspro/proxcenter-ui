package reports

import (
	"fmt"
	"math"

	"github.com/jung-kurt/gofpdf"
	"github.com/rs/zerolog/log"
)

// ChartColors defines common colors for charts
var ChartColors = [][]int{
	{59, 130, 246},  // Blue
	{16, 185, 129},  // Green
	{139, 92, 246},  // Purple
	{245, 158, 11},  // Amber
	{239, 68, 68},   // Red
	{236, 72, 153},  // Pink
	{20, 184, 166},  // Teal
	{249, 115, 22},  // Orange
}

// DrawBarChart draws a horizontal bar chart
func DrawBarChart(pdf *gofpdf.Fpdf, title string, data []BarChartData, x, y, width, height float64) {
	if len(data) == 0 {
		return
	}

	// Title
	pdf.SetFont("Arial", "B", 10)
	pdf.SetTextColor(51, 65, 85)
	pdf.SetXY(x, y)
	pdf.CellFormat(width, 8, title, "", 0, "C", false, 0, "")
	y += 10

	// Find max value
	maxVal := 0.0
	for _, d := range data {
		if d.Value > maxVal {
			maxVal = d.Value
		}
	}
	if maxVal == 0 {
		maxVal = 100
	}

	// Calculate bar dimensions
	barHeight := (height - 20) / float64(len(data))
	if barHeight > 20 {
		barHeight = 20
	}
	barMaxWidth := width * 0.6
	labelWidth := width * 0.25
	valueWidth := width * 0.15

	for i, d := range data {
		barY := y + float64(i)*barHeight

		// Label
		pdf.SetFont("Arial", "", 8)
		pdf.SetTextColor(71, 85, 105)
		pdf.SetXY(x, barY)
		label := truncateString(d.Label, 20)
		pdf.CellFormat(labelWidth, barHeight, label, "", 0, "R", false, 0, "")

		// Bar background
		pdf.SetFillColor(241, 245, 249) // Slate-100
		barX := x + labelWidth + 2
		pdf.Rect(barX, barY+2, barMaxWidth, barHeight-4, "F")

		// Bar fill
		barWidth := (d.Value / maxVal) * barMaxWidth
		if barWidth < 2 {
			barWidth = 2
		}
		colorIdx := i % len(ChartColors)
		pdf.SetFillColor(ChartColors[colorIdx][0], ChartColors[colorIdx][1], ChartColors[colorIdx][2])
		pdf.Rect(barX, barY+2, barWidth, barHeight-4, "F")

		// Value
		pdf.SetFont("Arial", "B", 8)
		pdf.SetTextColor(51, 65, 85)
		pdf.SetXY(x+labelWidth+barMaxWidth+4, barY)
		valueStr := fmt.Sprintf("%.1f%%", d.Value)
		if d.ValueSuffix != "" {
			valueStr = fmt.Sprintf("%.1f%s", d.Value, d.ValueSuffix)
		}
		pdf.CellFormat(valueWidth, barHeight, valueStr, "", 0, "L", false, 0, "")
	}
}

// BarChartData represents data for a bar chart
type BarChartData struct {
	Label       string
	Value       float64
	ValueSuffix string
}

// DrawPieChart draws a simple pie chart
func DrawPieChart(pdf *gofpdf.Fpdf, title string, data []PieChartData, x, y, radius float64) {
	if len(data) == 0 {
		return
	}

	// Title
	pdf.SetFont("Arial", "B", 10)
	pdf.SetTextColor(51, 65, 85)
	titleWidth := 100.0
	pdf.SetXY(x+radius-titleWidth/2, y-radius-12)
	pdf.CellFormat(titleWidth, 8, title, "", 0, "C", false, 0, "")

	// Calculate total
	total := 0.0
	for _, d := range data {
		total += d.Value
	}
	if total == 0 {
		total = 1
	}

	// Center of pie
	centerX := x + radius
	centerY := y

	// Draw pie segments
	startAngle := -90.0 // Start from top

	for i, d := range data {
		if d.Value <= 0 {
			continue
		}

		percentage := d.Value / total
		sweepAngle := percentage * 360

		colorIdx := i % len(ChartColors)
		pdf.SetFillColor(ChartColors[colorIdx][0], ChartColors[colorIdx][1], ChartColors[colorIdx][2])

		// Draw arc segment using polygon approximation
		drawPieSegment(pdf, centerX, centerY, radius, startAngle, startAngle+sweepAngle)

		startAngle += sweepAngle
	}

	// Draw legend
	legendX := x + radius*2 + 10
	legendY := y - radius + 5

	for i, d := range data {
		if d.Value <= 0 {
			continue
		}

		percentage := d.Value / total * 100

		// Color box
		colorIdx := i % len(ChartColors)
		pdf.SetFillColor(ChartColors[colorIdx][0], ChartColors[colorIdx][1], ChartColors[colorIdx][2])
		pdf.Rect(legendX, legendY, 8, 8, "F")

		// Label
		pdf.SetFont("Arial", "", 8)
		pdf.SetTextColor(71, 85, 105)
		pdf.SetXY(legendX+10, legendY)
		label := fmt.Sprintf("%s (%.0f%%)", d.Label, percentage)
		pdf.CellFormat(60, 8, label, "", 0, "L", false, 0, "")

		legendY += 12
	}
}

// PieChartData represents data for a pie chart
type PieChartData struct {
	Label string
	Value float64
}

// drawPieSegment draws a pie segment using polygon approximation
func drawPieSegment(pdf *gofpdf.Fpdf, cx, cy, radius, startAngle, endAngle float64) {
	// Convert angles to radians
	startRad := startAngle * math.Pi / 180
	endRad := endAngle * math.Pi / 180

	// Create polygon points
	points := []gofpdf.PointType{{X: cx, Y: cy}}

	// Add arc points
	steps := 20
	for i := 0; i <= steps; i++ {
		angle := startRad + (endRad-startRad)*float64(i)/float64(steps)
		x := cx + radius*math.Cos(angle)
		y := cy + radius*math.Sin(angle)
		points = append(points, gofpdf.PointType{X: x, Y: y})
	}

	// Draw filled polygon
	pdf.Polygon(points, "F")
}

// DrawGaugeChart draws a semicircular gauge chart
func DrawGaugeChart(pdf *gofpdf.Fpdf, title string, value float64, x, y, radius float64) {
	log.Debug().
		Str("title", title).
		Float64("value", value).
		Float64("x", x).
		Float64("y", y).
		Float64("radius", radius).
		Msg("Drawing gauge chart")

	// Title
	pdf.SetFont("Arial", "B", 10)
	pdf.SetTextColor(51, 65, 85)
	titleY := y - 5
	if titleY < 10 {
		titleY = 10
	}
	pdf.SetXY(x, titleY)
	pdf.CellFormat(radius*2, 8, title, "", 0, "C", false, 0, "")

	// Draw as a simple bar chart instead of arc (more reliable rendering)
	barWidth := radius * 2
	barHeight := 12.0
	barY := y + 10

	// Background bar (gray)
	pdf.SetFillColor(226, 232, 240) // Slate-200
	pdf.Rect(x, barY, barWidth, barHeight, "F")

	// Value bar (colored based on value)
	var r, g, b int
	if value < 50 {
		r, g, b = 16, 185, 129 // Green
	} else if value < 75 {
		r, g, b = 245, 158, 11 // Amber
	} else {
		r, g, b = 239, 68, 68 // Red
	}
	pdf.SetFillColor(r, g, b)

	// Calculate width based on value (0-100)
	fillWidth := (value / 100) * barWidth
	if fillWidth > barWidth {
		fillWidth = barWidth
	}
	if fillWidth > 0 {
		pdf.Rect(x, barY, fillWidth, barHeight, "F")
	}

	// Value text below bar
	pdf.SetFont("Arial", "B", 14)
	pdf.SetTextColor(r, g, b)
	pdf.SetXY(x, barY+barHeight+2)
	pdf.CellFormat(barWidth, 10, fmt.Sprintf("%.0f%%", value), "", 0, "C", false, 0, "")
}

// drawArc draws a filled arc
func drawArc(pdf *gofpdf.Fpdf, cx, cy, radius, startAngle, endAngle float64) {
	startRad := startAngle * math.Pi / 180
	endRad := endAngle * math.Pi / 180

	points := []gofpdf.PointType{{X: cx, Y: cy}}

	steps := 30
	for i := 0; i <= steps; i++ {
		angle := startRad + (endRad-startRad)*float64(i)/float64(steps)
		x := cx + radius*math.Cos(angle)
		y := cy + radius*math.Sin(angle)
		points = append(points, gofpdf.PointType{X: x, Y: y})
	}

	pdf.Polygon(points, "F")
}

// DrawMiniBarChart draws a small inline bar chart (for tables)
func DrawMiniBarChart(pdf *gofpdf.Fpdf, value float64, x, y, width, height float64) {
	// Background
	pdf.SetFillColor(226, 232, 240) // Slate-200
	pdf.Rect(x, y, width, height, "F")

	// Value bar
	var r, g, b int
	if value < 50 {
		r, g, b = 16, 185, 129 // Green
	} else if value < 75 {
		r, g, b = 59, 130, 246 // Blue
	} else if value < 90 {
		r, g, b = 245, 158, 11 // Amber
	} else {
		r, g, b = 239, 68, 68 // Red
	}
	pdf.SetFillColor(r, g, b)

	barWidth := (value / 100) * width
	if barWidth > width {
		barWidth = width
	}
	pdf.Rect(x, y, barWidth, height, "F")
}

// DrawStackedBarChart draws a stacked horizontal bar chart
func DrawStackedBarChart(pdf *gofpdf.Fpdf, title string, data []StackedBarData, x, y, width, height float64) {
	if len(data) == 0 {
		return
	}

	// Title
	pdf.SetFont("Arial", "B", 10)
	pdf.SetTextColor(51, 65, 85)
	pdf.SetXY(x, y)
	pdf.CellFormat(width, 8, title, "", 0, "C", false, 0, "")
	y += 12

	barHeight := 16.0
	labelWidth := width * 0.2
	barMaxWidth := width * 0.8

	for i, d := range data {
		barY := y + float64(i)*(barHeight+5)

		// Label
		pdf.SetFont("Arial", "", 8)
		pdf.SetTextColor(71, 85, 105)
		pdf.SetXY(x, barY)
		pdf.CellFormat(labelWidth, barHeight, d.Label, "", 0, "R", false, 0, "")

		// Stacked bars
		barX := x + labelWidth + 2
		total := d.Value1 + d.Value2 + d.Value3

		if total > 0 {
			// First segment
			width1 := (d.Value1 / total) * barMaxWidth
			pdf.SetFillColor(ChartColors[0][0], ChartColors[0][1], ChartColors[0][2])
			pdf.Rect(barX, barY, width1, barHeight, "F")

			// Second segment
			width2 := (d.Value2 / total) * barMaxWidth
			pdf.SetFillColor(ChartColors[1][0], ChartColors[1][1], ChartColors[1][2])
			pdf.Rect(barX+width1, barY, width2, barHeight, "F")

			// Third segment
			width3 := (d.Value3 / total) * barMaxWidth
			pdf.SetFillColor(ChartColors[2][0], ChartColors[2][1], ChartColors[2][2])
			pdf.Rect(barX+width1+width2, barY, width3, barHeight, "F")
		}
	}

	// Legend
	legendY := y + float64(len(data))*(barHeight+5) + 5
	legendLabels := []string{"Running", "Stopped", "Other"}

	pdf.SetFont("Arial", "", 7)
	legendX := x + labelWidth + 2
	for i, label := range legendLabels {
		pdf.SetFillColor(ChartColors[i][0], ChartColors[i][1], ChartColors[i][2])
		pdf.Rect(legendX, legendY, 8, 8, "F")
		pdf.SetTextColor(71, 85, 105)
		pdf.SetXY(legendX+10, legendY)
		pdf.CellFormat(30, 8, label, "", 0, "L", false, 0, "")
		legendX += 45
	}
}

// StackedBarData represents data for a stacked bar chart
type StackedBarData struct {
	Label  string
	Value1 float64
	Value2 float64
	Value3 float64
}

// DrawResourceComparisonChart draws a comparison chart for resources
func DrawResourceComparisonChart(pdf *gofpdf.Fpdf, title string, items []ResourceComparison, x, y, width, height float64) {
	if len(items) == 0 {
		return
	}

	// Title
	pdf.SetFont("Arial", "B", 10)
	pdf.SetTextColor(51, 65, 85)
	pdf.SetXY(x, y)
	pdf.CellFormat(width, 8, title, "", 0, "C", false, 0, "")
	y += 12

	// Headers
	pdf.SetFont("Arial", "B", 8)
	pdf.SetFillColor(241, 245, 249)
	colWidths := []float64{width * 0.3, width * 0.35, width * 0.35}
	headers := []string{"Resource", "CPU Usage", "Memory Usage"}

	currentX := x
	for i, header := range headers {
		pdf.SetXY(currentX, y)
		pdf.CellFormat(colWidths[i], 8, header, "1", 0, "C", true, 0, "")
		currentX += colWidths[i]
	}
	y += 8

	// Data rows
	pdf.SetFont("Arial", "", 8)
	for _, item := range items {
		currentX = x

		// Name
		pdf.SetXY(currentX, y)
		pdf.SetTextColor(71, 85, 105)
		pdf.CellFormat(colWidths[0], 12, truncateString(item.Name, 15), "1", 0, "L", false, 0, "")
		currentX += colWidths[0]

		// CPU bar
		pdf.SetXY(currentX, y)
		pdf.CellFormat(colWidths[1], 12, "", "1", 0, "L", false, 0, "")
		DrawMiniBarChart(pdf, item.CPUUsage, currentX+2, y+3, colWidths[1]-20, 6)
		pdf.SetXY(currentX+colWidths[1]-18, y+3)
		pdf.CellFormat(16, 6, fmt.Sprintf("%.0f%%", item.CPUUsage), "", 0, "R", false, 0, "")
		currentX += colWidths[1]

		// Memory bar
		pdf.SetXY(currentX, y)
		pdf.CellFormat(colWidths[2], 12, "", "1", 0, "L", false, 0, "")
		DrawMiniBarChart(pdf, item.MemoryUsage, currentX+2, y+3, colWidths[2]-20, 6)
		pdf.SetXY(currentX+colWidths[2]-18, y+3)
		pdf.CellFormat(16, 6, fmt.Sprintf("%.0f%%", item.MemoryUsage), "", 0, "R", false, 0, "")

		y += 12
	}
}

// ResourceComparison represents a resource for comparison chart
type ResourceComparison struct {
	Name        string
	CPUUsage    float64
	MemoryUsage float64
}
