package events

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
	"gorm.io/gorm"

	"github.com/proxcenter/orchestrator/internal/alerts"
	"github.com/proxcenter/orchestrator/internal/proxmox"
)

// Task représente une tâche Proxmox
type Task struct {
	UPID      string `json:"upid"`
	Node      string `json:"node"`
	PID       int    `json:"pid"`
	PStart    int    `json:"pstart"`
	StartTime int64  `json:"starttime"`
	EndTime   int64  `json:"endtime,omitempty"`
	Type      string `json:"type"`
	ID        string `json:"id,omitempty"`
	User      string `json:"user"`
	Status    string `json:"status,omitempty"`
}

// ProcessedEvent représente un événement déjà traité (persisté en DB)
type ProcessedEvent struct {
	ID          string    `gorm:"primaryKey"`
	ProcessedAt time.Time `gorm:"index"`
}

// Poller récupère les événements Proxmox et les envoie au service d'alertes
type Poller struct {
	pve      *proxmox.Manager
	alerts   *alerts.Service
	db       *gorm.DB
	interval time.Duration

	// Cache mémoire pour éviter les requêtes DB répétées
	seenCache map[string]bool
	cacheMu   sync.RWMutex

	// Premier démarrage (table vide) - on marque tout comme vu sans notifier
	firstStartup bool

	stopChan chan struct{}
	wg       sync.WaitGroup
}

// NewPoller crée un nouveau poller d'événements
func NewPoller(pve *proxmox.Manager, alertService *alerts.Service, db *gorm.DB, interval time.Duration) *Poller {
	if interval < 10*time.Second {
		interval = 30 * time.Second
	}

	return &Poller{
		pve:       pve,
		alerts:    alertService,
		db:        db,
		interval:  interval,
		seenCache: make(map[string]bool),
		stopChan:  make(chan struct{}),
	}
}

// Start démarre le polling en arrière-plan
func (p *Poller) Start() {
	// Auto-migrate la table
	if err := p.db.AutoMigrate(&ProcessedEvent{}); err != nil {
		log.Error().Err(err).Msg("Failed to migrate ProcessedEvent table")
	}

	// Charger le cache depuis la DB (dernières 24h)
	p.loadCacheFromDB()

	p.wg.Add(1)
	go p.run()
	log.Info().Dur("interval", p.interval).Msg("Event poller started")
}

// Stop arrête le polling proprement
func (p *Poller) Stop() {
	close(p.stopChan)
	p.wg.Wait()
	log.Info().Msg("Event poller stopped")
}

// loadCacheFromDB charge les événements récents depuis la DB dans le cache mémoire
func (p *Poller) loadCacheFromDB() {
	cutoff := time.Now().Add(-7 * 24 * time.Hour) // Garder 7 jours
	var events []ProcessedEvent

	if err := p.db.Where("processed_at > ?", cutoff).Find(&events).Error; err != nil {
		log.Error().Err(err).Msg("Failed to load processed events from DB")
		return
	}

	p.cacheMu.Lock()
	for _, e := range events {
		p.seenCache[e.ID] = true
	}
	p.cacheMu.Unlock()

	log.Info().Int("count", len(events)).Msg("Loaded processed events from DB into cache")

	// Si la table est vide (premier démarrage), pré-remplir avec les tâches existantes
	// pour éviter d'envoyer des notifications pour tous les anciens événements
	if len(events) == 0 {
		log.Info().Msg("First startup detected - will mark existing tasks as seen to avoid notification flood")
		p.firstStartup = true
	}
}

func (p *Poller) run() {
	defer p.wg.Done()

	// Premier poll immédiat
	p.poll()

	ticker := time.NewTicker(p.interval)
	defer ticker.Stop()

	// Nettoyage de la DB toutes les 6 heures
	cleanupTicker := time.NewTicker(6 * time.Hour)
	defer cleanupTicker.Stop()

	for {
		select {
		case <-p.stopChan:
			return
		case <-ticker.C:
			p.poll()
		case <-cleanupTicker.C:
			p.cleanupOldEvents()
		}
	}
}

