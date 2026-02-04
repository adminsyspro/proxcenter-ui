package reports

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	"gorm.io/gorm"

	"github.com/proxcenter/orchestrator/internal/metrics"
	"github.com/proxcenter/orchestrator/internal/notifications"
	"github.com/proxcenter/orchestrator/internal/proxmox"
	"github.com/proxcenter/orchestrator/internal/alerts"
)

// Config holds configuration for the reports service
type Config struct {
	StoragePath    string        `yaml:"storage_path" mapstructure:"storage_path"`
	RetentionDays  int           `yaml:"retention_days" mapstructure:"retention_days"`
	CleanupEnabled bool          `yaml:"cleanup_enabled" mapstructure:"cleanup_enabled"`
}

// DefaultConfig returns the default configuration
func DefaultConfig() Config {
	return Config{
		StoragePath:    "/data/reports",
		RetentionDays:  90,
		CleanupEnabled: true,
	}
}

// Service manages report generation and scheduling
type Service struct {
	db            *gorm.DB
	config        Config
	pve           *proxmox.Manager
	metrics       *metrics.Collector
	alerts        *alerts.Service
	notifications *notifications.Service
	generator     *Generator
	scheduler     *ReportScheduler
	mu            sync.RWMutex
}

// NewService creates a new reports service
func NewService(db *gorm.DB, cfg Config, pve *proxmox.Manager, metricsCollector *metrics.Collector, alertsService *alerts.Service, notifService *notifications.Service) (*Service, error) {
	// Auto-migrate models
	if err := db.AutoMigrate(&ReportRecord{}, &ReportSchedule{}); err != nil {
		return nil, fmt.Errorf("failed to migrate reports models: %w", err)
	}

	// Ensure storage directory exists
	if err := os.MkdirAll(cfg.StoragePath, 0755); err != nil {
		return nil, fmt.Errorf("failed to create reports storage directory: %w", err)
	}

	s := &Service{
		db:            db,
		config:        cfg,
		pve:           pve,
		metrics:       metricsCollector,
		alerts:        alertsService,
		notifications: notifService,
	}

	// Create generator
	s.generator = NewGenerator(s)

	log.Info().Str("storage_path", cfg.StoragePath).Msg("Reports service initialized")

	return s, nil
}

// SetProxCenterDBPath sets the path to ProxCenter's database for enhanced features
// This enables connection name resolution and AI analysis in reports
func (s *Service) SetProxCenterDBPath(dbPath string) {
	if s.generator != nil {
		s.generator.SetProxCenterDBPath(dbPath)
	}
}

// SetScheduler sets the report scheduler (called after scheduler is initialized)
func (s *Service) SetScheduler(scheduler *ReportScheduler) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.scheduler = scheduler
}

// GetProxmoxManager returns the Proxmox manager
func (s *Service) GetProxmoxManager() *proxmox.Manager {
	return s.pve
}

// GetMetricsCollector returns the metrics collector
func (s *Service) GetMetricsCollector() *metrics.Collector {
	return s.metrics
}

// GetAlertsService returns the alerts service
func (s *Service) GetAlertsService() *alerts.Service {
	return s.alerts
}

// GetNotificationsService returns the notifications service
func (s *Service) GetNotificationsService() *notifications.Service {
	return s.notifications
}

// GetConfig returns the service configuration
func (s *Service) GetConfig() Config {
	return s.config
}

// ==========================================
// Report CRUD Operations
// ==========================================

// ListReports returns paginated list of reports
func (s *Service) ListReports(limit, offset int, reportType *ReportType, status *ReportStatus) ([]ReportRecord, int64, error) {
	var reports []ReportRecord
	var total int64

	query := s.db.Model(&ReportRecord{})

	if reportType != nil {
		query = query.Where("type = ?", *reportType)
	}
	if status != nil {
		query = query.Where("status = ?", *status)
	}

	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	if err := query.Order("created_at DESC").Limit(limit).Offset(offset).Find(&reports).Error; err != nil {
		return nil, 0, err
	}

	return reports, total, nil
}

