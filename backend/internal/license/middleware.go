package license

import (
	"encoding/json"
	"net/http"
)

// Middleware provides HTTP middleware for license enforcement
type Middleware struct {
	validator *Validator
}

// NewMiddleware creates a new license middleware
func NewMiddleware(validator *Validator) *Middleware {
	return &Middleware{
		validator: validator,
	}
}

// RequireLicense returns middleware that requires any valid license
func (m *Middleware) RequireLicense(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !m.validator.IsLicensed() {
			m.respondLicenseError(w, ErrCodeLicenseRequired, "A valid license is required for this feature", "")
			return
		}

		license := m.validator.GetLicense()
		if license.IsExpired() {
			m.respondLicenseError(w, ErrCodeLicenseExpired, "Your license has expired", "")
			return
		}

		next.ServeHTTP(w, r)
	})
}

// RequireEnterprise returns middleware that requires an enterprise license
func (m *Middleware) RequireEnterprise(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !m.validator.IsLicensed() {
			m.respondLicenseError(w, ErrCodeLicenseRequired, "An enterprise license is required for this feature", "")
			return
		}

		license := m.validator.GetLicense()
		if license.IsExpired() {
			m.respondLicenseError(w, ErrCodeLicenseExpired, "Your license has expired", "")
			return
		}

		if !license.IsEnterprise() {
			m.respondLicenseError(w, ErrCodeLicenseRequired, "An enterprise license is required for this feature", "")
			return
		}

		next.ServeHTTP(w, r)
	})
}

// RequireFeature returns middleware that requires a specific feature
func (m *Middleware) RequireFeature(feature Feature) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !m.validator.IsLicensed() {
				m.respondLicenseError(w, ErrCodeFeatureRequired, "This feature requires a license", string(feature))
				return
			}

			license := m.validator.GetLicense()
			if license.IsExpired() {
				m.respondLicenseError(w, ErrCodeLicenseExpired, "Your license has expired", string(feature))
				return
			}

			if !license.HasFeature(feature) {
				m.respondLicenseError(w, ErrCodeFeatureRequired, "Your license does not include this feature", string(feature))
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// respondLicenseError sends a standardized license error response
func (m *Middleware) respondLicenseError(w http.ResponseWriter, code, message, feature string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusForbidden)
	json.NewEncoder(w).Encode(ErrorResponse{
		Error:   message,
		Code:    code,
		Feature: feature,
	})
}

// InjectLicenseStatus is middleware that adds license info to response headers
// This allows the frontend to check license status without extra API calls
func (m *Middleware) InjectLicenseStatus(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		status := m.validator.GetStatus()

		// Add license info to response headers
		w.Header().Set("X-License-Edition", string(status.Edition))
		if status.Licensed {
			w.Header().Set("X-License-Valid", "true")
			if status.Expired {
				w.Header().Set("X-License-Expired", "true")
			}
			if status.ExpirationWarn {
				w.Header().Set("X-License-Expiration-Warn", "true")
			}
		} else {
			w.Header().Set("X-License-Valid", "false")
		}

		next.ServeHTTP(w, r)
	})
}
