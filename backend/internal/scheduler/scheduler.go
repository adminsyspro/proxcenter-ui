package scheduler

import (
	"context"
	"fmt"
	"sync"

	"github.com/proxcenter/orchestrator/internal/config"
	"github.com/robfig/cron/v3"
	"github.com/rs/zerolog/log"
)

// Task represents a scheduled task
type Task func(ctx context.Context) error

// Scheduler manages periodic tasks
type Scheduler struct {
	cron   *cron.Cron
	tasks  map[string]cron.EntryID
	config config.SchedulerConfig
	mu     sync.RWMutex
}

// New creates a new scheduler
func New(cfg config.SchedulerConfig) *Scheduler {
	return &Scheduler{
		cron:   cron.New(cron.WithSeconds()),
		tasks:  make(map[string]cron.EntryID),
		config: cfg,
	}
}

// Register registers a task to run at the specified interval
func (s *Scheduler) Register(name string, interval interface{}, task Task) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	var spec string

	// Convert interval to cron spec
	switch v := interval.(type) {
	case string:
		spec = v
	case int:
		// Assume seconds
		spec = "@every " + formatDuration(v)
	case int64:
		spec = "@every " + formatDuration(int(v))
	default:
		// Try to handle time.Duration via Stringer interface
		if stringer, ok := interval.(interface{ String() string }); ok {
			spec = "@every " + stringer.String()
		} else {
			spec = "@every 1m" // Default fallback
			log.Warn().
				Str("task", name).
				Str("type", fmt.Sprintf("%T", interval)).
				Msg("Unknown interval type, using default 1m")
		}
	}

	entryID, err := s.cron.AddFunc(spec, func() {
		ctx := context.Background()
		log.Debug().Str("task", name).Msg("Running scheduled task")

		if err := task(ctx); err != nil {
			log.Error().Err(err).Str("task", name).Msg("Scheduled task failed")
		}
	})

	if err != nil {
		return err
	}

	s.tasks[name] = entryID
	log.Info().Str("task", name).Str("schedule", spec).Msg("Registered scheduled task")

	return nil
}

// formatDuration converts seconds to a duration string
func formatDuration(seconds int) string {
	if seconds >= 3600 && seconds%3600 == 0 {
		return fmt.Sprintf("%dh", seconds/3600)
	}
	if seconds >= 60 && seconds%60 == 0 {
		return fmt.Sprintf("%dm", seconds/60)
	}
	return fmt.Sprintf("%ds", seconds)
}

// Start starts the scheduler
func (s *Scheduler) Start() {
	s.cron.Start()
	log.Info().Msg("Scheduler started")
}

// Stop stops the scheduler
func (s *Scheduler) Stop() {
	ctx := s.cron.Stop()
	<-ctx.Done()
	log.Info().Msg("Scheduler stopped")
}

// Remove removes a task
func (s *Scheduler) Remove(name string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if entryID, ok := s.tasks[name]; ok {
		s.cron.Remove(entryID)
		delete(s.tasks, name)
		log.Info().Str("task", name).Msg("Removed scheduled task")
	}
}

// GetTasks returns the list of registered tasks
func (s *Scheduler) GetTasks() []string {
	s.mu.RLock()
	defer s.mu.RUnlock()

	tasks := make([]string, 0, len(s.tasks))
	for name := range s.tasks {
		tasks = append(tasks, name)
	}
	return tasks
}
