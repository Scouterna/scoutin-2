package fakecloud

import (
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/Scouterna/scoutin-2/printer-proxy/internal/update"
)

// serveUpdateAPI offers Bundle to `printer-proxy update`. The version comes
// from the file name, printer-proxy-<version>-linux-arm64.tar.gz, and the
// checksum is computed on every request, so a rebuilt bundle needs no restart.
func (s *Server) serveUpdateAPI(w http.ResponseWriter, r *http.Request) bool {
	name := filepath.Base(s.Bundle)
	switch {
	case r.URL.Path == update.VersionPath:
		if s.Bundle == "" {
			http.NotFound(w, r)
			return true
		}
		version := strings.TrimSuffix(strings.TrimPrefix(name, "printer-proxy-"), "-linux-arm64.tar.gz")
		f, err := os.Open(s.Bundle)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return true
		}
		defer f.Close()
		h := sha256.New()
		if _, err := io.Copy(h, f); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return true
		}
		writeJSON(w, update.Release{
			Version: version,
			URL:     "http://" + r.Host + "/bundles/" + name,
			SHA256:  hex.EncodeToString(h.Sum(nil)),
		})
	case s.Bundle != "" && r.URL.Path == "/bundles/"+name:
		http.ServeFile(w, r, s.Bundle)
	default:
		return false
	}
	return true
}
