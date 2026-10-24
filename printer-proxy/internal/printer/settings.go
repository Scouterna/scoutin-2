package printer

import (
	"errors"
	"fmt"
	"maps"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/Scouterna/scoutin-2/printer-proxy/internal/zebra"
)

// ConfigKeys are the settings read on every connect and reported to the
// server (spec §8.9): what identifies the printer, what rendering needs, and
// everything a profile is expected to set.
var ConfigKeys = []string{
	// Identity and hardware.
	"device.product_name",
	"appl.name", // firmware
	"head.resolution.in_dpi",
	"power.power_on_mode", // read-only on the ZD421
	// Rendering.
	"ezpl.print_width",
	"zpl.label_length",
	// Media and print quality.
	"ezpl.media_type",
	"media.sense_mode",
	"media.type",
	"ezpl.print_method",
	"ezpl.print_mode",
	"media.backfeed",
	"ezpl.tear_off",
	"print.tone",
	"media.speed",
	"power.energy_star.enable",
	"ezpl.head_close_action",
	"ezpl.power_up_action",
	// Interfaces.
	"internal_wired.enable",
	"wlan.enable",
	"bluetooth.enable",
	"usb.mirror.auto",
	"device.languages",
}

// Action kinds (spec §13.4).
const (
	ApplyProfile = "applyProfile"
	Calibrate    = "calibrate"
	CancelBuffer = "cancelBuffer"
)

// Action is a maintenance action from admin. It only runs while the printer is
// idle; the printer takes no job until it's done.
type Action struct {
	ID       string
	Kind     string
	Settings map[string]string // the profile, for ApplyProfile
}

type ActionResult struct {
	ID      string
	Serial  string
	OK      bool
	Results map[string]SettingResult // ApplyProfile only
	// Restart: the printer is restarting to apply a setting. It goes offline
	// briefly and reconnects with a fresh printer:config.
	Restart bool
	Error   string
}

type SettingResult struct {
	Applied bool   `json:"applied"`
	Value   string `json:"value"`
}

// sameValue compares settings the way the printer reports them: "15" and
// "15.0" are the same darkness, and replies can carry trailing spaces.
func sameValue(a, b string) bool {
	a, b = strings.TrimSpace(a), strings.TrimSpace(b)
	if strings.EqualFold(a, b) {
		return true
	}
	x, err1 := strconv.ParseFloat(a, 64)
	y, err2 := strconv.ParseFloat(b, 64)
	return err1 == nil && err2 == nil && x == y
}

// needsRestart lists settings that only take effect after a printer restart.
func needsRestart(key string) bool {
	for _, p := range []string{"internal_wired.", "wlan.", "bluetooth.", "ip.", "device.languages"} {
		if strings.HasPrefix(key, p) {
			return true
		}
	}
	return false
}

// readConfig reads the given settings. Settings this printer doesn't have are
// left out.
func (w *watcher) readConfig(keys []string) (map[string]string, error) {
	out := map[string]string{}
	for _, k := range keys {
		v, err := w.conn.GetVar(k, replyTimeout)
		if errors.Is(err, zebra.ErrUnknownVar) {
			continue
		}
		if err != nil {
			return out, err
		}
		out[k] = strings.TrimSpace(v)
	}
	return out, nil
}

// idleForActions: states in which a maintenance action may run (spec §8.9).
func idleForActions(s State) bool {
	return s == Ready || s == Paused || s == MediaOut || s == HeadOpen
}

// runAction carries out one action. An error means the printer stopped
// answering mid-action; the result has been sent either way.
func (w *watcher) runAction(a *Action) error {
	log := w.log.With("action", a.ID, "kind", a.Kind)
	res := ActionResult{ID: a.ID, Serial: w.dev.Serial}
	var err error
	switch a.Kind {
	case CancelBuffer:
		err = w.conn.Send("~JA")
	case Calibrate:
		err = w.calibrate()
	case ApplyProfile:
		res.Results, res.Restart, err = w.applyProfile(a.Settings)
	default:
		res.Error = "unknown action kind: " + a.Kind
	}
	if err != nil {
		res.Error = err.Error()
	}
	res.OK = res.Error == ""
	if res.Results != nil {
		for _, r := range res.Results {
			if !r.Applied {
				res.OK = false
			}
		}
	}
	log.Info("action finished", "ok", res.OK, "restart", res.Restart, "error", res.Error)

	if a.Kind == ApplyProfile && err == nil {
		// Report the settings as they are now, including any profile keys
		// outside the usual list.
		keys := slices.Sorted(maps.Keys(a.Settings))
		for _, k := range ConfigKeys {
			if !slices.Contains(keys, k) {
				keys = append(keys, k)
			}
		}
		if cfg, cerr := w.readConfig(keys); cerr == nil {
			w.h.Config(w.dev.Serial, cfg)
		}
	}
	// The result goes out before a restart: the restart disconnects the printer
	// from USB.
	w.h.ActionDone(res)
	if res.Restart {
		log.Info("restarting printer to apply settings")
		if err := w.conn.Do("device.reset", ""); err != nil {
			return err
		}
	}
	return err
}

// applyProfile sets every profile setting that differs and reads each one
// back. Read-only settings come back as not applied and aren't retried.
func (w *watcher) applyProfile(settings map[string]string) (map[string]SettingResult, bool, error) {
	results := map[string]SettingResult{}
	restart := false
	for _, k := range slices.Sorted(maps.Keys(settings)) {
		want := settings[k]
		cur, err := w.conn.GetVar(k, replyTimeout)
		if errors.Is(err, zebra.ErrUnknownVar) {
			results[k] = SettingResult{Applied: false}
			continue
		}
		if err != nil {
			return results, false, err
		}
		if sameValue(cur, want) {
			results[k] = SettingResult{Applied: true, Value: strings.TrimSpace(cur)}
			continue
		}
		if err := w.conn.SetVar(k, want); err != nil {
			return results, false, err
		}
		got, err := w.conn.GetVar(k, replyTimeout)
		if err != nil {
			return results, false, err
		}
		ok := sameValue(got, want)
		results[k] = SettingResult{Applied: ok, Value: strings.TrimSpace(got)}
		w.log.Info("setting changed", "key", k, "from", strings.TrimSpace(cur), "to", want, "now", strings.TrimSpace(got), "applied", ok)
		if ok && needsRestart(k) {
			restart = true
		}
	}
	return results, restart, nil
}

// Calibration timings. How the printer's status looks while it calibrates
// hasn't been observed yet (SPIKE), so it waits a minimum, then for the state
// to hold steady.
const (
	calibrateMin    = 3 * time.Second
	calibrateMax    = 60 * time.Second
	calibrateSteady = 3 // polls in a row with the same, non-printing state
)

// calibrate runs media calibration (~JC). It moves media.
func (w *watcher) calibrate() error {
	if err := w.conn.Send("~JC"); err != nil {
		return err
	}
	start := time.Now()
	var last State
	steady := 0
	for time.Since(start) < calibrateMax {
		time.Sleep(jobPoll)
		st, detail, err := poll(w.conn)
		if err != nil {
			return err
		}
		if st == last && st != Printing {
			steady++
		} else {
			steady = 0
		}
		last = st
		if time.Since(start) >= calibrateMin && steady >= calibrateSteady {
			w.log.Info("calibration done", "after", time.Since(start).Round(100*time.Millisecond), "state", st, "detail", detail)
			return nil
		}
	}
	return fmt.Errorf("calibration didn't finish within %s", calibrateMax)
}
