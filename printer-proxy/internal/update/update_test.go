package update

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const (
	v1 = "1111111111111111111111111111111111111111"
	v2 = "2222222222222222222222222222222222222222"
)

type file struct {
	name, body string
	dir        bool
}

func makeBundle(t *testing.T, files ...file) []byte {
	t.Helper()
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	for _, f := range files {
		h := &tar.Header{Name: f.name, Mode: 0o755, Size: int64(len(f.body)), Typeflag: tar.TypeReg}
		if f.dir {
			h.Typeflag, h.Size = tar.TypeDir, 0
		}
		if err := tw.WriteHeader(h); err != nil {
			t.Fatal(err)
		}
		if _, err := tw.Write([]byte(f.body)); err != nil {
			t.Fatal(err)
		}
	}
	tw.Close()
	gz.Close()
	return buf.Bytes()
}

func bundleFor(t *testing.T, version string) []byte {
	top := "printer-proxy-" + version + "-linux-arm64/"
	return makeBundle(t,
		file{name: top, dir: true},
		file{name: top + "VERSION", body: version + "\n"},
		file{name: top + "printer-proxy", body: "binary"},
		file{name: top + "install.sh", body: "#!/bin/sh\n"},
	)
}

func sum(b []byte) string {
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}

// setup serves a version endpoint and a bundle, and makes an install root
// with v1 current. installed collects the directories Install was run in.
func setup(t *testing.T, rel func(base string) Release, bundle []byte) (*Updater, *[]string, *int) {
	t.Helper()
	downloads := 0
	mux := http.NewServeMux()
	var srv *httptest.Server
	mux.HandleFunc(VersionPath, func(w http.ResponseWriter, r *http.Request) {
		if rel == nil {
			http.NotFound(w, r)
			return
		}
		json.NewEncoder(w).Encode(rel(srv.URL))
	})
	mux.HandleFunc("/bundle.tar.gz", func(w http.ResponseWriter, r *http.Request) {
		downloads++
		w.Write(bundle)
	})
	srv = httptest.NewServer(mux)
	t.Cleanup(srv.Close)

	prefix := t.TempDir()
	os.MkdirAll(filepath.Join(prefix, "versions", v1), 0o755)
	os.Symlink("versions/"+v1, filepath.Join(prefix, "current"))

	u := New(srv.URL, prefix)
	var installed []string
	u.Install = func(_ context.Context, dir string) error {
		b, err := os.ReadFile(filepath.Join(dir, "printer-proxy"))
		if err != nil || string(b) != "binary" {
			t.Errorf("install from %s: binary %q, %v", dir, b, err)
		}
		installed = append(installed, dir)
		return nil
	}
	return u, &installed, &downloads
}

func TestUpToDate(t *testing.T) {
	b := bundleFor(t, v1)
	u, installed, downloads := setup(t, func(base string) Release {
		return Release{Version: v1, URL: base + "/bundle.tar.gz", SHA256: sum(b)}
	}, b)
	_, changed, err := u.Run(context.Background())
	if err != nil || changed || len(*installed) != 0 || *downloads != 0 {
		t.Fatalf("changed=%v err=%v installed=%v downloads=%d", changed, err, *installed, *downloads)
	}
}

func TestUpdate(t *testing.T) {
	b := bundleFor(t, v2)
	u, installed, _ := setup(t, func(base string) Release {
		return Release{Version: v2, URL: base + "/bundle.tar.gz", SHA256: sum(b)}
	}, b)
	_, changed, err := u.Run(context.Background())
	if err != nil || !changed || len(*installed) != 1 {
		t.Fatalf("changed=%v err=%v installed=%v", changed, err, *installed)
	}
	if !strings.HasSuffix((*installed)[0], "printer-proxy-"+v2+"-linux-arm64") {
		t.Errorf("installed from %s", (*installed)[0])
	}
	// The work directory is gone afterwards.
	left, _ := filepath.Glob(filepath.Join(u.Prefix, ".update-*"))
	if len(left) != 0 {
		t.Errorf("left behind: %v", left)
	}
}

func TestKeptVersionNeedsNoDownload(t *testing.T) {
	u, installed, downloads := setup(t, func(base string) Release {
		return Release{Version: v2, URL: base + "/bundle.tar.gz", SHA256: strings.Repeat("0", 64)}
	}, nil)
	kept := filepath.Join(u.Prefix, "versions", v2)
	os.MkdirAll(kept, 0o755)
	os.WriteFile(filepath.Join(kept, "VERSION"), []byte(v2+"\n"), 0o644)
	os.WriteFile(filepath.Join(kept, "install.sh"), []byte("#!/bin/sh\n"), 0o755)
	os.WriteFile(filepath.Join(kept, "printer-proxy"), []byte("binary"), 0o755)
	_, changed, err := u.Run(context.Background())
	if err != nil || !changed || *downloads != 0 || len(*installed) != 1 || (*installed)[0] != kept {
		t.Fatalf("changed=%v err=%v installed=%v downloads=%d", changed, err, *installed, *downloads)
	}
}

func TestBadChecksum(t *testing.T) {
	b := bundleFor(t, v2)
	u, installed, _ := setup(t, func(base string) Release {
		return Release{Version: v2, URL: base + "/bundle.tar.gz", SHA256: strings.Repeat("0", 64)}
	}, b)
	_, _, err := u.Run(context.Background())
	if err == nil || !strings.Contains(err.Error(), "sha256") || len(*installed) != 0 {
		t.Fatalf("err=%v installed=%v", err, *installed)
	}
}

func TestWrongVersionInBundle(t *testing.T) {
	b := bundleFor(t, v1)
	u, installed, _ := setup(t, func(base string) Release {
		return Release{Version: v2, URL: base + "/bundle.tar.gz", SHA256: sum(b)}
	}, b)
	if _, _, err := u.Run(context.Background()); err == nil || len(*installed) != 0 {
		t.Fatalf("err=%v installed=%v", err, *installed)
	}
}

func TestNoVersion(t *testing.T) {
	u, _, _ := setup(t, nil, nil)
	if _, _, err := u.Run(context.Background()); err != ErrNoVersion {
		t.Fatalf("err=%v", err)
	}
}

func TestBadRelease(t *testing.T) {
	for name, r := range map[string]Release{
		"path in version": {Version: "../etc", URL: "https://x/b", SHA256: strings.Repeat("0", 64)},
		"short sha":       {Version: v2, URL: "https://x/b", SHA256: "abc"},
		"file url":        {Version: v2, URL: "file:///etc/passwd", SHA256: strings.Repeat("0", 64)},
	} {
		t.Run(name, func(t *testing.T) {
			u, _, _ := setup(t, func(string) Release { return r }, nil)
			if _, _, err := u.Run(context.Background()); err == nil {
				t.Fatal("accepted")
			}
		})
	}
}

func TestUnpackRejectsEscapes(t *testing.T) {
	for name, b := range map[string][]byte{
		"dotdot":   makeBundle(t, file{name: "a/VERSION"}, file{name: "a/../../evil", body: "x"}),
		"absolute": makeBundle(t, file{name: "/etc/evil", body: "x"}),
		"two tops": makeBundle(t, file{name: "a/VERSION"}, file{name: "b/evil", body: "x"}),
	} {
		t.Run(name, func(t *testing.T) {
			dir := t.TempDir()
			path := filepath.Join(dir, "b.tar.gz")
			os.WriteFile(path, b, 0o644)
			if _, err := unpack(path, filepath.Join(dir, "x")); err == nil {
				t.Fatal("accepted")
			}
		})
	}
}
