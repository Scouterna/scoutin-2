// Command printer-proxy is the print relay daemon that runs on each desk's
// Raspberry Pi.
//
// It finds Zebra printers, tracks their status and shows it on the desk LEDs,
// honors the desk switch, and prints badges. With -server, jobs come from the
// scoutin server over /ws/print-relay; without it, from `printer-proxy print` on a
// local socket (see docs/printer-proxy-spec.md).
package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"path/filepath"
	"sync"
	"syscall"
	"time"

	"github.com/Scouterna/scoutin-2/printer-proxy/internal/cloud"
	"github.com/Scouterna/scoutin-2/printer-proxy/internal/config"
	"github.com/Scouterna/scoutin-2/printer-proxy/internal/desk"
	"github.com/Scouterna/scoutin-2/printer-proxy/internal/enroll"
	"github.com/Scouterna/scoutin-2/printer-proxy/internal/hw"
	"github.com/Scouterna/scoutin-2/printer-proxy/internal/journal"
	"github.com/Scouterna/scoutin-2/printer-proxy/internal/printer"
	"github.com/Scouterna/scoutin-2/printer-proxy/internal/sdnotify"
)

const (
	scanInterval = time.Second
	// The device node lingers for up to ~2 s after a printer is unplugged or
	// switched off. Don't start a new watcher for it during that window, or
	// its port would flash "connecting" before going back to offline.
	goneCooldown = 3 * time.Second
	frameRate    = 40 * time.Millisecond
	startupChase = 1500 * time.Millisecond
)

// version is set at build time: -ldflags "-X main.version=…".
var version = "dev"

// source is where jobs come from, and where printer news goes: the server, or
// the local print socket.
type source interface {
	attach(dev printer.Device, port int) (chan *printer.Job, chan *printer.Action)
	detach(serial string, ch chan *printer.Job)
	report(printer.Update)
	result(printer.Result)
	config(serial string, settings map[string]string)
	actionDone(printer.ActionResult)
	inhibitChanged()
}

func setupLog(debug bool) {
	level := slog.LevelInfo
	if debug {
		level = slog.LevelDebug
	}
	opts := &slog.HandlerOptions{Level: level}
	if os.Getenv("JOURNAL_STREAM") != "" {
		// journald timestamps every line itself.
		opts.ReplaceAttr = func(groups []string, a slog.Attr) slog.Attr {
			if a.Key == slog.TimeKey && len(groups) == 0 {
				return slog.Attr{}
			}
			return a
		}
	}
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, opts)))
}

