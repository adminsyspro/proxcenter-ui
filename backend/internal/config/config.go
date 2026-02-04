package config

import (
	"fmt"
	"os"
	"time"

	"github.com/spf13/viper"
	"gopkg.in/yaml.v3"
)

// ConfigPath stores the path to the config file for saving
var ConfigPath string

type Config struct {
	LogLevel      string              `mapstructure:"log_level" yaml:"log_level,omitempty"`
	API           APIConfig           `mapstructure:"api" yaml:"api"`
	Database      DatabaseConfig      `mapstructure:"database" yaml:"database"`
	Proxmox       ProxmoxConfig       `mapstructure:"proxmox" yaml:"proxmox"`
	DRS           DRSConfig           `mapstructure:"drs" yaml:"drs"`
	Scheduler     SchedulerConfig     `mapstructure:"scheduler" yaml:"scheduler"`
	Notifications NotificationsConfig `mapstructure:"notifications" yaml:"notifications"`
	License       LicenseConfig       `mapstructure:"license" yaml:"license"`
}

type LicenseConfig struct {
	FilePath string `mapstructure:"file_path" yaml:"file_path"`
}

type NotificationsConfig struct {
	Email EmailConfig `mapstructure:"email" yaml:"email"`

	// Filtres par type
	EnableAlerts      bool `mapstructure:"enable_alerts" yaml:"enable_alerts"`
	EnableMigrations  bool `mapstructure:"enable_migrations" yaml:"enable_migrations"`
	EnableBackups     bool `mapstructure:"enable_backups" yaml:"enable_backups"`
	EnableMaintenance bool `mapstructure:"enable_maintenance" yaml:"enable_maintenance"`
	EnableReports     bool `mapstructure:"enable_reports" yaml:"enable_reports"`

	// Sévérité minimale: info, success, warning, critical
	MinSeverity      string `mapstructure:"min_severity" yaml:"min_severity"`
	RateLimitPerHour int    `mapstructure:"rate_limit_per_hour" yaml:"rate_limit_per_hour"`
}

type EmailConfig struct {
	Enabled           bool     `mapstructure:"enabled" yaml:"enabled"`
	SMTPHost          string   `mapstructure:"smtp_host" yaml:"smtp_host"`
	SMTPPort          int      `mapstructure:"smtp_port" yaml:"smtp_port"`
	SMTPUser          string   `mapstructure:"smtp_user" yaml:"smtp_user"`
	SMTPPassword      string   `mapstructure:"smtp_password" yaml:"smtp_password"`
	SMTPFrom          string   `mapstructure:"smtp_from" yaml:"smtp_from"`
	SMTPFromName      string   `mapstructure:"smtp_from_name" yaml:"smtp_from_name"`
	UseTLS            bool     `mapstructure:"use_tls" yaml:"use_tls"`
	UseStartTLS       bool     `mapstructure:"use_starttls" yaml:"use_starttls"`
	SkipVerify        bool     `mapstructure:"skip_verify" yaml:"skip_verify"`
	DefaultRecipients []string `mapstructure:"default_recipients" yaml:"default_recipients"`
}

type APIConfig struct {
	Address      string        `mapstructure:"address" yaml:"address"`
	ReadTimeout  time.Duration `mapstructure:"read_timeout" yaml:"read_timeout"`
	WriteTimeout time.Duration `mapstructure:"write_timeout" yaml:"write_timeout"`
	CORSOrigins  []string      `mapstructure:"cors_origins" yaml:"cors_origins"`
	APIKey       string        `mapstructure:"api_key" yaml:"api_key,omitempty"`
}

type DatabaseConfig struct {
	Driver string `mapstructure:"driver" yaml:"driver"`
	DSN    string `mapstructure:"dsn" yaml:"dsn"`
}

type ProxmoxConfig struct {
	// Connections are loaded from ProxCenter's database
	ProxCenterDBPath string `mapstructure:"proxcenter_db_path" yaml:"proxcenter_db_path"`
	// APP_SECRET from ProxCenter to decrypt API tokens
	AppSecret      string        `mapstructure:"app_secret" yaml:"app_secret"`
	RequestTimeout time.Duration `mapstructure:"request_timeout" yaml:"request_timeout"`
	MaxRetries     int           `mapstructure:"max_retries" yaml:"max_retries"`
}

type DRSMode string

const (
	DRSModeManual    DRSMode = "manual"    // Only recommendations, no auto-migration
	DRSModePartial   DRSMode = "partial"   // Auto-migrate with thresholds
	DRSModeAutomatic DRSMode = "automatic" // Full automatic balancing
)