// GetReport returns a report by ID
func (s *Service) GetReport(id string) (*ReportRecord, error) {
	var report ReportRecord
	if err := s.db.First(&report, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &report, nil
}

// DeleteReport deletes a report and its file
func (s *Service) DeleteReport(id string) error {
	report, err := s.GetReport(id)
	if err != nil {
		return err
	}

	// Delete file if exists
	if report.FilePath != "" {
		if err := os.Remove(report.FilePath); err != nil && !os.IsNotExist(err) {
			log.Warn().Err(err).Str("path", report.FilePath).Msg("Failed to delete report file")
		}
	}

	return s.db.Delete(&ReportRecord{}, "id = ?", id).Error
}

// GenerateReport starts async report generation
func (s *Service) GenerateReport(ctx context.Context, req GenerateReportRequest, generatedBy string) (*ReportRecord, error) {
	// Parse dates
	dateFrom, err := parseDate(req.DateFrom)
	if err != nil {
		return nil, fmt.Errorf("invalid date_from: %w", err)
	}
	dateTo, err := parseDate(req.DateTo)
	if err != nil {
		return nil, fmt.Errorf("invalid date_to: %w", err)
	}

	// Validate report type
	if !isValidReportType(req.Type) {
		return nil, fmt.Errorf("invalid report type: %s", req.Type)
	}

	// Set default sections if not provided
	sections := req.Sections
	if len(sections) == 0 {
		sections = ReportSections[req.Type]
	}

	// Generate name if not provided
	name := req.Name
	if name == "" {
		name = fmt.Sprintf("%s Report - %s", capitalizeFirst(string(req.Type)), time.Now().Format("2006-01-02"))
	}

	// Set default language if not provided
	language := req.Language
	if language == "" {
		language = "en"
	}

	// Create report record
	report := &ReportRecord{
		ID:            uuid.New().String(),
		Type:          req.Type,
		Name:          name,
		Status:        ReportStatusPending,
		DateFrom:      dateFrom,
		DateTo:        dateTo,
		ConnectionIDs: req.ConnectionIDs,
		Sections:      sections,
		Language:      language,
		GeneratedBy:   generatedBy,
		CreatedAt:     time.Now(),
		UpdatedAt:     time.Now(),
	}

	if err := s.db.Create(report).Error; err != nil {
		return nil, fmt.Errorf("failed to create report record: %w", err)
	}

	// Start async generation
	go s.generateReportAsync(report)

	return report, nil
}

// generateReportAsync performs the actual report generation
func (s *Service) generateReportAsync(report *ReportRecord) {
	ctx := context.Background()

	// Update status to generating
	report.Status = ReportStatusGenerating
	report.UpdatedAt = time.Now()
	s.db.Save(report)

	log.Info().
		Str("report_id", report.ID).
		Str("type", string(report.Type)).
		Msg("Starting report generation")

	// Generate PDF
	filePath, fileSize, err := s.generator.Generate(ctx, report)
	if err != nil {
		log.Error().Err(err).Str("report_id", report.ID).Msg("Failed to generate report")
		report.Status = ReportStatusFailed
		report.Error = err.Error()
		report.UpdatedAt = time.Now()
		s.db.Save(report)
		return
	}

	// Update report with success
	now := time.Now()
	report.Status = ReportStatusCompleted
	report.FilePath = filePath
	report.FileSize = fileSize
	report.CompletedAt = &now
	report.UpdatedAt = now
	s.db.Save(report)

	log.Info().
		Str("report_id", report.ID).
		Str("file_path", filePath).
		Int64("file_size", fileSize).
		Msg("Report generation completed")
}

// GetReportFilePath returns the file path for a completed report
func (s *Service) GetReportFilePath(id string) (string, error) {
	report, err := s.GetReport(id)
	if err != nil {
		return "", err
	}

	if report.Status != ReportStatusCompleted {
		return "", fmt.Errorf("report is not completed (status: %s)", report.Status)
	}

	if report.FilePath == "" {
		return "", fmt.Errorf("report file path is empty")
	}

	// Check file exists
	if _, err := os.Stat(report.FilePath); os.IsNotExist(err) {
		return "", fmt.Errorf("report file not found")
	}

	return report.FilePath, nil
}

// ==========================================
// Schedule CRUD Operations
// ==========================================

// ListSchedules returns all schedules
func (s *Service) ListSchedules() ([]ReportSchedule, error) {
	var schedules []ReportSchedule
	if err := s.db.Order("created_at DESC").Find(&schedules).Error; err != nil {
		return nil, err
	}
	return schedules, nil
}

// GetSchedule returns a schedule by ID
func (s *Service) GetSchedule(id string) (*ReportSchedule, error) {
	var schedule ReportSchedule
	if err := s.db.First(&schedule, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &schedule, nil
}

// CreateSchedule creates a new schedule
func (s *Service) CreateSchedule(req CreateScheduleRequest) (*ReportSchedule, error) {
	// Validate
	if !isValidReportType(req.Type) {
		return nil, fmt.Errorf("invalid report type: %s", req.Type)
	}
	if !isValidFrequency(req.Frequency) {
		return nil, fmt.Errorf("invalid frequency: %s", req.Frequency)
	}
	if req.Name == "" {
		return nil, fmt.Errorf("name is required")
	}
	if len(req.Recipients) == 0 {
		return nil, fmt.Errorf("at least one recipient is required")
	}

	// Set default sections if not provided
	sections := req.Sections
	if len(sections) == 0 {
		sections = ReportSections[req.Type]
	}

	// Set default language if not provided
	scheduleLanguage := req.Language
	if scheduleLanguage == "" {
		scheduleLanguage = "en"
	}

	schedule := &ReportSchedule{
		ID:            uuid.New().String(),
		Name:          req.Name,
		Enabled:       true,
		Type:          req.Type,
		Frequency:     req.Frequency,
		DayOfWeek:     req.DayOfWeek,
		DayOfMonth:    req.DayOfMonth,
		TimeOfDay:     req.TimeOfDay,
		ConnectionIDs: req.ConnectionIDs,
		Sections:      sections,
		Recipients:    req.Recipients,
		Language:      scheduleLanguage,
		CreatedAt:     time.Now(),
		UpdatedAt:     time.Now(),
	}

	// Calculate next run
	schedule.NextRunAt = calculateNextRun(schedule)

	if err := s.db.Create(schedule).Error; err != nil {
		return nil, err
	}

	// Register with scheduler if available
	s.mu.RLock()
	scheduler := s.scheduler
	s.mu.RUnlock()
	if scheduler != nil {
		scheduler.RegisterSchedule(schedule)
	}

	log.Info().
		Str("schedule_id", schedule.ID).
		Str("name", schedule.Name).
		Str("frequency", string(schedule.Frequency)).
		Msg("Created report schedule")

	return schedule, nil
}

// UpdateSchedule updates an existing schedule
func (s *Service) UpdateSchedule(id string, req UpdateScheduleRequest) (*ReportSchedule, error) {
	schedule, err := s.GetSchedule(id)
	if err != nil {
		return nil, err
	}

	if req.Name != nil {
		schedule.Name = *req.Name
	}
	if req.Enabled != nil {
		schedule.Enabled = *req.Enabled
	}
	if req.Type != nil {
		schedule.Type = *req.Type
	}
	if req.Frequency != nil {
		schedule.Frequency = *req.Frequency
	}
	if req.DayOfWeek != nil {
		schedule.DayOfWeek = *req.DayOfWeek
	}
	if req.DayOfMonth != nil {
		schedule.DayOfMonth = *req.DayOfMonth
	}
	if req.TimeOfDay != nil {
		schedule.TimeOfDay = *req.TimeOfDay
	}
	if req.ConnectionIDs != nil {
		schedule.ConnectionIDs = req.ConnectionIDs
	}
	if req.Sections != nil {
		schedule.Sections = req.Sections
	}
	if req.Recipients != nil {
		schedule.Recipients = req.Recipients
	}
	if req.Language != nil {
		schedule.Language = *req.Language
	}

	schedule.UpdatedAt = time.Now()
	schedule.NextRunAt = calculateNextRun(schedule)

	if err := s.db.Save(schedule).Error; err != nil {
		return nil, err
	}

	// Update scheduler if available
	s.mu.RLock()
	scheduler := s.scheduler
	s.mu.RUnlock()
	if scheduler != nil {
		scheduler.UpdateSchedule(schedule)
	}

	return schedule, nil
}

// DeleteSchedule deletes a schedule
func (s *Service) DeleteSchedule(id string) error {
	// Remove from scheduler first
	s.mu.RLock()
	scheduler := s.scheduler
	s.mu.RUnlock()
	if scheduler != nil {
		scheduler.RemoveSchedule(id)
	}

	return s.db.Delete(&ReportSchedule{}, "id = ?", id).Error
}

// RunScheduleNow executes a schedule immediately
func (s *Service) RunScheduleNow(id string) (*ReportRecord, error) {
	schedule, err := s.GetSchedule(id)
	if err != nil {
		return nil, err
	}

	// Create report from schedule
	req := GenerateReportRequest{
		Type:          schedule.Type,
		Name:          fmt.Sprintf("%s - Manual Run", schedule.Name),
		DateFrom:      getReportDateRange(schedule.Frequency),
		DateTo:        time.Now().Format("2006-01-02"),
		ConnectionIDs: schedule.ConnectionIDs,
		Sections:      schedule.Sections,
		Language:      schedule.Language,
	}

	report, err := s.GenerateReport(context.Background(), req, "scheduler")
	if err != nil {
		return nil, err
	}

	// Link to schedule
	report.ScheduleID = &schedule.ID
	s.db.Save(report)

	return report, nil
}

// ExecuteScheduledReport is called by the scheduler to run a scheduled report
func (s *Service) ExecuteScheduledReport(schedule *ReportSchedule) {
	ctx := context.Background()

	log.Info().
		Str("schedule_id", schedule.ID).
		Str("name", schedule.Name).
		Msg("Executing scheduled report")

	// Create report request
	req := GenerateReportRequest{
		Type:          schedule.Type,
		Name:          fmt.Sprintf("%s - %s", schedule.Name, time.Now().Format("2006-01-02")),
		DateFrom:      getReportDateRange(schedule.Frequency),
		DateTo:        time.Now().Format("2006-01-02"),
		ConnectionIDs: schedule.ConnectionIDs,
		Sections:      schedule.Sections,
		Language:      schedule.Language,
	}

	report, err := s.GenerateReport(ctx, req, "scheduler")
	if err != nil {
		log.Error().Err(err).Str("schedule_id", schedule.ID).Msg("Failed to generate scheduled report")
		return
	}

	// Link to schedule
	report.ScheduleID = &schedule.ID
	s.db.Save(report)

	// Update schedule
	now := time.Now()
	schedule.LastRunAt = &now
	schedule.NextRunAt = calculateNextRun(schedule)
	schedule.UpdatedAt = now
	s.db.Save(schedule)

	// Wait for report to complete and send email
	go s.waitAndSendReport(report, schedule)
}

// waitAndSendReport waits for report completion and sends email
func (s *Service) waitAndSendReport(report *ReportRecord, schedule *ReportSchedule) {
	// Poll for completion (max 10 minutes)
	timeout := time.After(10 * time.Minute)
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-timeout:
			log.Warn().Str("report_id", report.ID).Msg("Timeout waiting for report completion")
			return
		case <-ticker.C:
			updated, err := s.GetReport(report.ID)
			if err != nil {
				continue
			}

			if updated.Status == ReportStatusCompleted {
				s.sendReportEmail(updated, schedule)
				return
			} else if updated.Status == ReportStatusFailed {
				log.Error().Str("report_id", report.ID).Str("error", updated.Error).Msg("Scheduled report failed")
				return
			}
		}
	}
}

