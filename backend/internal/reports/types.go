package reports

import (
	"time"
)

// ReportType represents the type of report
type ReportType string

const (
	ReportTypeInfrastructure ReportType = "infrastructure"
	ReportTypeAlerts         ReportType = "alerts"
	ReportTypeUtilization    ReportType = "utilization"
	ReportTypeInventory      ReportType = "inventory"
	ReportTypeCapacity       ReportType = "capacity"
)

// AllReportTypes contains all available report types
var AllReportTypes = []ReportType{
	ReportTypeInfrastructure,
	ReportTypeAlerts,
	ReportTypeUtilization,
	ReportTypeInventory,
	ReportTypeCapacity,
}

// ReportStatus represents the status of a report
type ReportStatus string

const (
	ReportStatusPending    ReportStatus = "pending"
	ReportStatusGenerating ReportStatus = "generating"
	ReportStatusCompleted  ReportStatus = "completed"
	ReportStatusFailed     ReportStatus = "failed"
)

// Frequency represents the schedule frequency
type Frequency string

const (
	FrequencyDaily   Frequency = "daily"
	FrequencyWeekly  Frequency = "weekly"
	FrequencyMonthly Frequency = "monthly"
)

// ReportSections defines available sections per report type
var ReportSections = map[ReportType][]string{
	ReportTypeInfrastructure: {"summary", "clusters", "nodes", "vms", "storage"},
	ReportTypeAlerts:         {"summary", "active", "history", "statistics", "trends"},
	ReportTypeUtilization:    {"summary", "cpu", "memory", "storage", "network", "trends"},
	ReportTypeInventory:      {"summary", "vms", "containers", "templates", "specs"},
	ReportTypeCapacity:       {"summary", "current", "predictions", "recommendations"},
}

// ReportRecord represents a generated report stored in the database
type ReportRecord struct {
	ID            string       `json:"id" gorm:"primaryKey"`
	Type          ReportType   `json:"type" gorm:"index"`
	Name          string       `json:"name"`
	Status        ReportStatus `json:"status" gorm:"index"`
	FilePath      string       `json:"file_path,omitempty"`
	FileSize      int64        `json:"file_size,omitempty"`
	DateFrom      time.Time    `json:"date_from"`
	DateTo        time.Time    `json:"date_to"`
	ConnectionIDs []string     `json:"connection_ids" gorm:"serializer:json"`
	Sections      []string     `json:"sections" gorm:"serializer:json"`
	Language      string       `json:"language" gorm:"default:en"`
	ScheduleID    *string      `json:"schedule_id,omitempty" gorm:"index"`
	GeneratedBy   string       `json:"generated_by"`
	Error         string       `json:"error,omitempty"`
	CreatedAt     time.Time    `json:"created_at"`
	UpdatedAt     time.Time    `json:"updated_at"`
	CompletedAt   *time.Time   `json:"completed_at,omitempty"`
}

// TableName specifies the table name for ReportRecord
func (ReportRecord) TableName() string {
	return "reports"
}

