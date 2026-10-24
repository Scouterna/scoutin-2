// Package journal keeps one small file per printer recording the job that may
// have reached it, so a crash or cable bump can be resolved afterward (spec
// §7.3).
package journal

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

const (
	PhaseIntent = "intent" // written after beginAck, before the USB write
	PhaseResult = "result" // outcome known, kept until the cloud acks it
)

type Entry struct {
	JobID         string `json:"jobId"`
	LeaseID       string `json:"leaseId"`
	Phase         string `json:"phase"`
	CounterBefore int64  `json:"counterBefore"`
	Outcome       string `json:"outcome,omitempty"`
	Detail        string `json:"detail,omitempty"`
}

// Dir is the journal directory, e.g. /var/lib/printer-proxy/journal.
type Dir struct{ path string }

func Open(path string) (*Dir, error) {
	if err := os.MkdirAll(path, 0o700); err != nil {
		return nil, err
	}
	return &Dir{path: path}, nil
}

var safeSerial = regexp.MustCompile(`^[A-Za-z0-9._-]+$`)

func (d *Dir) file(serial string) (string, error) {
	if !safeSerial.MatchString(serial) || serial == "." || serial == ".." {
		return "", fmt.Errorf("journal: unusable serial %q", serial)
	}
	return filepath.Join(d.path, serial+".json"), nil
}

// Load returns the printer's entry, or nil if there is none.
func (d *Dir) Load(serial string) (*Entry, error) {
	name, err := d.file(serial)
	if err != nil {
		return nil, err
	}
	b, err := os.ReadFile(name)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var e Entry
	if err := json.Unmarshal(b, &e); err != nil {
		return nil, fmt.Errorf("journal %s: %w", name, err)
	}
	return &e, nil
}

// List returns every printer's entry, keyed by serial.
func (d *Dir) List() (map[string]Entry, error) {
	names, err := filepath.Glob(filepath.Join(d.path, "*.json"))
	if err != nil {
		return nil, err
	}
	out := map[string]Entry{}
	for _, name := range names {
		serial := strings.TrimSuffix(filepath.Base(name), ".json")
		e, err := d.Load(serial)
		if err != nil {
			return out, err
		}
		if e != nil {
			out[serial] = *e
		}
	}
	return out, nil
}

// Save replaces the printer's entry atomically and durably: temp file, fsync,
// rename, fsync the directory. Once it returns, the entry survives a power cut.
func (d *Dir) Save(serial string, e Entry) error {
	name, err := d.file(serial)
	if err != nil {
		return err
	}
	b, err := json.Marshal(e)
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(d.path, serial+".*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name()) // no-op after the rename
	if _, err := tmp.Write(append(b, '\n')); err != nil {
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
	return d.syncDir()
}

// Clear removes the entry once its result has been acknowledged, but only if
// it is still about that job.
func (d *Dir) Clear(serial, jobID string) error {
	e, err := d.Load(serial)
	if err != nil || e == nil || e.JobID != jobID {
		return err
	}
	name, _ := d.file(serial)
	if err := os.Remove(name); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	return d.syncDir()
}

func (d *Dir) syncDir() error {
	f, err := os.Open(d.path)
	if err != nil {
		return err
	}
	defer f.Close()
	return f.Sync()
}
