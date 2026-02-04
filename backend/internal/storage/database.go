package storage

import (
	"encoding/json"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/proxcenter/orchestrator/internal/config"
)

// Database wraps the GORM database connection
type Database struct {
	db *gorm.DB
}

// Models

// RecommendationRecord represents a DRS recommendation in the database
type RecommendationRecord struct {
	ID           string    `gorm:"primaryKey"`
	ConnectionID string    `gorm:"index"`
	VMID         int       `gorm:"index"`
	VMName       string
	SourceNode   string
	TargetNode   string
	Reason       string
	Priority     int
	Score        float64
	Status       string    `gorm:"index"`
	CreatedAt    time.Time `gorm:"index"`
	UpdatedAt    time.Time
}

// MigrationRecord represents a migration in the database
type MigrationRecord struct {
	ID               string     `gorm:"primaryKey" json:"id"`
	RecommendationID string     `gorm:"index" json:"recommendation_id,omitempty"`
	ConnectionID     string     `gorm:"index" json:"connection_id"`
	VMID             int        `gorm:"index" json:"vmid"`
	VMName           string     `json:"vm_name"`
	GuestType        string     `json:"guest_type,omitempty"`
	SourceNode       string     `json:"source_node"`
	TargetNode       string     `json:"target_node"`
	TaskID           string     `json:"task_id"`
	Status           string     `gorm:"index" json:"status"`
	Error            string     `json:"error,omitempty"`
	StartedAt        time.Time  `gorm:"index" json:"started_at"`
	CompletedAt      *time.Time `json:"completed_at,omitempty"`
}

// AffinityRuleRecord represents an affinity rule in the database
type AffinityRuleRecord struct {
	ID           string `gorm:"primaryKey"`
	Name         string
	Type         string
	ConnectionID string `gorm:"index"`
	Enabled      bool
	Required     bool
	VMIDsJSON    string // JSON encoded []int
	NodesJSON    string // JSON encoded []string
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

// MetricsRecord stores historical metrics
type MetricsRecord struct {
	ID           uint      `gorm:"primaryKey"`
	ConnectionID string    `gorm:"index"`
	CollectedAt  time.Time `gorm:"index"`
	DataJSON     string    // JSON encoded ClusterMetrics
}

// NewDatabase creates a new database connection
func NewDatabase(cfg config.DatabaseConfig) (*Database, error) {
	// Add SQLite pragmas for better concurrency
	dsn := cfg.DSN
	if dsn != "" && !contains(dsn, "?") {
		dsn += "?_journal_mode=WAL&_busy_timeout=5000&_synchronous=NORMAL&_cache_size=10000"
	} else if dsn != "" {
		dsn += "&_journal_mode=WAL&_busy_timeout=5000&_synchronous=NORMAL&_cache_size=10000"
	}

	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Warn),
	})
	if err != nil {
		return nil, err
	}

	// Configure connection pool for SQLite
	sqlDB, err := db.DB()
	if err != nil {
		return nil, err
	}
	// SQLite works best with a single connection for writes
	sqlDB.SetMaxOpenConns(1)
	sqlDB.SetMaxIdleConns(1)
	sqlDB.SetConnMaxLifetime(0)

	// Auto migrate schemas
	if err := db.AutoMigrate(
		&RecommendationRecord{},
		&MigrationRecord{},
		&AffinityRuleRecord{},
		&MetricsRecord{},
	); err != nil {
		return nil, err
	}

	return &Database{db: db}, nil
}

// DB returns the underlying GORM database connection
func (d *Database) DB() *gorm.DB {
    return d.db
}

// Helper function
func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > 0 && containsImpl(s, substr))
}

func containsImpl(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}

// Recommendation methods

func (d *Database) SaveRecommendation(rec interface{}) error {
	// Type assertion based on what's passed in
	data, _ := json.Marshal(rec)
	var record RecommendationRecord
	json.Unmarshal(data, &record)
	record.UpdatedAt = time.Now()

	return d.db.Save(&record).Error
}

func (d *Database) UpdateRecommendationStatus(id, status string) error {
	return d.db.Model(&RecommendationRecord{}).
		Where("id = ?", id).
		Updates(map[string]interface{}{
			"status":     status,
			"updated_at": time.Now(),
		}).Error
}