func main() {
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "print":
			os.Exit(printCmd(os.Args[2:]))
		case "version":
			fmt.Println(version)
			return
		case "check-config":
			// printer-proxy check-config [path]: exit 1 on a bad config.
			path := config.DefaultPath
			if len(os.Args) > 2 {
				path = os.Args[2]
			}
			cfg, err := config.Load(path, true)
			if err != nil {
				fmt.Fprintln(os.Stderr, "printer-proxy:", err)
				os.Exit(1)
			}
			mode := "local-only"
			if cfg.Server != "" {
				mode = "cloud, server " + cfg.Server
			}
			fmt.Printf("%s: OK (%s)\n", path, mode)
			return
		case "update":
			os.Exit(updateCmd(os.Args[2:]))
		}
	}

	def := config.Defaults()
	configPath := flag.String("config", config.DefaultPath, "config file; flags given explicitly override it")
	stateDir := flag.String("state-dir", "/var/lib/printer-proxy", "persistent state (key, journal)")
	server := flag.String("server", "", "scoutin server URL, e.g. https://scoutin.example.se; empty = local-only")
	control := flag.String("control", defaultControl, "local print socket (local-only mode)")
	ledsOn := flag.Bool("leds", def.LEDs.Enabled, "drive the desk LEDs")
	spiDev := flag.String("spi", def.LEDs.SPI, "LED SPI device")
	brightness := flag.Float64("brightness", def.LEDs.Brightness, "LED brightness (0-1)")
	gamma := flag.Float64("gamma", 2.8, "LED gamma correction")
	switchOn := flag.Bool("switch", def.Switch.Enabled, "read the desk switch")
	gpioChip := flag.String("gpio-chip", "/dev/gpiochip0", "GPIO chip")
	switchGPIO := flag.Int("switch-gpio", def.Switch.GPIO, "desk switch GPIO (BCM number)")
	debug := flag.Bool("debug", false, "verbose logging")
	flag.Parse()

	setupLog(*debug)

	// Config file first, then any flag given explicitly on top.
	set := map[string]bool{}
	flag.Visit(func(f *flag.Flag) { set[f.Name] = true })
	cfg, err := config.Load(*configPath, set["config"])
	if err != nil {
		slog.Error("not starting: bad config", "err", err)
		os.Exit(1)
	}
	if set["server"] {
		cfg.Server = *server
	}
	if set["leds"] {
		cfg.LEDs.Enabled = *ledsOn
	}
	if set["spi"] {
		cfg.LEDs.SPI = *spiDev
	}
	if set["brightness"] {
		cfg.LEDs.Brightness = *brightness
	}
	if set["switch"] {
		cfg.Switch.Enabled = *switchOn
	}
	if set["switch-gpio"] {
		cfg.Switch.GPIO = *switchGPIO
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	lock, err := lockStateDir(*stateDir)
	if err != nil {
		slog.Error("not starting", "err", err)
		os.Exit(1)
	}
	defer lock.Close()

	jr, err := journal.Open(filepath.Join(*stateDir, "journal"))
	if err != nil {
		// Printing without a journal could duplicate badges after a crash.
		slog.Error("cannot open journal", "err", err)
		os.Exit(1)
	}

	ports := hw.Pi3BPlusPorts
	if len(cfg.LEDs.PortMap) > 0 {
		ports = hw.PortMap(cfg.LEDs.PortMap)
	}
	nLEDs := 0
	for _, led := range ports {
		nLEDs = max(nLEDs, led+1)
	}
	d := desk.New(nLEDs)
	var wg sync.WaitGroup

	var src source
	mode := "local-only"
	if cfg.Server != "" {
		mode = "cloud"
		hostname, _ := os.Hostname()
		cj := newCloudJobs(d, jr, hostname)
		src = cj
		en := &enroll.Enroller{
			Server: cfg.Server, StateDir: *stateDir, Hostname: hostname,
			Printers: func() []cloud.PrinterInfo { return attachedPrinters(ports) },
			Show: func(e enroll.Enrollment) {
				if err := d.SetCode(e.Colors); err != nil {
					slog.Error("cannot show pairing code on the LEDs", "err", err)
				}
			},
			Clear: d.ClearCode,
		}
		wg.Add(2)
		go func() {
			defer wg.Done()
			runCloud(ctx, cfg.Server, filepath.Join(*stateDir, "key"), en, cj)
		}()
		go func() {
			defer wg.Done()
			cj.heartbeat(ctx)
		}()
	} else {
		js := newJobs(d, jr)
		src = js
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := serveControl(ctx, *control, js); err != nil {
				slog.Error("local print socket disabled", "err", err)
			}
		}()
	}

	if cfg.LEDs.Enabled {
		strip, err := hw.OpenStrip(cfg.LEDs.SPI, hw.StripOptions{Brightness: cfg.LEDs.Brightness, Gamma: *gamma})
		if err != nil {
			slog.Error("LEDs disabled", "err", err)
		} else {
			wg.Add(1)
			go func() {
				defer wg.Done()
				runLEDs(ctx, strip, d, nLEDs)
			}()
		}
	}

	if cfg.Switch.Enabled {
		in, err := hw.OpenInput(*gpioChip, cfg.Switch.GPIO, true, "printer-proxy")
		if err != nil {
			slog.Error("desk switch disabled", "err", err)
		} else {
			wg.Add(1)
			go func() {
				defer wg.Done()
				defer in.Close()
				// Low = closed = inhibit. A missing or broken switch reads high
				// (pull-up), so printing continues: it fails open by design.
				first := true
				err := in.Watch(ctx, 50*time.Millisecond, func(high bool) {
					slog.Info("desk switch", "inhibit", !high)
					d.SetInhibited(!high)
					src.inhibitChanged()
					// Switching to pause also clears ports still showing a
					// printer that has gone away (e.g. unplugged on purpose).
					// Switching back to print doesn't.
					if !first && !high {
						d.ClearOffline()
					}
					first = false
				})
				if err != nil {
					slog.Error("desk switch stopped", "err", err)
				}
			}()
		}
	}

	slog.Info("printer-proxy started", "mode", mode, "version", version, "config", *configPath)
	sdnotify.Ready()
	runDiscovery(ctx, d, ports, jr, src)
	sdnotify.Stopping()
	wg.Wait()
	slog.Info("printer-proxy stopped")
}

