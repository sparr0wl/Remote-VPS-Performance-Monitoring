package main

import (
	"flag"
	"log"
	"net/http"
	"time"

	"remote-vps-monitor/agent/internal/api"
	"remote-vps-monitor/agent/internal/config"
)

func main() {
	configPath := flag.String("config", "/etc/vps-monitor/config.yaml", "path to config file")
	flag.Parse()

	cfg, err := config.Load(*configPath)
	if err != nil {
		log.Fatalf("load config: %v", err)
	}

	server := &http.Server{
		Addr:              cfg.Listen,
		Handler:           api.New(cfg).Handler(),
		ReadHeaderTimeout: 5 * time.Second,
	}

	log.Printf("vps monitor agent listening on %s", cfg.Listen)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("http server: %v", err)
	}
}