// sendReportEmail sends the report via email to recipients
func (s *Service) sendReportEmail(report *ReportRecord, schedule *ReportSchedule) {
	if s.notifications == nil {
		log.Warn().Msg("Notifications service not available, skipping email")
		return
	}

	// For now, send a notification without attachment
	// TODO: Extend notifications service to support attachments
	notification := &notifications.Notification{
		Type:       notifications.NotificationTypeReport,
		Severity:   notifications.SeverityInfo,
		Title:      fmt.Sprintf("Report Ready: %s", report.Name),
		Message:    fmt.Sprintf("Your scheduled report '%s' is ready for download.", report.Name),
		Recipients: schedule.Recipients,
		Data: map[string]any{
			"report_id":   report.ID,
			"report_name": report.Name,
			"report_type": report.Type,
			"file_size":   report.FileSize,
		},
	}

	s.notifications.Send(notification)

	log.Info().
		Str("report_id", report.ID).
		Strs("recipients", schedule.Recipients).
		Msg("Sent report notification email")
}

// CleanupOldReports removes reports older than retention period
func (s *Service) CleanupOldReports() error {
	if !s.config.CleanupEnabled {
		return nil
	}

	cutoff := time.Now().AddDate(0, 0, -s.config.RetentionDays)

	var oldReports []ReportRecord
	if err := s.db.Where("created_at < ?", cutoff).Find(&oldReports).Error; err != nil {
		return err
	}

	for _, report := range oldReports {
		if err := s.DeleteReport(report.ID); err != nil {
			log.Warn().Err(err).Str("report_id", report.ID).Msg("Failed to delete old report")
		}
	}

	if len(oldReports) > 0 {
		log.Info().Int("count", len(oldReports)).Msg("Cleaned up old reports")
	}

	return nil
}

