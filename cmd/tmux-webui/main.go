package main

import (
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"tmux-webui/internal/server"
)

func main() {
	listen := flag.String("listen", "127.0.0.1:7681", "HTTP listen address")
	tmuxBin := flag.String("tmux", "tmux", "path to the tmux executable")
	allowRemote := flag.Bool("allow-remote", false, "allow listening on a non-loopback address (no built-in authentication)")
	flag.Parse()

	if _, err := exec.LookPath(*tmuxBin); err != nil {
		fmt.Fprintf(os.Stderr, "tmux-webui: tmux executable not found: %v\n", err)
		os.Exit(1)
	}
	if !*allowRemote && !isLoopbackListenAddress(*listen) {
		fmt.Fprintln(os.Stderr, "tmux-webui: refusing a non-loopback listen address without --allow-remote")
		fmt.Fprintln(os.Stderr, "tmux-webui: use SSH port forwarding for remote access; see README.md")
		os.Exit(2)
	}

	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{}))
	handler := server.New(*tmuxBin, logger)
	httpServer := &http.Server{
		Addr:              *listen,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	shutdown := make(chan os.Signal, 1)
	signal.Notify(shutdown, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-shutdown
		logger.Info("shutting down")
		_ = httpServer.Close()
	}()

	logger.Info("tmux web UI is ready", "url", "http://"+displayAddress(*listen))
	if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		logger.Error("server stopped", "error", err)
		os.Exit(1)
	}
}

func isLoopbackListenAddress(address string) bool {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return false
	}
	host = strings.Trim(host, "[]")
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func displayAddress(address string) string {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return address
	}
	if host == "" || host == "0.0.0.0" || host == "::" {
		host = "127.0.0.1"
	}
	return net.JoinHostPort(host, port)
}