type BalancingMethod string

const (
	BalancingMethodMemory BalancingMethod = "memory"
	BalancingMethodCPU    BalancingMethod = "cpu"
	BalancingMethodDisk   BalancingMethod = "disk"
)

type BalancingMode string

const (
	BalancingModeUsed     BalancingMode = "used"     // Based on actual usage
	BalancingModeAssigned BalancingMode = "assigned" // Based on allocated resources
	BalancingModePSI      BalancingMode = "psi"      // Based on Pressure Stall Info (PVE 9+)
)

type DRSConfig struct {
	Enabled bool    `mapstructure:"enabled" yaml:"enabled"`
	Mode    DRSMode `mapstructure:"mode" yaml:"mode"`

	// Balancing configuration
	BalancingMethod BalancingMethod `mapstructure:"balancing_method" yaml:"balancing_method"`
	BalancingMode   BalancingMode   `mapstructure:"balancing_mode" yaml:"balancing_mode"`
	BalanceTypes    []string        `mapstructure:"balance_types" yaml:"balance_types"`

	// Node filtering
	MaintenanceNodes []string `mapstructure:"maintenance_nodes" yaml:"maintenance_nodes,omitempty"`
	IgnoreNodes      []string `mapstructure:"ignore_nodes" yaml:"ignore_nodes,omitempty"`

	// Thresholds (percentages)
	CPUHighThreshold     float64 `mapstructure:"cpu_high_threshold" yaml:"cpu_high_threshold"`
	CPULowThreshold      float64 `mapstructure:"cpu_low_threshold" yaml:"cpu_low_threshold"`
	MemoryHighThreshold  float64 `mapstructure:"memory_high_threshold" yaml:"memory_high_threshold"`
	MemoryLowThreshold   float64 `mapstructure:"memory_low_threshold" yaml:"memory_low_threshold"`
	StorageHighThreshold float64 `mapstructure:"storage_high_threshold" yaml:"storage_high_threshold"`
	
	// Proactive load balancing threshold (standard deviation)
	// When no nodes exceed high thresholds but stddev > this value, 
	// proactive balancing is triggered
	ImbalanceThreshold   float64 `mapstructure:"imbalance_threshold" yaml:"imbalance_threshold"`

	// Homogenization mode settings
	// When enabled, DRS actively works to equalize load across all nodes
	HomogenizationEnabled bool    `mapstructure:"homogenization_enabled" yaml:"homogenization_enabled"`
	// Maximum allowed spread between highest and lowest loaded nodes (percentage points)
	// If spread exceeds this, recommendations are generated to reduce it
	MaxLoadSpread         float64 `mapstructure:"max_load_spread" yaml:"max_load_spread"`
	// Target tolerance: stop recommending migrations when within this % of average
	TargetTolerance       float64 `mapstructure:"target_tolerance" yaml:"target_tolerance"`
	// Minimum improvement (in percentage points of spread reduction) to recommend a migration
	MinSpreadReduction    float64 `mapstructure:"min_spread_reduction" yaml:"min_spread_reduction"`

	// Balancing weights
	CPUWeight     float64 `mapstructure:"cpu_weight" yaml:"cpu_weight"`
	MemoryWeight  float64 `mapstructure:"memory_weight" yaml:"memory_weight"`
	StorageWeight float64 `mapstructure:"storage_weight" yaml:"storage_weight"`

	// Migration constraints
	MaxConcurrentMigrations int           `mapstructure:"max_concurrent_migrations" yaml:"max_concurrent_migrations"`
	MigrationCooldown       time.Duration `mapstructure:"migration_cooldown" yaml:"migration_cooldown"`
	MinVMUptimeForMigration time.Duration `mapstructure:"min_vm_uptime_for_migration" yaml:"min_vm_uptime_for_migration"`

	// Additional options
	BalanceLargerFirst      bool `mapstructure:"balance_larger_first" yaml:"balance_larger_first"`
	PreventOverprovisioning bool `mapstructure:"prevent_overprovisioning" yaml:"prevent_overprovisioning"`

	// Anti-affinity / Affinity rules
	EnableAffinityRules bool `mapstructure:"enable_affinity_rules" yaml:"enable_affinity_rules"`
	EnforceAffinity     bool `mapstructure:"enforce_affinity" yaml:"enforce_affinity"`
}