// ReportSchedule represents a scheduled report configuration
type ReportSchedule struct {
	ID            string     `json:"id" gorm:"primaryKey"`
	Name          string     `json:"name"`
	Enabled       bool       `json:"enabled" gorm:"default:true"`
	Type          ReportType `json:"type"`
	Frequency     Frequency  `json:"frequency"`
	DayOfWeek     int        `json:"day_of_week,omitempty"`  // 0-6 (Sunday-Saturday) for weekly
	DayOfMonth    int        `json:"day_of_month,omitempty"` // 1-31 for monthly
	TimeOfDay     string     `json:"time_of_day"`            // "HH:MM" format
	ConnectionIDs []string   `json:"connection_ids" gorm:"serializer:json"`
	Sections      []string   `json:"sections" gorm:"serializer:json"`
	Recipients    []string   `json:"recipients" gorm:"serializer:json"`
	Language      string     `json:"language" gorm:"default:en"`
	LastRunAt     *time.Time `json:"last_run_at,omitempty"`
	NextRunAt     *time.Time `json:"next_run_at,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
}

// TableName specifies the table name for ReportSchedule
func (ReportSchedule) TableName() string {
	return "report_schedules"
}

// GenerateReportRequest is the request body for generating a report
type GenerateReportRequest struct {
	Type          ReportType `json:"type"`
	Name          string     `json:"name,omitempty"`
	DateFrom      string     `json:"date_from"` // RFC3339 or YYYY-MM-DD
	DateTo        string     `json:"date_to"`   // RFC3339 or YYYY-MM-DD
	ConnectionIDs []string   `json:"connection_ids,omitempty"`
	Sections      []string   `json:"sections,omitempty"`
	Language      string     `json:"language,omitempty"` // en, fr - defaults to en
}

// CreateScheduleRequest is the request body for creating a schedule
type CreateScheduleRequest struct {
	Name          string     `json:"name"`
	Type          ReportType `json:"type"`
	Frequency     Frequency  `json:"frequency"`
	DayOfWeek     int        `json:"day_of_week,omitempty"`
	DayOfMonth    int        `json:"day_of_month,omitempty"`
	TimeOfDay     string     `json:"time_of_day"` // "HH:MM"
	ConnectionIDs []string   `json:"connection_ids,omitempty"`
	Sections      []string   `json:"sections,omitempty"`
	Recipients    []string   `json:"recipients"`
	Language      string     `json:"language,omitempty"` // en, fr - defaults to en
}

// UpdateScheduleRequest is the request body for updating a schedule
type UpdateScheduleRequest struct {
	Name          *string    `json:"name,omitempty"`
	Enabled       *bool      `json:"enabled,omitempty"`
	Type          *ReportType `json:"type,omitempty"`
	Frequency     *Frequency `json:"frequency,omitempty"`
	DayOfWeek     *int       `json:"day_of_week,omitempty"`
	DayOfMonth    *int       `json:"day_of_month,omitempty"`
	TimeOfDay     *string    `json:"time_of_day,omitempty"`
	ConnectionIDs []string   `json:"connection_ids,omitempty"`
	Sections      []string   `json:"sections,omitempty"`
	Recipients    []string   `json:"recipients,omitempty"`
	Language      *string    `json:"language,omitempty"`
}

// ReportTypeInfo provides metadata about a report type
type ReportTypeInfo struct {
	Type        ReportType `json:"type"`
	Name        string     `json:"name"`
	Description string     `json:"description"`
	Sections    []SectionInfo `json:"sections"`
}

// SectionInfo provides metadata about a report section
type SectionInfo struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

// GetReportTypeInfos returns metadata for all report types
func GetReportTypeInfos() []ReportTypeInfo {
	return []ReportTypeInfo{
		{
			Type:        ReportTypeInfrastructure,
			Name:        "Infrastructure Report",
			Description: "Overview of clusters, nodes, VMs, and storage",
			Sections: []SectionInfo{
				{ID: "summary", Name: "Executive Summary", Description: "High-level infrastructure overview"},
				{ID: "clusters", Name: "Clusters", Description: "Cluster status and configuration"},
				{ID: "nodes", Name: "Nodes", Description: "Node details and health"},
				{ID: "vms", Name: "Virtual Machines", Description: "VM inventory and status"},
				{ID: "storage", Name: "Storage", Description: "Storage pools and usage"},
			},
		},
		{
			Type:        ReportTypeAlerts,
			Name:        "Alerts Report",
			Description: "Alert history, statistics, and trends",
			Sections: []SectionInfo{
				{ID: "summary", Name: "Executive Summary", Description: "Alert overview and key metrics"},
				{ID: "active", Name: "Active Alerts", Description: "Currently active alerts"},
				{ID: "history", Name: "Alert History", Description: "Historical alerts"},
				{ID: "statistics", Name: "Statistics", Description: "Alert statistics by type and severity"},
				{ID: "trends", Name: "Trends", Description: "Alert trends over time"},
			},
		},
		{
			Type:        ReportTypeUtilization,
			Name:        "Utilization Report",
			Description: "Resource utilization metrics and trends",
			Sections: []SectionInfo{
				{ID: "summary", Name: "Executive Summary", Description: "Overall utilization overview"},
				{ID: "cpu", Name: "CPU Utilization", Description: "CPU usage across resources"},
				{ID: "memory", Name: "Memory Utilization", Description: "Memory usage across resources"},
				{ID: "storage", Name: "Storage Utilization", Description: "Storage usage and growth"},
				{ID: "network", Name: "Network Utilization", Description: "Network traffic metrics"},
				{ID: "trends", Name: "Trends", Description: "Utilization trends over time"},
			},
		},
		{
			Type:        ReportTypeInventory,
			Name:        "Inventory Report",
			Description: "Complete inventory of VMs, containers, and templates",
			Sections: []SectionInfo{
				{ID: "summary", Name: "Executive Summary", Description: "Inventory overview"},
				{ID: "vms", Name: "Virtual Machines", Description: "Complete VM list with specifications"},
				{ID: "containers", Name: "Containers", Description: "LXC container inventory"},
				{ID: "templates", Name: "Templates", Description: "Available VM and CT templates"},
				{ID: "specs", Name: "Specifications", Description: "Hardware specifications summary"},
			},
		},
		{
			Type:        ReportTypeCapacity,
			Name:        "Capacity Report",
			Description: "Capacity planning with predictions and recommendations",
			Sections: []SectionInfo{
				{ID: "summary", Name: "Executive Summary", Description: "Capacity overview"},
				{ID: "current", Name: "Current Capacity", Description: "Current resource allocation"},
				{ID: "predictions", Name: "Predictions", Description: "Capacity growth predictions"},
				{ID: "recommendations", Name: "Recommendations", Description: "Capacity planning recommendations"},
			},
		},
	}
}