func (p *Poller) poll() {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	clients := p.pve.GetAllClients()
	if len(clients) == 0 {
		log.Debug().Msg("No Proxmox connections configured, skipping event poll")
		return
	}

	var allEvents []alerts.ProxmoxEvent

	for connID, client := range clients {
		tasks, err := p.getTasks(ctx, client)
		if err != nil {
			log.Warn().Err(err).Str("connection_id", connID).Msg("Failed to fetch tasks")
			continue
		}

		events := p.tasksToEvents(connID, tasks)
		allEvents = append(allEvents, events...)
	}

	if len(allEvents) == 0 {
		log.Debug().Msg("No new events to process")
		return
	}

	// Envoyer au service d'alertes
	if p.alerts != nil {
		if err := p.alerts.ProcessEvents(allEvents); err != nil {
			log.Error().Err(err).Int("count", len(allEvents)).Msg("Failed to process events")
		} else {
			log.Debug().Int("count", len(allEvents)).Msg("Events processed successfully")
		}
	}
}

// getTasks récupère les tâches récentes depuis Proxmox
func (p *Poller) getTasks(ctx context.Context, client *proxmox.Client) ([]Task, error) {
	// Essayer d'abord /cluster/tasks (pour les clusters)
	data, err := client.Request(ctx, "GET", "/cluster/tasks", nil)
	if err == nil {
		var tasks []Task
		if err := json.Unmarshal(data, &tasks); err == nil {
			return tasks, nil
		}
	}

	// Fallback: récupérer les tâches par nœud
	nodes, err := client.GetNodes(ctx)
	if err != nil {
		return nil, err
	}

	var allTasks []Task
	for _, node := range nodes {
		data, err := client.Request(ctx, "GET", fmt.Sprintf("/nodes/%s/tasks?limit=50", node.Node), nil)
		if err != nil {
			log.Warn().Err(err).Str("node", node.Node).Msg("Failed to fetch tasks for node")
			continue
		}

		var tasks []Task
		if err := json.Unmarshal(data, &tasks); err != nil {
			log.Warn().Err(err).Str("node", node.Node).Msg("Failed to parse tasks")
			continue
		}

		allTasks = append(allTasks, tasks...)
	}

	return allTasks, nil
}

// isEventSeen vérifie si un événement a déjà été traité
func (p *Poller) isEventSeen(id string) bool {
	p.cacheMu.RLock()
	seen := p.seenCache[id]
	p.cacheMu.RUnlock()
	return seen
}

// markEventSeen marque un événement comme traité (cache + DB)
func (p *Poller) markEventSeen(id string) {
	p.cacheMu.Lock()
	p.seenCache[id] = true
	p.cacheMu.Unlock()

	// Persister en DB de manière synchrone pour éviter les doublons
	p.db.Create(&ProcessedEvent{
		ID:          id,
		ProcessedAt: time.Now(),
	})
}

// tasksToEvents convertit les tâches Proxmox en événements pour le service d'alertes
func (p *Poller) tasksToEvents(connectionID string, tasks []Task) []alerts.ProxmoxEvent {
	var events []alerts.ProxmoxEvent

	for _, task := range tasks {
		// Skip si déjà traité (vérifie le cache mémoire chargé depuis la DB)
		if p.isEventSeen(task.UPID) {
			continue
		}

		// Marquer comme vu AVANT de traiter pour éviter les doublons
		p.markEventSeen(task.UPID)

		// Au premier démarrage, on marque tout comme vu mais on n'envoie pas de notifications
		if p.firstStartup {
			continue
		}

		// Déterminer le niveau
		level := "info"
		if task.Status != "" {
			if task.Status == "OK" {
				level = "info"
			} else if containsAny(task.Status, []string{"warning", "WARNINGS"}) {
				level = "warning"
			} else if task.Status != "" && task.Status != "running" {
				level = "error"
			}
		}

		message := formatTaskMessage(task)

		events = append(events, alerts.ProxmoxEvent{
			ID:           task.UPID,
			Timestamp:    time.Unix(task.StartTime, 0).Format(time.RFC3339),
			Level:        level,
			Category:     "task",
			Type:         task.Type,
			TypeLabel:    formatTaskType(task.Type),
			Entity:       task.ID,
			Node:         task.Node,
			User:         task.User,
			Status:       task.Status,
			Message:      message,
			ConnectionID: connectionID,
		})
	}

	return events
}

