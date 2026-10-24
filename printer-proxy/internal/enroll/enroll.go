// Package enroll pairs a relay that has no key with the server (spec §12): it
// gets a color code, shows it, and waits for staff to enter it in admin.
package enroll

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"math/rand/v2"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"time"

	"github.com/Scouterna/scoutin-2/printer-proxy/internal/cloud"
)

// Timings, see the spec (§12).
const (
	retryMin = 2 * time.Second
	retryMax = 60 * time.Second
)

// PollInterval is how often the relay asks whether it's been paired. A
// variable for tests.
var PollInterval = 5 * time.Second

// Request is POST /api/print-relays/enroll.
type Request struct {
	Hostname string              `json:"hostname"`
	Printers []cloud.PrinterInfo `json:"printers"`
}

// Enrollment is the server's reply, kept in enrollment.json so a restart shows
// the same code.
type Enrollment struct {
	ID     string   `json:"enrollmentId"`
	Secret string   `json:"secret"`
	Colors []string `json:"colors"`
	Code   string   `json:"code"`
}

// Status is GET /api/print-relays/enroll/:id.
type Status struct {
	Status string `json:"status"` // "pending" | "paired"
	Key    string `json:"key,omitempty"`
}

// Enroller runs the pairing. Show and Clear drive the LEDs; Printers lists
// what's attached right now, so admin can tell which Pi it's pairing.
type Enroller struct {
	Server   string
	StateDir string
	Hostname string
	Printers func() []cloud.PrinterInfo
	Show     func(e Enrollment)
	Clear    func()
	HTTP     *http.Client
}

// errGone: the server doesn't know this enrollment (expired, or the secret
// doesn't match). Start over with a new code.
var errGone = errors.New("enrollment gone")

func (e *Enroller) client() *http.Client {
	if e.HTTP != nil {
		return e.HTTP
	}
	return &http.Client{Timeout: 15 * time.Second}
}

func (e *Enroller) path(name string) string { return filepath.Join(e.StateDir, name) }

// Run blocks until the relay is paired, then stores the key and returns it.
func (e *Enroller) Run(ctx context.Context) (string, error) {
	enrollURL, err := url.JoinPath(e.Server, "/api/print-relays/enroll")
	if err != nil {
		return "", err
	}
	defer e.Clear()
	retry := retryMin
	wait := func() bool {
		d := retry/2 + time.Duration(rand.Int64N(int64(retry)))
		retry = min(retry*2, retryMax)
		select {
		case <-ctx.Done():
			return false
		case <-time.After(d):
			return true
		}
	}

	for ctx.Err() == nil {
		en, err := e.load()
		if err != nil {
			slog.Warn("enrollment file unreadable; starting over", "err", err)
			os.Remove(e.path("enrollment.json"))
		}
		if en == nil {
			if en, err = e.start(ctx, enrollURL); err != nil {
				slog.Warn("cannot start enrollment", "err", err)
				if !wait() {
					break
				}
				continue
			}
		}
		retry = retryMin
		e.Show(*en)
		slog.Info("waiting to be paired: enter this code in admin", "colors", en.Colors, "code", en.Code)

		key, err := e.await(ctx, enrollURL, en)
		if errors.Is(err, errGone) {
			slog.Info("enrollment expired or unknown; starting over")
			os.Remove(e.path("enrollment.json"))
			continue
		}
		if err != nil {
			break // ctx done
		}
		if err := writeFile(e.path("key"), []byte(key+"\n"), 0o600); err != nil {
			return "", fmt.Errorf("store relay key: %w", err)
		}
		os.Remove(e.path("enrollment.json"))
		slog.Info("paired")
		return key, nil
	}
	return "", ctx.Err()
}

func (e *Enroller) load() (*Enrollment, error) {
	b, err := os.ReadFile(e.path("enrollment.json"))
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var en Enrollment
	if err := json.Unmarshal(b, &en); err != nil || en.ID == "" || en.Secret == "" {
		return nil, fmt.Errorf("bad enrollment.json: %v", err)
	}
	return &en, nil
}

// start asks the server for a new enrollment and stores it.
func (e *Enroller) start(ctx context.Context, enrollURL string) (*Enrollment, error) {
	body, _ := json.Marshal(Request{Hostname: e.Hostname, Printers: e.Printers()})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, enrollURL, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := e.client().Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		msg, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("enroll: HTTP %d: %s", resp.StatusCode, bytes.TrimSpace(msg))
	}
	var en Enrollment
	if err := json.NewDecoder(resp.Body).Decode(&en); err != nil {
		return nil, fmt.Errorf("enroll: %w", err)
	}
	if en.ID == "" || en.Secret == "" || len(en.Colors) == 0 {
		return nil, errors.New("enroll: incomplete reply")
	}
	b, _ := json.Marshal(en)
	if err := writeFile(e.path("enrollment.json"), b, 0o600); err != nil {
		return nil, err
	}
	return &en, nil
}

// await polls until paired. Network trouble just means polling on; only an
// unknown enrollment ends it early.
func (e *Enroller) await(ctx context.Context, enrollURL string, en *Enrollment) (string, error) {
	statusURL, err := url.JoinPath(enrollURL, en.ID)
	if err != nil {
		return "", err
	}
	for {
		st, err := e.poll(ctx, statusURL, en.Secret)
		switch {
		case errors.Is(err, errGone):
			return "", err
		case err != nil:
			slog.Warn("enrollment poll failed", "err", err)
		case st.Status == "paired" && st.Key != "":
			return st.Key, nil
		}
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-time.After(PollInterval):
		}
	}
}

func (e *Enroller) poll(ctx context.Context, statusURL, secret string) (Status, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, statusURL, nil)
	if err != nil {
		return Status{}, err
	}
	req.Header.Set("Authorization", "Bearer "+secret)
	resp, err := e.client().Do(req)
	if err != nil {
		return Status{}, err
	}
	defer resp.Body.Close()
	switch resp.StatusCode {
	case http.StatusOK:
	case http.StatusNotFound, http.StatusUnauthorized:
		return Status{}, errGone
	default:
		return Status{}, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	var st Status
	err = json.NewDecoder(resp.Body).Decode(&st)
	return st, err
}

// writeFile replaces a file atomically and durably, with the given mode.
func writeFile(name string, data []byte, mode os.FileMode) error {
	dir := filepath.Dir(name)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, filepath.Base(name)+".*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if err := tmp.Chmod(mode); err != nil {
		tmp.Close()
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmp.Name(), name); err != nil {
		return err
	}
	d, err := os.Open(dir)
	if err != nil {
		return err
	}
	defer d.Close()
	return d.Sync()
}
