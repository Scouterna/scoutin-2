// Package fakecloud is a stand-in for the scoutin backend's relay hub: just
// enough of the job lifecycle (spec §6, §7) to drive a relay end to end, plus
// switches for the awkward cases. It keeps everything in memory.
package fakecloud

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"image/png"
	"log/slog"
	"net/http"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/Scouterna/scoutin-2/printer-proxy/internal/cloud"
	"github.com/coder/websocket"
)

// Job states (spec §6.1).
const (
	Queued   = "queued"
	Leased   = "leased"
	Sending  = "sending"
	Printed  = "printed"
	Unknown  = "unknown"
	Failed   = "failed"
	Canceled = "canceled"
)

func terminal(state string) bool {
	return state == Printed || state == Unknown || state == Failed || state == Canceled
}

type Job struct {
	ID       string    `json:"id"`
	Target   string    `json:"target,omitempty"` // printer serial, "" = any printer
	State    string    `json:"state"`
	LeaseID  string    `json:"leaseId,omitempty"`
	Printer  string    `json:"printer,omitempty"` // the printer it was last leased to
	Reason   string    `json:"reason,omitempty"`
	Attempts int       `json:"attempts"`
	Created  time.Time `json:"created"`
	Done     time.Time `json:"done,omitzero"`
	png      []byte
	w, h     int
}

type PrinterView struct {
	Serial  string `json:"serial"`
	State   string `json:"state"`
	Detail  string `json:"detail,omitempty"`
	Seq     int64  `json:"seq"`
	Waiting bool   `json:"waiting"`
}

// Server serves /ws/print-relay and a small HTTP API:
//
//	POST /jobs?serial=S[&wait=1]  body = 1-bit PNG; serial optional
//	GET  /jobs
//	GET  /printers
//	GET  /config?serial=S                    last printer:config
//	POST /actions?serial=S&kind=K            body = JSON settings for applyProfile;
//	                                         waits for printer:actionResult
//	POST /relay-actions?kind=K[&serial=S]   reboot | poweroff the relay that has
//	                                         printer S (or the only relay)
//	POST /disconnect                         drop every relay connection
//	GET  /api/print-relays/version           the Bundle's version (spec §8.10)
//	GET  /bundles/<name>                     the Bundle itself
type Server struct {
	Key      string        // bearer key relays must present; "" accepts any
	LeaseTTL time.Duration // default 15 s
	// Bundle is a dist.sh bundle to offer `printer-proxy update`; "" means the
	// server names no version.
	Bundle string
	// Misbehavior, for testing the relay. Each drops that many of the next
	// replies of its kind (the state change still happens).
	DropBeginAcks  int
	DropResultAcks int

	mu           sync.Mutex
	jobs         []*Job
	relays       map[*relay]bool
	owner        map[string]*relay // printer serial → relay that last reported it
	waiting      map[string]*relay // printers that asked for a job and got none
	status       map[string]cloud.PrinterStatus
	config       map[string]cloud.PrinterConfig
	actions      map[string]chan cloud.PrinterActionResult // action ID → waiting caller
	relayActions map[string]chan cloud.RelayActionResult
	// Enrollment (enroll.go).
	enrollments map[string]*enrollment
	issued      map[string]bool
	revoked     map[string]bool
	epoch       int64
	changed     chan struct{} // closed and replaced on every job change
	initOnce    sync.Once
}

type relay struct {
	out    chan []byte
	cancel context.CancelFunc
	key    string
}

func (s *Server) init() {
	s.initOnce.Do(func() {
		s.relays = map[*relay]bool{}
		s.owner = map[string]*relay{}
		s.waiting = map[string]*relay{}
		s.status = map[string]cloud.PrinterStatus{}
		s.config = map[string]cloud.PrinterConfig{}
		s.actions = map[string]chan cloud.PrinterActionResult{}
		s.relayActions = map[string]chan cloud.RelayActionResult{}
		s.enrollments = map[string]*enrollment{}
		s.issued = map[string]bool{}
		s.revoked = map[string]bool{}
		s.changed = make(chan struct{})
		if s.LeaseTTL == 0 {
			s.LeaseTTL = 15 * time.Second
		}
	})
}