type SchedulerConfig struct {
	MetricsInterval    time.Duration `mapstructure:"metrics_interval" yaml:"metrics_interval"`
	DRSInterval        time.Duration `mapstructure:"drs_interval" yaml:"drs_interval"`
	RebalanceInterval  time.Duration `mapstructure:"rebalance_interval" yaml:"rebalance_interval"`
	EventPollInterval  time.Duration `mapstructure:"event_poll_interval" yaml:"event_poll_interval"`
}

func Load(path string) (*Config, error) {
	// Store the path for later saving
	ConfigPath = path
	
	viper.SetConfigFile(path)
	viper.SetConfigType("yaml")

	// Set defaults
	setDefaults()

	// Environment variable bindings
	viper.SetEnvPrefix("PROXCENTER")
	viper.AutomaticEnv()

	if err := viper.ReadInConfig(); err != nil {
		return nil, fmt.Errorf("failed to read config file: %w", err)
	}

	var cfg Config
	if err := viper.Unmarshal(&cfg); err != nil {
		return nil, fmt.Errorf("failed to unmarshal config: %w", err)
	}

	if err := cfg.Validate(); err != nil {
		return nil, fmt.Errorf("invalid configuration: %w", err)
	}

	return &cfg, nil
}

// Save persists the configuration to the YAML file
func (c *Config) Save() error {
	if ConfigPath == "" {
		return fmt.Errorf("config path not set")
	}
	
	data, err := yaml.Marshal(c)
	if err != nil {
		return fmt.Errorf("failed to marshal config: %w", err)
	}
	
	if err := os.WriteFile(ConfigPath, data, 0644); err != nil {
		return fmt.Errorf("failed to write config file: %w", err)
	}
	
	return nil
}

// SaveDRS saves only the DRS section to the config file
// This reads the current file, updates only the DRS section, and writes back
func SaveDRS(drsConfig DRSConfig) error {
	if ConfigPath == "" {
		return fmt.Errorf("config path not set")
	}
	
	// Read current config
	data, err := os.ReadFile(ConfigPath)
	if err != nil {
		return fmt.Errorf("failed to read config file: %w", err)
	}
	
	// Parse as generic map to preserve other sections
	var configMap map[string]interface{}
	if err := yaml.Unmarshal(data, &configMap); err != nil {
		return fmt.Errorf("failed to parse config: %w", err)
	}
	
	// Marshal DRS config to map
	drsData, err := yaml.Marshal(drsConfig)
	if err != nil {
		return fmt.Errorf("failed to marshal DRS config: %w", err)
	}
	
	var drsMap map[string]interface{}
	if err := yaml.Unmarshal(drsData, &drsMap); err != nil {
		return fmt.Errorf("failed to parse DRS config: %w", err)
	}
	
	// Update only DRS section
	configMap["drs"] = drsMap
	
	// Write back
	output, err := yaml.Marshal(configMap)
	if err != nil {
		return fmt.Errorf("failed to marshal config: %w", err)
	}
	
	if err := os.WriteFile(ConfigPath, output, 0644); err != nil {
		return fmt.Errorf("failed to write config file: %w", err)
	}
	
	return nil
}

// SaveNotifications saves only the notifications section to the config file
func SaveNotifications(notifConfig NotificationsConfig) error {
	if ConfigPath == "" {
		return fmt.Errorf("config path not set")
	}
	
	// Read current config
	data, err := os.ReadFile(ConfigPath)
	if err != nil {
		return fmt.Errorf("failed to read config file: %w", err)
	}
	
	// Parse as generic map to preserve other sections
	var configMap map[string]interface{}
	if err := yaml.Unmarshal(data, &configMap); err != nil {
		return fmt.Errorf("failed to parse config: %w", err)
	}
	
	// Marshal notifications config to map
	notifData, err := yaml.Marshal(notifConfig)
	if err != nil {
		return fmt.Errorf("failed to marshal notifications config: %w", err)
	}
	
	var notifMap map[string]interface{}
	if err := yaml.Unmarshal(notifData, &notifMap); err != nil {
		return fmt.Errorf("failed to parse notifications config: %w", err)
	}
	
	// Update only notifications section
	configMap["notifications"] = notifMap
	
	// Write back
	output, err := yaml.Marshal(configMap)
	if err != nil {
		return fmt.Errorf("failed to marshal config: %w", err)
	}
	
	if err := os.WriteFile(ConfigPath, output, 0644); err != nil {
		return fmt.Errorf("failed to write config file: %w", err)
	}
	
	return nil
}

