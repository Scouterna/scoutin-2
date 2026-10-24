package fakecloud

import (
	"crypto/rand"
	"encoding/json"
	"log/slog"
	"math/big"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/Scouterna/scoutin-2/printer-proxy/internal/cloud"
	"github.com/Scouterna/scoutin-2/printer-proxy/internal/enroll"
)

// Enrollment endpoints (spec §12):
//
//	POST /api/print-relays/enroll        relay asks for a code
//	GET  /api/print-relays/enroll/{id}   relay polls, Authorization: Bearer <secret>
//	POST /pair?colors=red,green,white,pink  staff pair it
//	GET  /enrollments                    pending enrollments, without their codes
//	POST /revoke?key=K                   revoke a key and drop its connections

var pairingColors = []string{"red", "green", "yellow", "white", "pink"}

// EnrollmentTTL: a pending enrollment is dropped this long after its last poll.
var EnrollmentTTL = 5 * time.Minute

type enrollment struct {
	enroll.Enrollment
	Hostname string              `json:"hostname"`
	Printers []cloud.PrinterInfo `json:"printers"`
	IP       string              `json:"ip"`
	Key      string              `json:"-"`
	LastPoll time.Time           `json:"lastPoll"`
}

func pick(n int) int {
	v, _ := rand.Int(rand.Reader, big.NewInt(int64(n)))
	return int(v.Int64())
}

func (s *Server) expireEnrollments() {
	for id, e := range s.enrollments {
		if time.Since(e.LastPoll) > EnrollmentTTL {
			delete(s.enrollments, id)
		}
	}
}

func (s *Server) postEnroll(w http.ResponseWriter, r *http.Request) {
	var req enroll.Request
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.expireEnrollments()

	// A color code no other pending enrollment holds.
	var colors []string
	for {
		colors = make([]string, 4)
		for i := range colors {
			colors[i] = pairingColors[pick(len(pairingColors))]
		}
		taken := false
		for _, e := range s.enrollments {
			if e.Key == "" && slices.Equal(e.Colors, colors) {
				taken = true
			}
		}
		if !taken {
			break
		}
	}
	e := &enrollment{
		Enrollment: enroll.Enrollment{ID: newID("enr-"), Secret: newID("sec-") + newID(""), Colors: colors},
		Hostname:   req.Hostname, Printers: req.Printers, IP: r.RemoteAddr, LastPoll: time.Now(),
	}
	s.enrollments[e.ID] = e
	slog.Info("fakecloud: enrollment started", "id", e.ID, "hostname", e.Hostname, "colors", colors)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(e.Enrollment)
}

func (s *Server) getEnroll(w http.ResponseWriter, r *http.Request, id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.expireEnrollments()
	e := s.enrollments[id]
	if e == nil {
		http.NotFound(w, r)
		return
	}
	if r.Header.Get("Authorization") != "Bearer "+e.Secret {
		http.Error(w, "bad secret", http.StatusUnauthorized)
		return
	}
	e.LastPoll = time.Now()
	if e.Key == "" {
		writeJSON(w, enroll.Status{Status: "pending"})
		return
	}
	// Collected: the enrollment is done with.
	delete(s.enrollments, id)
	writeJSON(w, enroll.Status{Status: "paired", Key: e.Key})
}

// Pair plays the admin entering the colors ("red,green,white,pink"). It
// returns the issued key.
func (s *Server) Pair(colors string) (string, bool) {
	s.init()
	s.mu.Lock()
	defer s.mu.Unlock()
	s.expireEnrollments()
	want := strings.Split(colors, ",")
	for _, e := range s.enrollments {
		if e.Key != "" {
			continue
		}
		if slices.Equal(e.Colors, want) {
			e.Key = newID("key-") + newID("")
			s.issued[e.Key] = true
			slog.Info("fakecloud: relay paired", "id", e.ID, "hostname", e.Hostname)
			return e.Key, true
		}
	}
	return "", false
}

// Revoke rejects a key from now on and drops its connections.
func (s *Server) Revoke(key string) {
	s.init()
	s.mu.Lock()
	defer s.mu.Unlock()
	s.revoked[key] = true
	delete(s.issued, key)
	for r := range s.relays {
		if r.key == key {
			r.cancel()
		}
	}
	slog.Info("fakecloud: key revoked")
}

// keyOK decides a relay's bearer key. With Key set, only that key and issued
// ones work; without it, anything not revoked does.
func (s *Server) keyOK(header string) (string, bool) {
	key, ok := strings.CutPrefix(header, "Bearer ")
	if !ok || key == "" {
		return "", s.Key == ""
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.revoked[key] {
		return key, false
	}
	return key, s.Key == "" || key == s.Key || s.issued[key]
}

func (s *Server) serveEnrollAPI(w http.ResponseWriter, r *http.Request) bool {
	const base = "/api/print-relays/enroll"
	switch {
	case r.URL.Path == base && r.Method == http.MethodPost:
		s.postEnroll(w, r)
	case strings.HasPrefix(r.URL.Path, base+"/") && r.Method == http.MethodGet:
		s.getEnroll(w, r, strings.TrimPrefix(r.URL.Path, base+"/"))
	case r.URL.Path == "/pair" && r.Method == http.MethodPost:
		key, ok := s.Pair(r.URL.Query().Get("colors"))
		if !ok {
			http.Error(w, "no pending enrollment with those colors", http.StatusNotFound)
			return true
		}
		writeJSON(w, map[string]string{"key": key})
	case r.URL.Path == "/revoke" && r.Method == http.MethodPost:
		s.Revoke(r.URL.Query().Get("key"))
		w.WriteHeader(http.StatusNoContent)
	case r.URL.Path == "/enrollments":
		s.mu.Lock()
		s.expireEnrollments()
		// Never the code or colors (spec §12.3): the only way to learn a code
		// is to see the Pi.
		type pending struct {
			Hostname string              `json:"hostname"`
			Printers []cloud.PrinterInfo `json:"printers"`
			IP       string              `json:"ip"`
			LastPoll time.Time           `json:"lastPoll"`
		}
		out := []pending{}
		for _, e := range s.enrollments {
			if e.Key == "" {
				out = append(out, pending{e.Hostname, e.Printers, e.IP, e.LastPoll})
			}
		}
		s.mu.Unlock()
		writeJSON(w, out)
	default:
		return false
	}
	return true
}

// ForgetEnrollments drops every pending enrollment, as expiry would.
func (s *Server) ForgetEnrollments() {
	s.init()
	s.mu.Lock()
	defer s.mu.Unlock()
	clear(s.enrollments)
}

// Enrollments returns the pending enrollments.
func (s *Server) Enrollments() int {
	s.init()
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.enrollments)
}
