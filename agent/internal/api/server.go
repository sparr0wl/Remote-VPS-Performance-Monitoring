package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"remote-vps-monitor/agent/internal/config"
	"remote-vps-monitor/agent/internal/system"
)

type Server struct {
	cfg    config.Config
	runner system.Runner
	mux    *http.ServeMux
}

func New(cfg config.Config) *Server {
	s := &Server{
		cfg:    cfg,
		runner: system.Runner{UseSudo: cfg.UseSudo},
		mux:    http.NewServeMux(),
	}
	s.routes()
	return s
}

func (s *Server) Handler() http.Handler {
	return s.withCORS(s.withAuth(s.mux))
}

func (s *Server) routes() {
	s.mux.HandleFunc("GET /api/health", s.health)
	s.mux.HandleFunc("GET /api/metrics", s.metrics)
	s.mux.HandleFunc("POST /api/power", s.power)

	s.mux.HandleFunc("GET /api/services", s.services)
	s.mux.HandleFunc("GET /api/services/{name}", s.serviceStatus)
	s.mux.HandleFunc("POST /api/services/{name}/action", s.serviceAction)
	s.mux.HandleFunc("GET /api/services/{name}/logs", s.serviceLogs)

	s.mux.HandleFunc("GET /api/firewall", s.firewall)
	s.mux.HandleFunc("POST /api/firewall/ufw", s.ufw)
	s.mux.HandleFunc("POST /api/firewall/iptables", s.iptables)

	s.mux.HandleFunc("GET /api/integrations", s.integrations)
	s.mux.HandleFunc("GET /api/integrations/{id}", s.integration)
	s.mux.HandleFunc("POST /api/integrations/{id}/action", s.integrationAction)
	s.mux.HandleFunc("GET /api/integrations/{id}/logs", s.integrationLogs)
	s.mux.HandleFunc("GET /api/integrations/{id}/config", s.integrationConfig)
	s.mux.HandleFunc("POST /api/integrations/{id}/config", s.integrationConfigWrite)
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "time": time.Now().UTC()})
}

func (s *Server) metrics(w http.ResponseWriter, _ *http.Request) {
	metrics, err := system.CollectMetrics()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, metrics)
}

func (s *Server) power(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Action string `json:"action"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	switch req.Action {
	case "reboot":
		result, err := s.runner.Run(r.Context(), 5*time.Second, "reboot")
		writeCommand(w, result, err)
	case "shutdown":
		result, err := s.runner.Run(r.Context(), 5*time.Second, "shutdown", "-h", "now")
		writeCommand(w, result, err)
	default:
		writeError(w, http.StatusBadRequest, errors.New("unsupported power action"))
	}
}

func (s *Server) services(w http.ResponseWriter, r *http.Request) {
	services, err := system.ListServices(r.Context(), s.runner)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, services)
}

func (s *Server) serviceStatus(w http.ResponseWriter, r *http.Request) {
	service, err := system.ServiceStatus(r.Context(), s.runner, r.PathValue("name"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, service)
}

func (s *Server) serviceAction(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Action string `json:"action"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	result, err := system.ServiceAction(r.Context(), s.runner, r.PathValue("name"), req.Action)
	writeCommand(w, result, err)
}

func (s *Server) serviceLogs(w http.ResponseWriter, r *http.Request) {
	logs, err := system.ServiceLogs(r.Context(), s.runner, r.PathValue("name"), queryLines(r, s.cfg.LogLinesDefault))
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeLogs(w, r, r.PathValue("name")+".log", logs)
}

func (s *Server) firewall(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, system.Firewall(r.Context(), s.runner))
}

func (s *Server) ufw(w http.ResponseWriter, r *http.Request) {
	var req system.UFWRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	result, err := system.UFWAction(r.Context(), s.runner, req)
	writeCommand(w, result, err)
}

func (s *Server) iptables(w http.ResponseWriter, r *http.Request) {
	var req system.IPTablesRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	result, err := system.IPTablesAction(r.Context(), s.runner, req)
	writeCommand(w, result, err)
}

func (s *Server) integrations(w http.ResponseWriter, r *http.Request) {
	items := []system.Integration{
		system.DetectIntegration(r.Context(), s.runner, s.caddySpec()),
		system.DetectIntegration(r.Context(), s.runner, s.xraySpec()),
	}
	writeJSON(w, http.StatusOK, items)
}

func (s *Server) integration(w http.ResponseWriter, r *http.Request) {
	spec, ok := s.integrationSpec(r.PathValue("id"))
	if !ok {
		writeError(w, http.StatusNotFound, errors.New("unknown integration"))
		return
	}
	writeJSON(w, http.StatusOK, system.DetectIntegration(r.Context(), s.runner, spec))
}