func setDefaults() {
	// Log level default
	viper.SetDefault("log_level", "info") // debug, info, warn, error

	// API defaults
	viper.SetDefault("api.address", ":8080")
	viper.SetDefault("api.read_timeout", "30s")
	viper.SetDefault("api.write_timeout", "30s")
	viper.SetDefault("api.cors_origins", []string{"http://localhost:3000"})

	// Database defaults
	viper.SetDefault("database.driver", "sqlite")
	viper.SetDefault("database.dsn", "file:./data/orchestrator.db")

	// Proxmox defaults
	viper.SetDefault("proxmox.request_timeout", "30s")
	viper.SetDefault("proxmox.max_retries", 3)

	// DRS defaults
	viper.SetDefault("drs.enabled", true)
	viper.SetDefault("drs.mode", "manual")
	viper.SetDefault("drs.balancing_method", "memory")
	viper.SetDefault("drs.balancing_mode", "used")
	viper.SetDefault("drs.balance_types", []string{"vm", "ct"})
	viper.SetDefault("drs.maintenance_nodes", []string{})
	viper.SetDefault("drs.ignore_nodes", []string{})
	viper.SetDefault("drs.cpu_high_threshold", 80.0)
	viper.SetDefault("drs.cpu_low_threshold", 20.0)
	viper.SetDefault("drs.memory_high_threshold", 85.0)
	viper.SetDefault("drs.memory_low_threshold", 25.0)
	viper.SetDefault("drs.storage_high_threshold", 90.0)
	viper.SetDefault("drs.imbalance_threshold", 5.0) // Minimum stddev to trigger proactive balancing
	viper.SetDefault("drs.homogenization_enabled", true) // Enable homogenization mode by default
	viper.SetDefault("drs.max_load_spread", 10.0) // Max 10% spread between highest and lowest node
	viper.SetDefault("drs.target_tolerance", 3.0) // Consider balanced when within 3% of average
	viper.SetDefault("drs.min_spread_reduction", 2.0) // Require at least 2% spread reduction to recommend
	viper.SetDefault("drs.cpu_weight", 0.3)
	viper.SetDefault("drs.memory_weight", 1.0)
	viper.SetDefault("drs.storage_weight", 0.0)
	viper.SetDefault("drs.max_concurrent_migrations", 2)
	viper.SetDefault("drs.migration_cooldown", "5m")
	viper.SetDefault("drs.min_vm_uptime_for_migration", "10m")
	viper.SetDefault("drs.balance_larger_first", false)
	viper.SetDefault("drs.prevent_overprovisioning", true)
	viper.SetDefault("drs.enable_affinity_rules", true)
	viper.SetDefault("drs.enforce_affinity", false)

	// Scheduler defaults
	viper.SetDefault("scheduler.metrics_interval", "1m")
	viper.SetDefault("scheduler.drs_interval", "5m")
	viper.SetDefault("scheduler.rebalance_interval", "15m")
	viper.SetDefault("scheduler.event_poll_interval", "30s")

	// License defaults
	viper.SetDefault("license.file_path", "./data/license.key")

	// Notifications defaults
	viper.SetDefault("notifications.email.enabled", false)
	viper.SetDefault("notifications.email.smtp_port", 587)
	viper.SetDefault("notifications.email.smtp_from_name", "ProxCenter")
	viper.SetDefault("notifications.email.use_tls", false)
	viper.SetDefault("notifications.email.use_starttls", true)
	viper.SetDefault("notifications.email.skip_verify", false)
	viper.SetDefault("notifications.email.default_recipients", []string{})
	viper.SetDefault("notifications.enable_alerts", true)
	viper.SetDefault("notifications.enable_migrations", true)
	viper.SetDefault("notifications.enable_backups", true)
	viper.SetDefault("notifications.enable_maintenance", true)
	viper.SetDefault("notifications.enable_reports", true)
	viper.SetDefault("notifications.min_severity", "warning")
	viper.SetDefault("notifications.rate_limit_per_hour", 100)
}

func (c *Config) Validate() error {
	if c.DRS.CPUHighThreshold <= c.DRS.CPULowThreshold {
		return fmt.Errorf("cpu_high_threshold must be greater than cpu_low_threshold")
	}
	if c.DRS.MemoryHighThreshold <= c.DRS.MemoryLowThreshold {
		return fmt.Errorf("memory_high_threshold must be greater than memory_low_threshold")
	}
	if c.DRS.MaxConcurrentMigrations < 1 {
		return fmt.Errorf("max_concurrent_migrations must be at least 1")
	}
	return nil
}
