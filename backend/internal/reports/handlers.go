package reports

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog/log"
)

// Handler provides HTTP handlers for reports
type Handler struct {
	service *Service
}

// NewHandler creates a new reports handler
func NewHandler(service *Service) *Handler {
	return &Handler{
		service: service,
	}
}

// RegisterRoutes registers report routes on the router
func (h *Handler) RegisterRoutes(r chi.Router) {
	r.Route("/reports", func(r chi.Router) {
		// Reports CRUD
		r.Get("/", h.handleListReports)
		r.Post("/", h.handleGenerateReport)
		r.Get("/types", h.handleGetReportTypes)
		r.Get("/languages", h.handleGetLanguages)

		r.Route("/{id}", func(r chi.Router) {
			r.Get("/", h.handleGetReport)
			r.Delete("/", h.handleDeleteReport)
			r.Get("/download", h.handleDownloadReport)
		})

		// Schedules CRUD
		r.Route("/schedules", func(r chi.Router) {
			r.Get("/", h.handleListSchedules)
			r.Post("/", h.handleCreateSchedule)

			r.Route("/{id}", func(r chi.Router) {
				r.Get("/", h.handleGetSchedule)
				r.Put("/", h.handleUpdateSchedule)
				r.Delete("/", h.handleDeleteSchedule)
				r.Post("/run", h.handleRunScheduleNow)
			})
		})
	})
}

// ==========================================
// Report Handlers
// ==========================================

// handleListReports lists all reports with pagination
func (h *Handler) handleListReports(w http.ResponseWriter, r *http.Request) {
	// Parse query params
	limit := 50
	offset := 0

	if l := r.URL.Query().Get("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil && parsed > 0 {
			limit = parsed
		}
	}
	if o := r.URL.Query().Get("offset"); o != "" {
		if parsed, err := strconv.Atoi(o); err == nil && parsed >= 0 {
			offset = parsed
		}
	}

	var reportType *ReportType
	if t := r.URL.Query().Get("type"); t != "" {
		rt := ReportType(t)
		reportType = &rt
	}

	var status *ReportStatus
	if s := r.URL.Query().Get("status"); s != "" {
		rs := ReportStatus(s)
		status = &rs
	}

	reports, total, err := h.service.ListReports(limit, offset, reportType, status)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"data":   reports,
		"total":  total,
		"limit":  limit,
		"offset": offset,
	})
}

// handleGenerateReport starts report generation
func (h *Handler) handleGenerateReport(w http.ResponseWriter, r *http.Request) {
	var req GenerateReportRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body: "+err.Error())
		return
	}

	// Get user from context or header
	generatedBy := r.Header.Get("X-User-ID")
	if generatedBy == "" {
		generatedBy = "api"
	}

	report, err := h.service.GenerateReport(r.Context(), req, generatedBy)
	if err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}

	log.Info().
		Str("report_id", report.ID).
		Str("type", string(report.Type)).
		Str("generated_by", generatedBy).
		Msg("Report generation started")

	respondJSON(w, http.StatusAccepted, report)
}

// handleGetReport returns a single report
func (h *Handler) handleGetReport(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	report, err := h.service.GetReport(id)
	if err != nil {
		respondError(w, http.StatusNotFound, "Report not found")
		return
	}

	respondJSON(w, http.StatusOK, report)
}

// handleDeleteReport deletes a report
func (h *Handler) handleDeleteReport(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	if err := h.service.DeleteReport(id); err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	log.Info().Str("report_id", id).Msg("Report deleted")

	respondJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// handleDownloadReport streams the PDF file
func (h *Handler) handleDownloadReport(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	filePath, err := h.service.GetReportFilePath(id)
	if err != nil {
		respondError(w, http.StatusNotFound, err.Error())
		return
	}

	// Open file
	file, err := os.Open(filePath)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to open report file")
		return
	}
	defer file.Close()

	// Get file info
	info, err := file.Stat()
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to get file info")
		return
	}

	// Get report for filename
	report, _ := h.service.GetReport(id)
	filename := filepath.Base(filePath)
	if report != nil {
		filename = GenerateFileName(report)
	}

	// Set headers
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", "attachment; filename=\""+filename+"\"")
	w.Header().Set("Content-Length", strconv.FormatInt(info.Size(), 10))
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")

	// Stream file
	if _, err := io.Copy(w, file); err != nil {
		log.Error().Err(err).Str("report_id", id).Msg("Failed to stream report file")
	}
}

// handleGetReportTypes returns available report types and sections
func (h *Handler) handleGetReportTypes(w http.ResponseWriter, r *http.Request) {
	types := GetReportTypeInfos()
	respondJSON(w, http.StatusOK, types)
}

// handleGetLanguages returns available languages
func (h *Handler) handleGetLanguages(w http.ResponseWriter, r *http.Request) {
	languages := SupportedLanguages()
	respondJSON(w, http.StatusOK, languages)
}

// ==========================================
// Schedule Handlers
// ==========================================

// handleListSchedules lists all schedules
func (h *Handler) handleListSchedules(w http.ResponseWriter, r *http.Request) {
	schedules, err := h.service.ListSchedules()
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, schedules)
}

// handleCreateSchedule creates a new schedule
func (h *Handler) handleCreateSchedule(w http.ResponseWriter, r *http.Request) {
	var req CreateScheduleRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body: "+err.Error())
		return
	}

	schedule, err := h.service.CreateSchedule(req)
	if err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}

	respondJSON(w, http.StatusCreated, schedule)
}

// handleGetSchedule returns a single schedule
func (h *Handler) handleGetSchedule(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	schedule, err := h.service.GetSchedule(id)
	if err != nil {
		respondError(w, http.StatusNotFound, "Schedule not found")
		return
	}

	respondJSON(w, http.StatusOK, schedule)
}

// handleUpdateSchedule updates a schedule
func (h *Handler) handleUpdateSchedule(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	var req UpdateScheduleRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body: "+err.Error())
		return
	}

	schedule, err := h.service.UpdateSchedule(id, req)
	if err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, schedule)
}

// handleDeleteSchedule deletes a schedule
func (h *Handler) handleDeleteSchedule(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	if err := h.service.DeleteSchedule(id); err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	log.Info().Str("schedule_id", id).Msg("Schedule deleted")

	respondJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// handleRunScheduleNow runs a schedule immediately
func (h *Handler) handleRunScheduleNow(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	report, err := h.service.RunScheduleNow(id)
	if err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}

	log.Info().
		Str("schedule_id", id).
		Str("report_id", report.ID).
		Msg("Schedule run manually")

	respondJSON(w, http.StatusAccepted, report)
}

// ==========================================
// Helper Functions
// ==========================================

func respondJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func respondError(w http.ResponseWriter, status int, message string) {
	respondJSON(w, status, map[string]string{"error": message})
}