// cleanupOldEvents supprime les anciens événements de la DB (>7 jours)
func (p *Poller) cleanupOldEvents() {
	cutoff := time.Now().Add(-7 * 24 * time.Hour)

	result := p.db.Where("processed_at < ?", cutoff).Delete(&ProcessedEvent{})
	if result.Error != nil {
		log.Error().Err(result.Error).Msg("Failed to cleanup old processed events")
		return
	}

	// Recharger le cache depuis la DB
	p.cacheMu.Lock()
	p.seenCache = make(map[string]bool)
	p.cacheMu.Unlock()
	p.loadCacheFromDB()

	log.Info().Int64("deleted", result.RowsAffected).Msg("Cleaned up old processed events")
}

// Helpers

func containsAny(s string, substrs []string) bool {
	for _, substr := range substrs {
		if strings.Contains(strings.ToLower(s), strings.ToLower(substr)) {
			return true
		}
	}
	return false
}

func formatTaskType(t string) string {
	types := map[string]string{
		"qmstart":        "Démarrage VM",
		"qmstop":         "Arrêt VM",
		"qmshutdown":     "Arrêt VM (graceful)",
		"qmreboot":       "Redémarrage VM",
		"qmsuspend":      "Suspension VM",
		"qmresume":       "Reprise VM",
		"qmclone":        "Clone VM",
		"qmcreate":       "Création VM",
		"qmdestroy":      "Suppression VM",
		"qmmigrate":      "Migration VM",
		"qmrollback":     "Rollback VM",
		"qmsnapshot":     "Snapshot VM",
		"qmdelsnapshot":  "Suppression snapshot VM",
		"vzstart":        "Démarrage LXC",
		"vzstop":         "Arrêt LXC",
		"vzshutdown":     "Arrêt LXC (graceful)",
		"vzreboot":       "Redémarrage LXC",
		"vzsuspend":      "Suspension LXC",
		"vzresume":       "Reprise LXC",
		"vzcreate":       "Création LXC",
		"vzdestroy":      "Suppression LXC",
		"vzmigrate":      "Migration LXC",
		"vzdump":         "Backup",
		"qmbackup":       "Backup VM",
		"vzbackup":       "Backup LXC",
		"vncproxy":       "Console VNC",
		"vncshell":       "Console Shell",
		"spiceproxy":     "Console SPICE",
		"startall":       "Démarrage tous",
		"stopall":        "Arrêt tous",
		"aptupdate":      "Mise à jour APT",
		"imgcopy":        "Copie image",
		"download":       "Téléchargement",
		"srvreload":      "Rechargement service",
		"srvrestart":     "Redémarrage service",
		"cephcreateosd":  "Création OSD Ceph",
		"cephdestroyosd": "Suppression OSD Ceph",
	}

	if label, ok := types[t]; ok {
		return label
	}
	return t
}

func formatTaskMessage(task Task) string {
	typeLabel := formatTaskType(task.Type)

	if task.ID != "" {
		if task.Status != "" {
			return fmt.Sprintf("%s (%s) - %s", typeLabel, task.ID, task.Status)
		}
		return fmt.Sprintf("%s (%s) - En cours...", typeLabel, task.ID)
	}

	if task.Status != "" {
		return fmt.Sprintf("%s - %s", typeLabel, task.Status)
	}
	return fmt.Sprintf("%s - En cours...", typeLabel)
}
