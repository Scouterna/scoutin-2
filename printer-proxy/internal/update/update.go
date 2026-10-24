// Package update brings the relay to the version the server expects (spec
// §8.10). systemd runs it as root before every start of the relay
// (`printer-proxy update`), so the relay never replaces its own binary.
package update

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// VersionPath is the server's public endpoint naming the relay version it
// expects.
const VersionPath = "/api/print-relays/version"

// Release is what the server answers on VersionPath.
type Release struct {
	Version string `json:"version"` // git tree hash of printer-proxy/
	URL     string `json:"url"`     // the bundle, a .tar.gz from dist.sh
	SHA256  string `json:"sha256"`  // of the bundle file
}

var (
	// A version becomes a directory name, so it's strict about what it allows.
	versionRE = regexp.MustCompile(`^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$`)
	sha256RE  = regexp.MustCompile(`^[0-9a-f]{64}$`)
)

func (r Release) validate() error {
	if !versionRE.MatchString(r.Version) {
		return fmt.Errorf("bad version %q", r.Version)
	}
	if !sha256RE.MatchString(r.SHA256) {
		return fmt.Errorf("bad sha256 %q", r.SHA256)
	}
	u, err := url.Parse(r.URL)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" {
		return fmt.Errorf("bad url %q", r.URL)
	}
	return nil
}

// Updater checks the server and installs a new version if needed.
type Updater struct {
	Server string // e.g. https://scoutin.example.se
	Prefix string // install root, /opt/printer-proxy
	Client *http.Client

	// CheckTimeout bounds asking the server; DownloadTimeout the download.
	// Both keep a start from hanging when the network is down.
	CheckTimeout    time.Duration
	DownloadTimeout time.Duration
	// MaxSize caps the bundle download.
	MaxSize int64

	// Install runs a bundle's install.sh in dir. Tests replace it.
	Install func(ctx context.Context, dir string) error
}

func New(server, prefix string) *Updater {
	return &Updater{
		Server: server, Prefix: prefix, Client: http.DefaultClient,
		CheckTimeout: 10 * time.Second, DownloadTimeout: 60 * time.Second,
		MaxSize: 64 << 20,
		Install: runInstall,
	}
}

// ErrNoVersion means the server doesn't name a version (an older server, or
// none set): nothing to do.
var ErrNoVersion = errors.New("server names no relay version")

// Current is the installed version: where the "current" symlink points.
func (u *Updater) Current() (string, error) {
	target, err := os.Readlink(filepath.Join(u.Prefix, "current"))
	if err != nil {
		return "", err
	}
	return filepath.Base(target), nil
}

// Check asks the server which version it expects.
func (u *Updater) Check(ctx context.Context) (Release, error) {
	ctx, cancel := context.WithTimeout(ctx, u.CheckTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimSuffix(u.Server, "/")+VersionPath, nil)
	if err != nil {
		return Release{}, err
	}
	resp, err := u.Client.Do(req)
	if err != nil {
		return Release{}, err
	}
	defer resp.Body.Close()
	switch {
	case resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusNoContent:
		return Release{}, ErrNoVersion
	case resp.StatusCode != http.StatusOK:
		return Release{}, fmt.Errorf("%s: %s", VersionPath, resp.Status)
	}
	var r Release
	if err := json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(&r); err != nil {
		return Release{}, fmt.Errorf("%s: %w", VersionPath, err)
	}
	if err := r.validate(); err != nil {
		return Release{}, fmt.Errorf("%s: %w", VersionPath, err)
	}
	return r, nil
}