func newID(prefix string) string {
	b := make([]byte, 6)
	rand.Read(b)
	return prefix + hex.EncodeToString(b)
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.init()
	if s.serveEnrollAPI(w, r) || s.serveUpdateAPI(w, r) {
		return
	}
	switch {
	case r.URL.Path == "/ws/print-relay":
		s.serveRelay(w, r)
	case r.URL.Path == "/jobs" && r.Method == http.MethodPost:
		s.postJob(w, r)
	case r.URL.Path == "/jobs":
		s.mu.Lock()
		out := make([]Job, len(s.jobs))
		for i, j := range s.jobs {
			out[i] = *j
		}
		s.mu.Unlock()
		writeJSON(w, out)
	case r.URL.Path == "/config":
		s.mu.Lock()
		cfg, ok := s.config[r.URL.Query().Get("serial")]
		s.mu.Unlock()
		if !ok {
			http.NotFound(w, r)
			return
		}
		writeJSON(w, cfg)
	case r.URL.Path == "/actions" && r.Method == http.MethodPost:
		s.postAction(w, r)
	case r.URL.Path == "/relay-actions" && r.Method == http.MethodPost:
		ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
		defer cancel()
		res, err := s.RelayAction(ctx, r.URL.Query().Get("serial"), r.URL.Query().Get("kind"))
		if err != nil {
			http.Error(w, err.Error(), http.StatusConflict)
			return
		}
		writeJSON(w, res)
	case r.URL.Path == "/disconnect" && r.Method == http.MethodPost:
		s.DisconnectAll()
		w.WriteHeader(http.StatusNoContent)
	case r.URL.Path == "/printers":
		s.mu.Lock()
		var out []PrinterView
		for serial, st := range s.status {
			out = append(out, PrinterView{Serial: serial, State: st.State, Detail: st.Detail, Seq: st.Seq, Waiting: s.waiting[serial] != nil})
		}
		s.mu.Unlock()
		slices.SortFunc(out, func(a, b PrinterView) int { return strings.Compare(a.Serial, b.Serial) })
		writeJSON(w, out)
	default:
		http.NotFound(w, r)
	}
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	enc.Encode(v)
}

// AddJob queues a badge, for a given printer or ("" serial) any printer.
func (s *Server) AddJob(serial string, img []byte) Job {
	s.init()
	var w, h int
	if cfg, err := png.DecodeConfig(bytes.NewReader(img)); err == nil {
		w, h = cfg.Width, cfg.Height
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	j := &Job{ID: newID("job-"), Target: serial, State: Queued, Created: time.Now(), png: img, w: w, h: h}
	s.jobs = append(s.jobs, j)
	slog.Info("fakecloud: job queued", "job", j.ID, "target", serial)
	s.touch()
	s.dispatch()
	return *j
}

// Job returns a job's current state.
func (s *Server) Job(id string) (Job, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, j := range s.jobs {
		if j.ID == id {
			return *j, true
		}
	}
	return Job{}, false
}

// WaitJob blocks until the job is terminal or ctx ends.
func (s *Server) WaitJob(ctx context.Context, id string) (Job, bool) {
	for {
		s.mu.Lock()
		ch := s.changed
		s.mu.Unlock()
		j, ok := s.Job(id)
		if !ok || terminal(j.State) {
			return j, ok
		}
		select {
		case <-ch:
		case <-ctx.Done():
			return j, false
		}
	}
}

// DisconnectAll drops every relay connection, as a server restart would.
func (s *Server) DisconnectAll() {
	s.init()
	s.mu.Lock()
	defer s.mu.Unlock()
	for r := range s.relays {
		r.cancel()
	}
}

func (s *Server) postJob(w http.ResponseWriter, r *http.Request) {
	var buf bytes.Buffer
	if _, err := buf.ReadFrom(http.MaxBytesReader(w, r.Body, 1<<20)); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	j := s.AddJob(r.URL.Query().Get("serial"), buf.Bytes())
	if r.URL.Query().Get("wait") != "" {
		j, _ = s.WaitJob(r.Context(), j.ID)
	}
	writeJSON(w, j)
}

// touch wakes WaitJob callers. Called with mu held.
func (s *Server) touch() {
	close(s.changed)
	s.changed = make(chan struct{})
}

func (s *Server) send(r *relay, name string, data any) {
	b, err := cloud.Encode(name, data)
	if err != nil {
		return
	}
	select {
	case r.out <- b:
	default:
		slog.Warn("fakecloud: relay send queue full; dropping", "msg", name)
	}
}

func (s *Server) serveRelay(w http.ResponseWriter, r *http.Request) {
	key, ok := s.keyOK(r.Header.Get("Authorization"))
	if !ok {
		http.Error(w, "bad relay key", http.StatusUnauthorized)
		return
	}
	conn, err := websocket.Accept(w, r, nil)
	if err != nil {
		return
	}
	defer conn.CloseNow()
	conn.SetReadLimit(1 << 20)

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	rl := &relay{out: make(chan []byte, 64), cancel: cancel, key: key}
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case b := <-rl.out:
				if conn.Write(ctx, websocket.MessageText, b) != nil {
					cancel()
					return
				}
			}
		}
	}()

	s.mu.Lock()
	s.relays[rl] = true
	s.mu.Unlock()
	defer s.drop(rl)

	for {
		_, b, err := conn.Read(ctx)
		if err != nil {
			return
		}
		var m cloud.Envelope
		if json.Unmarshal(b, &m) != nil {
			continue
		}
		s.handle(rl, m)
	}
}

