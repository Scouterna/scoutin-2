package main

import (
	"context"
	"errors"
	"flag"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/Scouterna/scoutin-2/printer-proxy/internal/config"
	"github.com/Scouterna/scoutin-2/printer-proxy/internal/update"
)

// updateCmd is `printer-proxy update` (spec §8.10): install the version the
// server expects, if it isn't the current one. systemd runs it as root before
// every start and ignores its exit code, so a failure never stops printing.
func updateCmd(args []string) int {
	fs := flag.NewFlagSet("update", flag.ExitOnError)
	configPath := fs.String("config", config.DefaultPath, "config file")
	prefix := fs.String("prefix", "/opt/printer-proxy", "install root")
	fs.Parse(args)
	setupLog(false)

	cfg, err := config.Load(*configPath, true)
	if err != nil {
		slog.Error("update: bad config", "err", err)
		return 1
	}
	if cfg.Server == "" {
		slog.Info("update: skipped, local-only mode")
		return 0
	}
	if !cfg.AutoUpdate {
		slog.Info("update: skipped, autoUpdate is off")
		return 0
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	rel, changed, err := update.New(cfg.Server, *prefix).Run(ctx)
	switch {
	case errors.Is(err, update.ErrNoVersion):
		slog.Info("update: skipped, the server names no version")
	case err != nil:
		slog.Error("update failed, starting the installed version", "err", err)
		return 1
	case changed:
		slog.Info("update: installed", "version", rel.Version)
	default:
		slog.Info("update: up to date", "version", rel.Version)
	}
	return 0
}