// Run installs the server's version if it isn't the current one. It returns
// the version now wanted and whether it changed anything.
func (u *Updater) Run(ctx context.Context) (Release, bool, error) {
	r, err := u.Check(ctx)
	if err != nil {
		return r, false, err
	}
	cur, err := u.Current()
	if err != nil {
		return r, false, fmt.Errorf("installed version: %w", err)
	}
	if cur == r.Version {
		return r, false, nil
	}

	// A version kept from before (§8.8 keeps three) installs without a
	// download: that's a rollback, and it works offline.
	kept := filepath.Join(u.Prefix, "versions", r.Version)
	if v, err := os.ReadFile(filepath.Join(kept, "VERSION")); err == nil && strings.TrimSpace(string(v)) == r.Version {
		if _, err := os.Stat(filepath.Join(kept, "install.sh")); err == nil {
			slog.Info("update: installing a kept version", "from", cur, "to", r.Version)
			return r, true, u.Install(ctx, kept)
		}
	}

	slog.Info("update: downloading", "from", cur, "to", r.Version, "url", r.URL)
	work, err := os.MkdirTemp(u.Prefix, ".update-")
	if err != nil {
		return r, false, err
	}
	defer os.RemoveAll(work)
	bundle := filepath.Join(work, "bundle.tar.gz")
	if err := u.download(ctx, r, bundle); err != nil {
		return r, false, err
	}
	dir, err := unpack(bundle, filepath.Join(work, "x"))
	if err != nil {
		return r, false, fmt.Errorf("unpack: %w", err)
	}
	v, err := os.ReadFile(filepath.Join(dir, "VERSION"))
	if err != nil || strings.TrimSpace(string(v)) != r.Version {
		return r, false, fmt.Errorf("bundle is version %q, want %q", strings.TrimSpace(string(v)), r.Version)
	}
	slog.Info("update: installing", "to", r.Version)
	return r, true, u.Install(ctx, dir)
}

// download fetches the bundle to path and checks its SHA-256.
func (u *Updater) download(ctx context.Context, r Release, path string) error {
	ctx, cancel := context.WithTimeout(ctx, u.DownloadTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, r.URL, nil)
	if err != nil {
		return err
	}
	resp, err := u.Client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download: %s", resp.Status)
	}
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()
	h := sha256.New()
	n, err := io.Copy(io.MultiWriter(f, h), io.LimitReader(resp.Body, u.MaxSize+1))
	if err != nil {
		return fmt.Errorf("download: %w", err)
	}
	if n > u.MaxSize {
		return fmt.Errorf("download: bundle is over %d bytes", u.MaxSize)
	}
	if got := hex.EncodeToString(h.Sum(nil)); got != r.SHA256 {
		return fmt.Errorf("download: sha256 %s, want %s", got, r.SHA256)
	}
	return f.Close()
}

// unpack extracts a dist.sh bundle into dest and returns its one top-level
// directory. It only takes plain files and directories inside that directory.
func unpack(bundle, dest string) (string, error) {
	f, err := os.Open(bundle)
	if err != nil {
		return "", err
	}
	defer f.Close()
	gz, err := gzip.NewReader(f)
	if err != nil {
		return "", err
	}
	tr := tar.NewReader(gz)
	top := ""
	for {
		h, err := tr.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return "", err
		}
		name := filepath.Clean(h.Name)
		if filepath.IsAbs(name) || name == ".." || strings.HasPrefix(name, "../") {
			return "", fmt.Errorf("unsafe path %q", h.Name)
		}
		first, _, _ := strings.Cut(name, "/")
		if top == "" {
			top = first
		}
		if first != top || top == "." {
			return "", fmt.Errorf("%q is outside the bundle directory %q", h.Name, top)
		}
		path := filepath.Join(dest, name)
		switch h.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(path, 0o755); err != nil {
				return "", err
			}
		case tar.TypeReg:
			if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
				return "", err
			}
			out, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, os.FileMode(h.Mode)&0o755)
			if err != nil {
				return "", err
			}
			_, err = io.Copy(out, tr)
			if cerr := out.Close(); err == nil {
				err = cerr
			}
			if err != nil {
				return "", err
			}
		default:
			return "", fmt.Errorf("%q: unsupported entry type %c", h.Name, h.Typeflag)
		}
	}
	if top == "" {
		return "", errors.New("empty bundle")
	}
	return filepath.Join(dest, top), nil
}

// runInstall runs the bundle's install.sh without restarting the service:
// systemd starts the new binary right after the updater exits.
func runInstall(ctx context.Context, dir string) error {
	cmd := exec.CommandContext(ctx, filepath.Join(dir, "install.sh"), "--no-restart")
	cmd.Dir = dir
	cmd.Stdout = os.Stderr // both to the journal
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("install.sh: %w", err)
	}
	return nil
}
