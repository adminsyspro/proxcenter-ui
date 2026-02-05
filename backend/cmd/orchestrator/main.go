package main

import (
	"context"
	"flag"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/proxcenter/orchestrator/internal/alerts"
	"github.com/proxcenter/orchestrator/internal/api"
	"github.com/proxcenter/orchestrator/internal/config"
	"github.com/proxcenter/orchestrator/internal/drs"
	"github.com/proxcenter/orchestrator/internal/events"
	"github.com/proxcenter/orchestrator/internal/license"
	"github.com/proxcenter/orchestrator/internal/metrics"
	"github.com/proxcenter/orchestrator/internal/notifications"
	"github.com/proxcenter/orchestrator/internal/proxmox"
	"github.com/proxcenter/orchestrator/internal/reports"
	"github.com/proxcenter/orchestrator/internal/scheduler"
	"github.com/proxcenter/orchestrator/internal/storage"
)

var (
	Version   = "dev"
	BuildTime = "unknown"
)

func main() {
	// Parse flags
	configPath := flag.String("config", "config.yaml", "Path to configuration file")
	flag.Parse()

	// Load configuration
	cfg, err := config.Load(*configPath)
	if err != nil {
		log.Fatal().Err(err).Msg("Failed to load configuration")
	}

	// Setup logging
	setupLogging(cfg.LogLevel)

	log.Info().
		Str("version", Version).
		Str("build_time", BuildTime).
		Msg("Starting ProxCenter Orchestrator")

	// Initialize database
	db, err := storage.NewDatabase(cfg.Database)
	if err != nil {
		log.Fatal().Err(err).Msg("Failed to initialize database")
	}

	// Initialize Proxmox manager
	pveManager := proxmox.NewManager(cfg.Proxmox)

	// Load connections from ProxCenter database
	if err := pveManager.LoadConnectionsFromProxCenter(cfg.Proxmox.ProxCenterDBPath, cfg.Proxmox.AppSecret); err != nil {
		log.Error().Err(err).Msg("Failed to load connections from ProxCenter")
	}

	// Initialize metrics collector
	metricsCollector := metrics.NewCollector(pveManager, db)

	// Initialize DRS engine
	drsEngine := drs.NewEngine(pveManager, db, cfg.DRS)

	// Initialize scheduler
	sched := scheduler.New(cfg.Scheduler)

	// Initialize alerts service
	alertsService, err := alerts.NewService(db.DB(), alerts.AlertThresholds{
		CPUCritical:     90,
		CPUWarning:      80,
		MemoryCritical:  90,
		MemoryWarning:   80,
		StorageCritical: 90,
		StorageWarning:  80,
	})
	if err != nil {
		log.Fatal().Err(err).Msg("Failed to initialize alerts service")
	}

	// Initialize notifications service
	notifSettings := notifications.NotificationSettings{
		EnableAlerts:      cfg.Notifications.EnableAlerts,
		EnableMigrations:  cfg.Notifications.EnableMigrations,
		EnableBackups:     cfg.Notifications.EnableBackups,
		EnableMaintenance: cfg.Notifications.EnableMaintenance,
		EnableReports:     cfg.Notifications.EnableReports,
		MinSeverity:       cfg.Notifications.MinSeverity,
		RateLimitPerHour:  cfg.Notifications.RateLimitPerHour,
	}

	notifService, err := notifications.NewService(db.DB(), notifSettings)
	if err != nil {
		log.Fatal().Err(err).Msg("Failed to initialize notifications service")
	}

	// Configure email if enabled
	if cfg.Notifications.Email.Enabled {
		emailProvider := notifications.NewEmailProvider(notifications.EmailConfig{
			SMTPHost:          cfg.Notifications.Email.SMTPHost,
			SMTPPort:          cfg.Notifications.Email.SMTPPort,
			SMTPUser:          cfg.Notifications.Email.SMTPUser,
			SMTPPassword:      cfg.Notifications.Email.SMTPPassword,
			SMTPFrom:          cfg.Notifications.Email.SMTPFrom,
			SMTPFromName:      cfg.Notifications.Email.SMTPFromName,
			UseTLS:            cfg.Notifications.Email.UseTLS,
			UseStartTLS:       cfg.Notifications.Email.UseStartTLS,
			SkipVerify:        cfg.Notifications.Email.SkipVerify,
			DefaultRecipients: cfg.Notifications.Email.DefaultRecipients,
		})
		notifService.SetEmailProvider(emailProvider)
	}

	// Initialize license validator
	licenseValidator, err := license.NewValidator(cfg.License.FilePath)
	if err != nil {
		log.Warn().Err(err).Msg("Failed to initialize license validator, running in Community mode")
		licenseValidator = nil
	}

	// Initialize reports service
	reportsService, err := reports.NewService(db.DB(), reports.Config{}, pveManager, metricsCollector, alertsService, notifService)
	if err != nil {
		log.Error().Err(err).Msg("Failed to initialize reports service")
	}

	// Initialize event poller
	eventPoller := events.NewPoller(pveManager, alertsService, db.DB(), cfg.Scheduler.EventPollInterval)

	// Create API server
	server := api.NewServer(cfg.API, pveManager, drsEngine, metricsCollector, db)
	server.SetNotificationService(notifService)
	server.SetAlertService(alertsService)
	if licenseValidator != nil {
		server.SetLicenseValidator(licenseValidator)
	}
	if reportsService != nil {
		server.SetReportsService(reportsService)
	}

	// Register scheduled tasks
	registerScheduledTasks(sched, cfg, metricsCollector, drsEngine, pveManager)

	// Start services
	sched.Start()
	eventPoller.Start()

	// Start API server in goroutine
	go func() {
		if err := server.Start(); err != nil {
			log.Fatal().Err(err).Msg("Failed to start API server")
		}
	}()

	// Wait for shutdown signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Info().Msg("Shutting down...")

	// Graceful shutdown
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	eventPoller.Stop()
	sched.Stop()

	if err := server.Shutdown(ctx); err != nil {
		log.Error().Err(err).Msg("Server shutdown error")
	}

	log.Info().Msg("Orchestrator stopped")
}

func setupLogging(level string) {
	// Pretty console logging
	log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stdout, TimeFormat: time.RFC3339})

	// Set log level
	switch level {
	case "debug":
		zerolog.SetGlobalLevel(zerolog.DebugLevel)
	case "info":
		zerolog.SetGlobalLevel(zerolog.InfoLevel)
	case "warn":
		zerolog.SetGlobalLevel(zerolog.WarnLevel)
	case "error":
		zerolog.SetGlobalLevel(zerolog.ErrorLevel)
	default:
		zerolog.SetGlobalLevel(zerolog.InfoLevel)
	}
}

func registerScheduledTasks(sched *scheduler.Scheduler, cfg *config.Config, metricsCollector *metrics.Collector, drsEngine *drs.Engine, pveManager *proxmox.Manager) {
	// Metrics collection
	sched.Register("metrics", cfg.Scheduler.MetricsInterval, func(ctx context.Context) error {
		return metricsCollector.Collect(ctx)
	})

	// DRS evaluation (if enabled)
	if cfg.DRS.Enabled {
		sched.Register("drs", cfg.Scheduler.DRSInterval, func(ctx context.Context) error {
			_, err := drsEngine.Evaluate(ctx)
			return err
		})
	}

	// Reload connections periodically
	sched.Register("reload-connections", "5m", func(ctx context.Context) error {
		return pveManager.LoadConnectionsFromProxCenter(cfg.Proxmox.ProxCenterDBPath, cfg.Proxmox.AppSecret)
	})
}