// drop forgets a relay whose connection ended. Its leased jobs go back to the
// queue; jobs in sending stay there until the relay says what happened.
func (s *Server) drop(r *relay) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.relays, r)
	for serial, owner := range s.owner {
		if owner != r {
			continue
		}
		delete(s.waiting, serial)
		for _, j := range s.jobs {
			if j.Printer == serial && j.State == Leased {
				s.requeue(j, "relay disconnected")
			}
		}
	}
	s.dispatch()
}

func (s *Server) handle(r *relay, m cloud.Envelope) {
	s.mu.Lock()
	defer s.mu.Unlock()
	switch m.Name {
	case cloud.MsgHello:
		var h cloud.Hello
		json.Unmarshal(m.Data, &h)
		s.hello(r, h)
	case cloud.MsgPrinterAttached:
		var p cloud.PrinterInfo
		json.Unmarshal(m.Data, &p)
		s.owner[p.Serial] = r
	case cloud.MsgPrinterDetached:
		var p cloud.PrinterRef
		json.Unmarshal(m.Data, &p)
		delete(s.waiting, p.Serial)
	case cloud.MsgPrinterStatus:
		var st cloud.PrinterStatus
		json.Unmarshal(m.Data, &st)
		if st.Seq >= s.status[st.Serial].Seq {
			s.status[st.Serial] = st
		}
		if st.State != "ready" {
			delete(s.waiting, st.Serial)
		}
	case cloud.MsgPrinterReady:
		var p cloud.PrinterRef
		json.Unmarshal(m.Data, &p)
		s.owner[p.Serial] = r
		if !s.lease(r, p.Serial) {
			s.waiting[p.Serial] = r
		}
	case cloud.MsgJobBegin:
		var b cloud.JobBegin
		json.Unmarshal(m.Data, &b)
		s.begin(r, b)
	case cloud.MsgJobRelease:
		var rel cloud.JobRelease
		json.Unmarshal(m.Data, &rel)
		// A release is the relay's word that nothing was written, so it's
		// accepted in sending too (no beginAck reached the relay).
		if j := s.find(rel.JobID); j != nil && (j.State == Leased || j.State == Sending) && j.LeaseID == rel.LeaseID {
			s.requeue(j, "released: "+rel.Reason)
			s.dispatch()
		}
	case cloud.MsgJobResult:
		var res cloud.JobResult
		json.Unmarshal(m.Data, &res)
		s.result(r, res)
	case cloud.MsgPrinterConfig:
		var c cloud.PrinterConfig
		json.Unmarshal(m.Data, &c)
		s.config[c.Serial] = c
	case cloud.MsgRelayResult:
		var res cloud.RelayActionResult
		json.Unmarshal(m.Data, &res)
		slog.Info("fakecloud: relay action result", "action", res.ActionID, "ok", res.OK, "error", res.Error)
		if ch := s.relayActions[res.ActionID]; ch != nil {
			delete(s.relayActions, res.ActionID)
			ch <- res
		}
	case cloud.MsgActionResult:
		var res cloud.PrinterActionResult
		json.Unmarshal(m.Data, &res)
		if ch := s.actions[res.ActionID]; ch != nil {
			delete(s.actions, res.ActionID)
			ch <- res
		}
	}
}

