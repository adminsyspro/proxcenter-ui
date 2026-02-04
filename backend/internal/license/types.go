package license

import (
	"time"
)

// Edition represents the license edition
type Edition string

const (
	EditionCommunity  Edition = "community"
	EditionEnterprise Edition = "enterprise"
)

// Feature represents a licensable feature
type Feature string

const (
	FeatureDRS                   Feature = "drs"
	FeatureFirewall              Feature = "firewall"
	FeatureMicrosegmentation     Feature = "microsegmentation"
	FeatureRollingUpdates        Feature = "rolling_updates"
	FeatureAIInsights            Feature = "ai_insights"
	FeaturePredictiveAlerts      Feature = "predictive_alerts"
	FeatureGreenMetrics          Feature = "green_metrics"
	FeatureCrossClusterMigration Feature = "cross_cluster_migration"
	FeatureCephReplication       Feature = "ceph_replication"
	FeatureLDAP                  Feature = "ldap"
	FeatureReports               Feature = "reports"
)

// AllEnterpriseFeatures contains all features available in Enterprise edition
var AllEnterpriseFeatures = []Feature{
	FeatureDRS,
	FeatureFirewall,
	FeatureMicrosegmentation,
	FeatureRollingUpdates,
	FeatureAIInsights,
	FeaturePredictiveAlerts,
	FeatureGreenMetrics,
	FeatureCrossClusterMigration,
	FeatureCephReplication,
	FeatureLDAP,
	FeatureReports,
}

// Customer contains customer information
type Customer struct {
	Name  string `json:"name"`
	Email string `json:"email"`
}

// Limits contains license usage limits
type Limits struct {
	MaxNodes       int `json:"max_nodes"`
	MaxVMs         int `json:"max_vms"`
	MaxConnections int `json:"max_connections"`
}

// LicensePayload is the JSON structure embedded in the license file
type LicensePayload struct {
	LicenseID string    `json:"license_id"`
	Edition   Edition   `json:"edition"`
	Customer  Customer  `json:"customer"`
	Features  []Feature `json:"features"`
	Limits    Limits    `json:"limits"`
	IssuedAt  time.Time `json:"issued_at"`
	ExpiresAt time.Time `json:"expires_at"`
}

// License represents a parsed and validated license
type License struct {
	Payload   LicensePayload
	Raw       string
	Valid     bool
	Signature []byte
}

// HasFeature checks if the license includes a specific feature
func (l *License) HasFeature(feature Feature) bool {
	if l == nil || !l.Valid {
		return false
	}
	for _, f := range l.Payload.Features {
		if f == feature {
			return true
		}
	}
	return false
}

// IsExpired checks if the license has expired
func (l *License) IsExpired() bool {
	if l == nil {
		return true
	}
	return time.Now().After(l.Payload.ExpiresAt)
}

// IsEnterprise checks if the license is an enterprise license
func (l *License) IsEnterprise() bool {
	if l == nil || !l.Valid {
		return false
	}
	return l.Payload.Edition == EditionEnterprise
}

// DaysUntilExpiration returns the number of days until the license expires
func (l *License) DaysUntilExpiration() int {
	if l == nil {
		return 0
	}
	duration := time.Until(l.Payload.ExpiresAt)
	return int(duration.Hours() / 24)
}

// LicenseStatus is the API response for license status
type LicenseStatus struct {
	Licensed       bool      `json:"licensed"`
	Edition        Edition   `json:"edition"`
	LicenseID      string    `json:"license_id,omitempty"`
	Customer       *Customer `json:"customer,omitempty"`
	Features       []Feature `json:"features"`
	Limits         *Limits   `json:"limits,omitempty"`
	IssuedAt       string    `json:"issued_at,omitempty"`
	ExpiresAt      string    `json:"expires_at,omitempty"`
	DaysRemaining  int       `json:"days_remaining,omitempty"`
	Expired        bool      `json:"expired"`
	ExpirationWarn bool      `json:"expiration_warn"`
}

// ToStatus converts a License to a LicenseStatus for API responses
func (l *License) ToStatus() LicenseStatus {
	if l == nil || !l.Valid {
		return LicenseStatus{
			Licensed: false,
			Edition:  EditionCommunity,
			Features: []Feature{},
			Expired:  false,
		}
	}

	daysRemaining := l.DaysUntilExpiration()
	return LicenseStatus{
		Licensed:       true,
		Edition:        l.Payload.Edition,
		LicenseID:      l.Payload.LicenseID,
		Customer:       &l.Payload.Customer,
		Features:       l.Payload.Features,
		Limits:         &l.Payload.Limits,
		IssuedAt:       l.Payload.IssuedAt.Format(time.RFC3339),
		ExpiresAt:      l.Payload.ExpiresAt.Format(time.RFC3339),
		DaysRemaining:  daysRemaining,
		Expired:        l.IsExpired(),
		ExpirationWarn: daysRemaining > 0 && daysRemaining <= 30,
	}
}

// ActivateRequest is the request body for license activation
type ActivateRequest struct {
	License string `json:"license"`
}

// ActivateResponse is the response for license activation
type ActivateResponse struct {
	Success bool          `json:"success"`
	Status  LicenseStatus `json:"status,omitempty"`
	Error   string        `json:"error,omitempty"`
}

// ErrorResponse is a standard error response
type ErrorResponse struct {
	Error   string `json:"error"`
	Code    string `json:"code"`
	Feature string `json:"feature,omitempty"`
}

// Error codes
const (
	ErrCodeLicenseRequired = "LICENSE_REQUIRED"
	ErrCodeLicenseExpired  = "LICENSE_EXPIRED"
	ErrCodeLicenseInvalid  = "LICENSE_INVALID"
	ErrCodeFeatureRequired = "FEATURE_REQUIRED"
)