func (s *Server) integrationAction(w http.ResponseWriter, r *http.Request) {
	spec, ok := s.integrationSpec(r.PathValue("id"))
	if !ok {
		writeError(w, http.StatusNotFound, errors.New("unknown integration"))
		return
	}
	var req struct {
		Action string `json:"action"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	result, err := system.IntegrationAction(r.Context(), s.runner, spec, req.Action)
	writeCommand(w, result, err)
}

func (s *Server) integrationLogs(w http.ResponseWriter, r *http.Request) {
	spec, ok := s.integrationSpec(r.PathValue("id"))
	if !ok {
		writeError(w, http.StatusNotFound, errors.New("unknown integration"))
		return
	}
	logs, err := system.ServiceLogs(r.Context(), s.runner, spec.ServiceName, queryLines(r, s.cfg.LogLinesDefault))
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeLogs(w, r, spec.ID+".log", logs)
}

func (s *Server) integrationConfig(w http.ResponseWriter, r *http.Request) {
	spec, ok := s.integrationSpec(r.PathValue("id"))
	if !ok {
		writeError(w, http.StatusNotFound, errors.New("unknown integration"))
		return
	}
	file, err := system.ReadConfigFile(configPath(spec))
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, file)
}

func (s *Server) integrationConfigWrite(w http.ResponseWriter, r *http.Request) {
	spec, ok := s.integrationSpec(r.PathValue("id"))
	if !ok {
		writeError(w, http.StatusNotFound, errors.New("unknown integration"))
		return
	}
	var req struct {
		Content string `json:"content"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	result, err := system.WriteValidatedConfig(r.Context(), s.runner, configPath(spec), s.cfg.BackupDir, req.Content, spec.Validate)
	if err != nil {
		writeErrorWithData(w, http.StatusBadRequest, err, result)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) caddySpec() system.IntegrationSpec {
	return system.IntegrationSpec{
		ID:          "caddy",
		Name:        "Caddy",
		Binary:      "caddy",
		ServiceName: s.cfg.CaddyService,
		ConfigPath:  s.cfg.CaddyConfig,
		Validate:    system.CaddyValidate,
		Reload:      true,
	}
}

func (s *Server) xraySpec() system.IntegrationSpec {
	return system.IntegrationSpec{
		ID:          "xray",
		Name:        "Xray",
		Binary:      "xray",
		ServiceName: s.cfg.XrayService,
		ConfigPath:  s.cfg.XrayConfig,
		ConfigAlt:   s.cfg.XrayConfigAlt,
		Validate:    system.XrayValidate,
		Reload:      false,
	}
}

func (s *Server) integrationSpec(id string) (system.IntegrationSpec, bool) {
	switch id {
	case "caddy":
		return s.caddySpec(), true
	case "xray":
		return s.xraySpec(), true
	default:
		return system.IntegrationSpec{}, false
	}
}

func configPath(spec system.IntegrationSpec) string {
	return system.ResolveIntegrationConfig(spec)
}

func (s *Server) withAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			next.ServeHTTP(w, r)
			return
		}
		auth := r.Header.Get("Authorization")
		if auth != "Bearer "+s.cfg.APIToken {
			writeError(w, http.StatusUnauthorized, errors.New("unauthorized"))
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func decodeJSON(w http.ResponseWriter, r *http.Request, target any) bool {
	defer r.Body.Close()
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return false
	}
	return true
}

func writeCommand(w http.ResponseWriter, result system.CommandResult, err error) {
	if err != nil {
		writeErrorWithData(w, http.StatusBadRequest, err, result)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func writeLogs(w http.ResponseWriter, r *http.Request, name, logs string) {
	if r.URL.Query().Get("download") == "1" {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("Content-Disposition", `attachment; filename="`+strings.ReplaceAll(name, `"`, "")+`"`)
		_, _ = w.Write([]byte(logs))
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"logs": logs})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, err error) {
	writeErrorWithData(w, status, err, nil)
}

func writeErrorWithData(w http.ResponseWriter, status int, err error, data any) {
	writeJSON(w, status, map[string]any{
		"error": err.Error(),
		"data":  data,
	})
}

func queryLines(r *http.Request, fallback int) int {
	value := r.URL.Query().Get("lines")
	if value == "" {
		return fallback
	}
	n, err := strconv.Atoi(value)
	if err != nil || n < 1 {
		return fallback
	}
	if n > 5000 {
		return 5000
	}
	return n
}