func (s *Server) hello(r *relay, h cloud.Hello) {
	journal := map[string]cloud.JournalEntry{}
	for _, e := range h.Journal {
		journal[e.JobID] = e
		s.owner[e.Serial] = r
	}
	for _, p := range h.Printers {
		s.owner[p.Serial] = r
	}
	// Reconcile (spec §7.3) every job this relay's printers had in flight.
	for _, j := range s.jobs {
		if s.owner[j.Printer] != r {
			continue
		}
		switch j.State {
		case Leased:
			s.requeue(j, "relay reconnected")
		case Sending:
			e, ok := journal[j.ID]
			switch {
			case !ok || e.LeaseID != j.LeaseID:
				s.requeue(j, "never written (not in journal)")
			case e.Phase == "result":
				s.apply(j, e.Outcome, "from journal")
			default:
				// Intent only: the relay settles it via the label counter once
				// the printer is back, and sends job:result.
			}
		}
	}
	s.epoch++
	s.send(r, cloud.MsgWelcome, cloud.Welcome{RelayID: "fake-relay", Epoch: s.epoch})
	slog.Info("fakecloud: relay connected", "hostname", h.Hostname, "printers", len(h.Printers), "journal", len(h.Journal))
	s.dispatch()
}

func (s *Server) find(id string) *Job {
	for _, j := range s.jobs {
		if j.ID == id {
			return j
		}
	}
	return nil
}

func (s *Server) requeue(j *Job, reason string) {
	slog.Info("fakecloud: job re-queued", "job", j.ID, "reason", reason)
	j.State, j.LeaseID, j.Reason = Queued, "", reason
	s.touch()
}

func (s *Server) apply(j *Job, outcome, reason string) {
	slog.Info("fakecloud: job result", "job", j.ID, "outcome", outcome, "reason", reason)
	switch outcome {
	case "not_sent":
		s.requeue(j, "not sent: "+reason)
		return
	case Printed, Unknown, Failed:
		j.State = outcome
	default:
		j.State = Unknown
	}
	j.Reason, j.Done = reason, time.Now()
	s.touch()
}

// lease offers the oldest suitable job to a printer: targeted jobs first
// (spec §7.1).
func (s *Server) lease(r *relay, serial string) bool {
	var pick *Job
	for _, j := range s.jobs {
		if j.State != Queued || (j.Target != "" && j.Target != serial) {
			continue
		}
		if pick == nil || (j.Target != "" && pick.Target == "") {
			pick = j
		}
		if pick.Target != "" {
			break
		}
	}
	if pick == nil {
		return false
	}
	delete(s.waiting, serial)
	pick.State, pick.LeaseID, pick.Printer = Leased, newID("lease-"), serial
	pick.Attempts++
	s.touch()
	lease := pick.LeaseID
	time.AfterFunc(s.LeaseTTL, func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		if pick.State == Leased && pick.LeaseID == lease {
			s.requeue(pick, "lease expired")
			s.dispatch()
		}
	})
	slog.Info("fakecloud: job leased", "job", pick.ID, "printer", serial, "lease", lease)
	s.send(r, cloud.MsgJobOffer, cloud.JobOffer{
		JobID: pick.ID, LeaseID: lease, Serial: serial, PNG: pick.png, WidthDots: pick.w, HeightDots: pick.h,
	})
	return true
}

// dispatch offers queued jobs to printers that are waiting for one.
func (s *Server) dispatch() {
	for serial, r := range s.waiting {
		if s.relays[r] {
			s.lease(r, serial)
		} else {
			delete(s.waiting, serial)
		}
	}
}