// ==========================================
// Helper Functions
// ==========================================

func parseDate(s string) (time.Time, error) {
	// Try RFC3339 first
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t, nil
	}
	// Try date only
	if t, err := time.Parse("2006-01-02", s); err == nil {
		return t, nil
	}
	return time.Time{}, fmt.Errorf("invalid date format: %s", s)
}

func isValidReportType(t ReportType) bool {
	for _, rt := range AllReportTypes {
		if rt == t {
			return true
		}
	}
	return false
}

func isValidFrequency(f Frequency) bool {
	return f == FrequencyDaily || f == FrequencyWeekly || f == FrequencyMonthly
}

func capitalizeFirst(s string) string {
	if len(s) == 0 {
		return s
	}
	return string(s[0]-32) + s[1:]
}

func calculateNextRun(schedule *ReportSchedule) *time.Time {
	now := time.Now()

	// Parse time of day
	hour, min := 8, 0
	if schedule.TimeOfDay != "" {
		fmt.Sscanf(schedule.TimeOfDay, "%d:%d", &hour, &min)
	}

	var next time.Time

	switch schedule.Frequency {
	case FrequencyDaily:
		next = time.Date(now.Year(), now.Month(), now.Day(), hour, min, 0, 0, now.Location())
		if next.Before(now) {
			next = next.AddDate(0, 0, 1)
		}

	case FrequencyWeekly:
		next = time.Date(now.Year(), now.Month(), now.Day(), hour, min, 0, 0, now.Location())
		daysUntil := (schedule.DayOfWeek - int(now.Weekday()) + 7) % 7
		if daysUntil == 0 && next.Before(now) {
			daysUntil = 7
		}
		next = next.AddDate(0, 0, daysUntil)

	case FrequencyMonthly:
		day := schedule.DayOfMonth
		if day < 1 {
			day = 1
		}
		if day > 28 {
			day = 28 // Safe day for all months
		}
		next = time.Date(now.Year(), now.Month(), day, hour, min, 0, 0, now.Location())
		if next.Before(now) {
			next = next.AddDate(0, 1, 0)
		}
	}

	return &next
}

func getReportDateRange(frequency Frequency) string {
	now := time.Now()
	var from time.Time

	switch frequency {
	case FrequencyDaily:
		from = now.AddDate(0, 0, -1)
	case FrequencyWeekly:
		from = now.AddDate(0, 0, -7)
	case FrequencyMonthly:
		from = now.AddDate(0, -1, 0)
	default:
		from = now.AddDate(0, 0, -7)
	}

	return from.Format("2006-01-02")
}

// GenerateFileName creates a filename for a report
func GenerateFileName(report *ReportRecord) string {
	timestamp := time.Now().Format("20060102_150405")
	return fmt.Sprintf("%s_%s_%s.pdf", report.Type, report.ID[:8], timestamp)
}

// GetFilePath returns the full file path for a report
func (s *Service) GetFilePath(report *ReportRecord) string {
	return filepath.Join(s.config.StoragePath, GenerateFileName(report))
}
