package reports

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/proxcenter/orchestrator/internal/scheduler"
	"github.com/rs/zerolog/log"
)

// ReportScheduler manages scheduled report generation
type ReportScheduler struct {
	service   *Service
	scheduler *scheduler.Scheduler
	schedules map[string]*ReportSchedule
	mu        sync.RWMutex
}

// NewReportScheduler creates a new report scheduler
func NewReportScheduler(service *Service, sched *scheduler.Scheduler) *ReportScheduler {
	rs := &ReportScheduler{
		service:   service,
		scheduler: sched,
		schedules: make(map[string]*ReportSchedule),
	}

	// Register cleanup task
	if err := sched.Register("reports-cleanup", "0 0 3 * * *", func(ctx context.Context) error {
		return service.CleanupOldReports()
	}); err != nil {
		log.Warn().Err(err).Msg("Failed to register reports cleanup task")
	}

	return rs
}

// LoadSchedules loads all enabled schedules from database and registers them
func (rs *ReportScheduler) LoadSchedules() error {
	schedules, err := rs.service.ListSchedules()
	if err != nil {
		return fmt.Errorf("failed to load schedules: %w", err)
	}

	for i := range schedules {
		schedule := &schedules[i]
		if schedule.Enabled {
			rs.RegisterSchedule(schedule)
		}
	}

	log.Info().Int("count", len(schedules)).Msg("Loaded report schedules")
	return nil
}

// RegisterSchedule registers a schedule with the scheduler
func (rs *ReportScheduler) RegisterSchedule(schedule *ReportSchedule) {
	if !schedule.Enabled {
		return
	}

	rs.mu.Lock()
	defer rs.mu.Unlock()

	// Remove existing if any
	taskName := rs.getTaskName(schedule.ID)
	rs.scheduler.Remove(taskName)

	// Convert to cron expression
	cronSpec := rs.toCronSpec(schedule)

	// Register with scheduler
	err := rs.scheduler.Register(taskName, cronSpec, func(ctx context.Context) error {
		rs.service.ExecuteScheduledReport(schedule)
		return nil
	})

	if err != nil {
		log.Error().Err(err).
			Str("schedule_id", schedule.ID).
			Str("cron_spec", cronSpec).
			Msg("Failed to register report schedule")
		return
	}

	rs.schedules[schedule.ID] = schedule

	log.Info().
		Str("schedule_id", schedule.ID).
		Str("name", schedule.Name).
		Str("cron_spec", cronSpec).
		Msg("Registered report schedule")
}

// UpdateSchedule updates a schedule in the scheduler
func (rs *ReportScheduler) UpdateSchedule(schedule *ReportSchedule) {
	rs.mu.Lock()
	defer rs.mu.Unlock()

	taskName := rs.getTaskName(schedule.ID)

	// Remove existing
	rs.scheduler.Remove(taskName)
	delete(rs.schedules, schedule.ID)

	// Re-register if enabled
	if schedule.Enabled {
		rs.mu.Unlock()
		rs.RegisterSchedule(schedule)
		rs.mu.Lock()
	}
}

// RemoveSchedule removes a schedule from the scheduler
func (rs *ReportScheduler) RemoveSchedule(id string) {
	rs.mu.Lock()
	defer rs.mu.Unlock()

	taskName := rs.getTaskName(id)
	rs.scheduler.Remove(taskName)
	delete(rs.schedules, id)

	log.Info().Str("schedule_id", id).Msg("Removed report schedule")
}

// getTaskName returns the task name for a schedule
func (rs *ReportScheduler) getTaskName(scheduleID string) string {
	return fmt.Sprintf("report-schedule-%s", scheduleID)
}

// toCronSpec converts a ReportSchedule to a cron expression
// The scheduler uses robfig/cron with seconds: "second minute hour day month weekday"
func (rs *ReportScheduler) toCronSpec(schedule *ReportSchedule) string {
	// Parse time of day
	hour, min := 8, 0
	if schedule.TimeOfDay != "" {
		fmt.Sscanf(schedule.TimeOfDay, "%d:%d", &hour, &min)
	}

	switch schedule.Frequency {
	case FrequencyDaily:
		// Every day at specified time
		return fmt.Sprintf("0 %d %d * * *", min, hour)

	case FrequencyWeekly:
		// Every week on specified day at specified time
		dayOfWeek := schedule.DayOfWeek
		if dayOfWeek < 0 || dayOfWeek > 6 {
			dayOfWeek = 1 // Default to Monday
		}
		return fmt.Sprintf("0 %d %d * * %d", min, hour, dayOfWeek)

	case FrequencyMonthly:
		// Every month on specified day at specified time
		dayOfMonth := schedule.DayOfMonth
		if dayOfMonth < 1 || dayOfMonth > 28 {
			dayOfMonth = 1 // Default to 1st, avoid issues with months having different days
		}
		return fmt.Sprintf("0 %d %d %d * *", min, hour, dayOfMonth)

	default:
		// Default to daily at 8:00
		return fmt.Sprintf("0 0 8 * * *")
	}
}

// GetNextRunTime calculates the next run time for a schedule
func (rs *ReportScheduler) GetNextRunTime(schedule *ReportSchedule) time.Time {
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
			day = 28
		}
		next = time.Date(now.Year(), now.Month(), day, hour, min, 0, 0, now.Location())
		if next.Before(now) {
			next = next.AddDate(0, 1, 0)
		}

	default:
		next = now.Add(24 * time.Hour)
	}

	return next
}

// GetRegisteredSchedules returns all registered schedules
func (rs *ReportScheduler) GetRegisteredSchedules() []*ReportSchedule {
	rs.mu.RLock()
	defer rs.mu.RUnlock()

	result := make([]*ReportSchedule, 0, len(rs.schedules))
	for _, s := range rs.schedules {
		result = append(result, s)
	}
	return result
}