func (s *Server) begin(r *relay, b cloud.JobBegin) {
	j := s.find(b.JobID)
	ok := j != nil && j.LeaseID == b.LeaseID && (j.State == Leased || j.State == Sending)
	if ok && j.State == Leased {
		j.State = Sending
		s.touch()
	}
	if s.DropBeginAcks > 0 {
		s.DropBeginAcks--
		slog.Info("fakecloud: dropping beginAck", "job", b.JobID)
		return
	}
	s.send(r, cloud.MsgJobBeginAck, cloud.JobBeginAck{JobID: b.JobID, LeaseID: b.LeaseID, OK: ok})
}

func (s *Server) result(r *relay, res cloud.JobResult) {
	if j := s.find(res.JobID); j != nil && j.LeaseID == res.LeaseID && (j.State == Sending || j.State == Leased) {
		s.apply(j, res.Outcome, res.Reason)
		s.dispatch()
	}
	if s.DropResultAcks > 0 {
		s.DropResultAcks--
		slog.Info("fakecloud: dropping resultAck", "job", res.JobID)
		return
	}
	// Always acked, even when stale: the relay only needs to know it may
	// forget the result.
	s.send(r, cloud.MsgJobResultAck, cloud.JobResultAck{JobID: res.JobID, LeaseID: res.LeaseID})
}

// Action sends a maintenance action to the relay that has the printer and
// waits for its result.
func (s *Server) Action(ctx context.Context, serial, kind string, settings map[string]string) (cloud.PrinterActionResult, error) {
	s.init()
	id := newID("action-")
	ch := make(chan cloud.PrinterActionResult, 1)
	s.mu.Lock()
	r := s.owner[serial]
	if r == nil || !s.relays[r] {
		s.mu.Unlock()
		return cloud.PrinterActionResult{}, fmt.Errorf("printer %s is not connected", serial)
	}
	s.actions[id] = ch
	s.send(r, cloud.MsgPrinterAction, cloud.PrinterAction{ActionID: id, Serial: serial, Kind: kind, Settings: settings})
	s.mu.Unlock()
	slog.Info("fakecloud: action sent", "action", id, "serial", serial, "kind", kind)

	select {
	case res := <-ch:
		return res, nil
	case <-ctx.Done():
		s.mu.Lock()
		delete(s.actions, id)
		s.mu.Unlock()
		return cloud.PrinterActionResult{}, ctx.Err()
	}
}

// Config returns the last settings a printer reported.
func (s *Server) Config(serial string) (cloud.PrinterConfig, bool) {
	s.init()
	s.mu.Lock()
	defer s.mu.Unlock()
	c, ok := s.config[serial]
	return c, ok
}

func (s *Server) postAction(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	var settings map[string]string
	if q.Get("kind") == "applyProfile" {
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&settings); err != nil {
			http.Error(w, "applyProfile needs a JSON object of settings: "+err.Error(), http.StatusBadRequest)
			return
		}
	}
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Minute)
	defer cancel()
	res, err := s.Action(ctx, q.Get("serial"), q.Get("kind"), settings)
	if err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	writeJSON(w, res)
}

// RelayAction reboots or powers off a relay: the one that has the printer, or
// the only one connected if serial is empty. It returns the first result.
func (s *Server) RelayAction(ctx context.Context, serial, kind string) (cloud.RelayActionResult, error) {
	s.init()
	id := newID("relay-action-")
	ch := make(chan cloud.RelayActionResult, 1)
	s.mu.Lock()
	var target *relay
	if serial != "" {
		target = s.owner[serial]
	} else if len(s.relays) == 1 {
		for r := range s.relays {
			target = r
		}
	}
	if target == nil || !s.relays[target] {
		s.mu.Unlock()
		return cloud.RelayActionResult{}, fmt.Errorf("no connected relay for %q (give ?serial= with several relays)", serial)
	}
	s.relayActions[id] = ch
	s.send(target, cloud.MsgRelayAction, cloud.RelayAction{ActionID: id, Kind: kind})
	s.mu.Unlock()

	select {
	case res := <-ch:
		return res, nil
	case <-ctx.Done():
		s.mu.Lock()
		delete(s.relayActions, id)
		s.mu.Unlock()
		return cloud.RelayActionResult{}, ctx.Err()
	}
}