func (d *Database) GetPendingRecommendations(connectionID string) ([]RecommendationRecord, error) {
	var records []RecommendationRecord
	err := d.db.Where("connection_id = ? AND status IN ?", connectionID, []string{"pending", "approved"}).
		Order("priority DESC, score DESC").
		Find(&records).Error
	return records, err
}

func (d *Database) GetRecommendationHistory(connectionID string, limit int) ([]RecommendationRecord, error) {
	var records []RecommendationRecord
	err := d.db.Where("connection_id = ?", connectionID).
		Order("created_at DESC").
		Limit(limit).
		Find(&records).Error
	return records, err
}

// Migration methods

func (d *Database) SaveMigration(migration interface{}) error {
	data, _ := json.Marshal(migration)
	var record MigrationRecord
	json.Unmarshal(data, &record)

	return d.db.Save(&record).Error
}

func (d *Database) UpdateMigrationStatus(id, status, errorMsg string) error {
	updates := map[string]interface{}{
		"status": status,
	}
	if errorMsg != "" {
		updates["error"] = errorMsg
	}
	if status == "completed" || status == "failed" {
		now := time.Now()
		updates["completed_at"] = &now
	}

	return d.db.Model(&MigrationRecord{}).Where("id = ?", id).Updates(updates).Error
}

func (d *Database) GetActiveMigrations() ([]MigrationRecord, error) {
	var records []MigrationRecord
	err := d.db.Where("status = ?", "running").Find(&records).Error
	return records, err
}

func (d *Database) GetMigrationHistory(connectionID string, limit int) ([]MigrationRecord, error) {
	var records []MigrationRecord
	err := d.db.Where("connection_id = ?", connectionID).
		Order("started_at DESC").
		Limit(limit).
		Find(&records).Error
	return records, err
}

func (d *Database) GetAllMigrations(limit int) ([]MigrationRecord, error) {
	var records []MigrationRecord
	err := d.db.Order("started_at DESC").
		Limit(limit).
		Find(&records).Error
	return records, err
}

// Affinity rule methods

func (d *Database) SaveAffinityRule(rule interface{}) error {
	data, _ := json.Marshal(rule)
	var record AffinityRuleRecord
	json.Unmarshal(data, &record)
	record.UpdatedAt = time.Now()

	return d.db.Save(&record).Error
}

func (d *Database) DeleteAffinityRule(id string) error {
	return d.db.Delete(&AffinityRuleRecord{}, "id = ?", id).Error
}

func (d *Database) GetAffinityRules(connectionID string) ([]AffinityRuleRecord, error) {
	var records []AffinityRuleRecord
	err := d.db.Where("connection_id = ?", connectionID).Find(&records).Error
	return records, err
}

func (d *Database) GetAllAffinityRules() ([]AffinityRuleRecord, error) {
	var records []AffinityRuleRecord
	err := d.db.Find(&records).Error
	return records, err
}

// Metrics methods

func (d *Database) SaveMetrics(metrics interface{}) error {
	data, _ := json.Marshal(metrics)
	
	// Extract connection ID and timestamp
	var m struct {
		ConnectionID string    `json:"connection_id"`
		CollectedAt  time.Time `json:"collected_at"`
	}
	json.Unmarshal(data, &m)

	record := MetricsRecord{
		ConnectionID: m.ConnectionID,
		CollectedAt:  m.CollectedAt,
		DataJSON:     string(data),
	}

	return d.db.Create(&record).Error
}

func (d *Database) GetMetricsHistory(connectionID string, from, to time.Time) ([]interface{}, error) {
	var records []MetricsRecord
	err := d.db.Where("connection_id = ? AND collected_at BETWEEN ? AND ?", connectionID, from, to).
		Order("collected_at DESC").
		Find(&records).Error
	if err != nil {
		return nil, err
	}

	// Parse JSON back to objects
	result := make([]interface{}, len(records))
	for i, record := range records {
		var metrics interface{}
		json.Unmarshal([]byte(record.DataJSON), &metrics)
		result[i] = metrics
	}

	return result, nil
}

// Cleanup old metrics (retention policy)
func (d *Database) CleanupOldMetrics(retentionDays int) error {
	cutoff := time.Now().AddDate(0, 0, -retentionDays)
	return d.db.Where("collected_at < ?", cutoff).Delete(&MetricsRecord{}).Error
}

// Close closes the database connection
func (d *Database) Close() error {
	sqlDB, err := d.db.DB()
	if err != nil {
		return err
	}
	return sqlDB.Close()
}