// runDiscovery starts a watcher for every Zebra printer that appears, one at a
// time per serial number, until ctx is done.
func runDiscovery(ctx context.Context, d *desk.Desk, ports hw.PortMap, jr *journal.Dir, src source) {
	var mu sync.Mutex
	active := map[string]bool{}
	goneAt := map[string]time.Time{}
	var wg sync.WaitGroup
	defer wg.Wait()

	for {
		// The discovery loop is the relay's heartbeat: if it stops turning,
		// systemd's watchdog restarts the service (WatchdogSec).
		sdnotify.Watchdog()
		for _, dev := range printer.Scan() {
			mu.Lock()
			skip := active[dev.Serial] || time.Since(goneAt[dev.Serial]) < goneCooldown
			if !skip {
				active[dev.Serial] = true
			}
			mu.Unlock()
			if skip {
				continue
			}

			led, ok := ports.LEDFor(dev.USBPath)
			port := 0 // unknown
			if ok {
				port = led + 1
			}
			slog.Info("printer found", "serial", dev.Serial, "product", dev.Product, "usb", dev.USBPath, "port", port)

			ch, actions := src.attach(dev, port)
			wg.Add(1)
			go func() {
				defer wg.Done()
				printer.Watch(ctx, dev, printer.Hooks{
					Journal: jr,
					Jobs:    ch,
					Actions: actions,
					Report: func(u printer.Update) {
						slog.Info("printer state", "serial", u.Device.Serial, "port", port, "state", u.State, "detail", u.Detail)
						if ok {
							d.SetPrinter(led, u.Device.Serial, u.State)
						}
						src.report(u)
					},
					Result:     src.result,
					Config:     src.config,
					ActionDone: src.actionDone,
				})
				src.detach(dev.Serial, ch)
				mu.Lock()
				delete(active, dev.Serial)
				goneAt[dev.Serial] = time.Now()
				mu.Unlock()
			}()
		}

		select {
		case <-ctx.Done():
			return
		case <-time.After(scanInterval):
		}
	}
}

func runLEDs(ctx context.Context, strip *hw.Strip, d *desk.Desk, n int) {
	defer strip.Close()
	defer func() {
		// Off on shutdown, except ahead of a power-off: then the last frame,
		// "safe to unplug", has to stay lit after the Pi halts.
		if d.Halting() {
			frame, _ := d.Frame(time.Now())
			strip.Show(frame)
			return
		}
		strip.Show(make([]hw.RGB, n))
	}()

	start := time.Now()
	tick := time.NewTicker(frameRate)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case t := <-tick.C:
			frame, full := d.Frame(t)
			if t.Sub(start) < startupChase {
				frame, full = desk.Startup(n, t), false
			}
			var err error
			if full {
				err = strip.ShowAt(frame, 1)
			} else {
				err = strip.Show(frame)
			}
			if err != nil {
				slog.Error("LED write failed", "err", err)
			}
		}
	}
}
