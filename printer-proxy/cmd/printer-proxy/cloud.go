package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"os/exec"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/Scouterna/scoutin-2/printer-proxy/internal/cloud"
	"github.com/Scouterna/scoutin-2/printer-proxy/internal/desk"
	"github.com/Scouterna/scoutin-2/printer-proxy/internal/enroll"
	"github.com/Scouterna/scoutin-2/printer-proxy/internal/hw"
	"github.com/Scouterna/scoutin-2/printer-proxy/internal/journal"
	"github.com/Scouterna/scoutin-2/printer-proxy/internal/printer"
)

// Timings, see the spec (§7.2, §13).
const statusHeartbeat = 30 * time.Second

// beginTimeout: no beginAck by then means no write. A variable for tests.
var beginTimeout = 10 * time.Second

// cloudJobs takes jobs from the server over /ws/print-relay and reports printers
// and results back (spec §13).
type cloudJobs struct {
	desk     *desk.Desk
	journal  *journal.Dir
	hostname string
	// power runs `systemctl reboot` or `systemctl poweroff`. Replaced in tests.
	power func(kind string) error

	mu       sync.Mutex
	sess     *cloud.Session // welcomed session; nil while disconnected
	printers map[string]*cloudPrinter
	begins   map[string]chan bool // lease ID → Begin waiting for beginAck
	unacked  map[string]unacked   // job ID → result the server hasn't acked
}

type cloudPrinter struct {
	info      cloud.PrinterInfo
	jobs      chan *printer.Job
	actions   chan *printer.Action
	config    map[string]string // last printer:config
	state     printer.State
	detail    string
	widthDots int
	seq       int64
	readySent bool // printer:ready sent for this idle period
	busy      bool // a job or action has been handed to the worker and not finished
}

type unacked struct {
	serial string
	msg    cloud.JobResult
}

func newCloudJobs(d *desk.Desk, j *journal.Dir, hostname string) *cloudJobs {
	return &cloudJobs{
		desk: d, journal: j, hostname: hostname, power: systemctlPower,
		printers: map[string]*cloudPrinter{}, begins: map[string]chan bool{}, unacked: map[string]unacked{},
	}
}

// systemctlPower asks systemd to reboot or power off. The service user is
// allowed to by a polkit rule (deploy/50-printer-proxy.rules), and nothing
// more.
func systemctlPower(kind string) error {
	out, err := exec.Command("systemctl", "--no-ask-password", kind).CombinedOutput()
	if err != nil {
		return fmt.Errorf("systemctl %s: %v: %s", kind, err, bytes.TrimSpace(out))
	}
	return nil
}

// powerDelay lets the result reach the server before the network goes down.
var powerDelay = time.Second

// relayAction reboots or powers off the Pi (spec §13.4). The result goes out
// first; a second one with an error follows if the command fails. Badges in
// flight are safe either way: the journal settles them on the next start
// (§7.3), and the printer keeps and prints a badge it already holds.
func (c *cloudJobs) relayAction(s *cloud.Session, a cloud.RelayAction) {
	log := slog.With("action", a.ActionID, "kind", a.Kind)
	if a.Kind != "reboot" && a.Kind != "poweroff" {
		send(s, cloud.MsgRelayResult, cloud.RelayActionResult{ActionID: a.ActionID, Error: "unknown relay action: " + a.Kind})
		return
	}
	log.Warn("relay action received")
	if a.Kind == "poweroff" {
		c.desk.SetHalting(true)
	}
	send(s, cloud.MsgRelayResult, cloud.RelayActionResult{ActionID: a.ActionID, OK: true})
	time.Sleep(powerDelay)
	if err := c.power(a.Kind); err != nil {
		log.Error("relay action failed", "err", err)
		c.desk.SetHalting(false)
		send(s, cloud.MsgRelayResult, cloud.RelayActionResult{ActionID: a.ActionID, Error: err.Error()})
	}
}

// send writes to the current session, if there is one. Called without mu
// held, so a slow connection never stalls a printer's worker for long.
func send(s *cloud.Session, name string, data any) {
	if s == nil {
		return
	}
	if err := s.Send(name, data); err != nil {
		slog.Warn("cloud send failed", "msg", name, "err", err)
	}
}

// out collects messages while mu is held, to send once it's released.
type out []func()

func (o *out) add(s *cloud.Session, name string, data any) {
	*o = append(*o, func() { send(s, name, data) })
}

func (o out) flush() {
	for _, f := range o {
		f()
	}
}

// statusLocked builds a printer's status with a fresh seq. Seqs come from the
// clock, so they keep increasing across relay restarts (the server keeps only
// the highest, §7.5).
func (c *cloudJobs) statusLocked(p *cloudPrinter) cloud.PrinterStatus {
	p.seq = max(p.seq+1, time.Now().UnixMilli())
	state := p.state
	if state == printer.Ready && c.desk.Inhibited() {
		state = "inhibited"
	}
	dpi, _ := strconv.Atoi(p.config["head.resolution.in_dpi"])
	length, _ := strconv.Atoi(p.config["zpl.label_length"])
	return cloud.PrinterStatus{
		Serial: p.info.Serial, Seq: p.seq, State: string(state), Detail: p.detail,
		DPI: dpi, WidthDots: p.widthDots, LengthDots: length,
	}
}

// readyLocked queues printer:ready if the printer can take a job and hasn't
// asked yet in this idle period.
func (c *cloudJobs) readyLocked(o *out, p *cloudPrinter) {
	if c.sess == nil || p.state != printer.Ready || p.busy || p.readySent || c.desk.Inhibited() {
		return
	}
	p.readySent = true
	o.add(c.sess, cloud.MsgPrinterReady, cloud.PrinterRef{Serial: p.info.Serial})
}

func (c *cloudJobs) attach(dev printer.Device, port int) (chan *printer.Job, chan *printer.Action) {
	jobs, actions := make(chan *printer.Job), make(chan *printer.Action)
	var o out
	c.mu.Lock()
	p := &cloudPrinter{
		info: cloud.PrinterInfo{Serial: dev.Serial, Product: dev.Product, Port: port},
		jobs: jobs, actions: actions, state: printer.Connecting,
	}
	c.printers[dev.Serial] = p
	o.add(c.sess, cloud.MsgPrinterAttached, p.info)
	c.mu.Unlock()
	o.flush()
	return jobs, actions
}

// config stores and sends a printer's settings (on every connect, and after
// applying a profile). Kept, so a reconnect to the server can resend them.
func (c *cloudJobs) config(serial string, settings map[string]string) {
	var o out
	c.mu.Lock()
	if p := c.printers[serial]; p != nil {
		p.config = settings
		o.add(c.sess, cloud.MsgPrinterConfig, cloud.PrinterConfig{Serial: serial, Settings: settings})
		o.add(c.sess, cloud.MsgPrinterStatus, c.statusLocked(p))
	}
	c.mu.Unlock()
	o.flush()
}

func (c *cloudJobs) actionDone(r printer.ActionResult) {
	msg := cloud.PrinterActionResult{ActionID: r.ID, Serial: r.Serial, OK: r.OK, Restart: r.Restart, Error: r.Error}
	if r.Results != nil {
		msg.Results = map[string]cloud.SettingResult{}
		for k, v := range r.Results {
			msg.Results[k] = cloud.SettingResult(v)
		}
	}
	var o out
	c.mu.Lock()
	if p := c.printers[r.Serial]; p != nil {
		p.busy = false
		c.readyLocked(&o, p)
	}
	// Not resent after a reconnect: an action result is only news for the
	// admin who's waiting on it.
	s := c.sess
	c.mu.Unlock()
	send(s, cloud.MsgActionResult, msg)
	o.flush()
}

// action hands a maintenance action to the printer's worker, or refuses it.
func (c *cloudJobs) action(s *cloud.Session, a cloud.PrinterAction) {
	log := slog.With("action", a.ActionID, "serial", a.Serial, "kind", a.Kind)
	refuse := func(reason string) {
		log.Info("action refused", "reason", reason)
		send(s, cloud.MsgActionResult, cloud.PrinterActionResult{ActionID: a.ActionID, Serial: a.Serial, Error: reason})
	}
	c.mu.Lock()
	p := c.printers[a.Serial]
	switch {
	case p == nil:
		c.mu.Unlock()
		refuse("printer not attached")
		return
	case p.busy:
		c.mu.Unlock()
		refuse("printer busy")
		return
	}
	// Busy also keeps job offers away until the action is done.
	p.busy, p.readySent = true, false
	actions := p.actions
	c.mu.Unlock()

	log.Info("action received")
	select {
	case actions <- &printer.Action{ID: a.ActionID, Kind: a.Kind, Settings: a.Settings}:
		return
	case <-time.After(offerTimeout):
	case <-s.Done():
	}
	var o out
	c.mu.Lock()
	if p := c.printers[a.Serial]; p != nil && p.actions == actions {
		p.busy = false
		c.readyLocked(&o, p)
	}
	c.mu.Unlock()
	refuse("printer not idle (printing, connecting or unresponsive)")
	o.flush()
}

func (c *cloudJobs) detach(serial string, ch chan *printer.Job) {
	var o out
	c.mu.Lock()
	if p := c.printers[serial]; p != nil && p.jobs == ch {
		delete(c.printers, serial)
		o.add(c.sess, cloud.MsgPrinterDetached, cloud.PrinterRef{Serial: serial})
	}
	c.mu.Unlock()
	o.flush()
}

func (c *cloudJobs) report(u printer.Update) {
	var o out
	c.mu.Lock()
	if p := c.printers[u.Device.Serial]; p != nil {
		p.state, p.detail = u.State, u.Detail
		if u.WidthDots != 0 {
			p.widthDots = u.WidthDots
		}
		if u.State != printer.Ready {
			p.readySent = false
		}
		o.add(c.sess, cloud.MsgPrinterStatus, c.statusLocked(p))
		c.readyLocked(&o, p)
	}
	c.mu.Unlock()
	o.flush()
}

// inhibitChanged re-reports every printer when the desk switch flips: ready
// printers become inhibited or ready again.
func (c *cloudJobs) inhibitChanged() {
	var o out
	c.mu.Lock()
	for _, p := range c.printers {
		o.add(c.sess, cloud.MsgPrinterStatus, c.statusLocked(p))
		c.readyLocked(&o, p)
	}
	c.mu.Unlock()
	o.flush()
}

func (c *cloudJobs) result(r printer.Result) {
	var o out
	c.mu.Lock()
	p := c.printers[r.Serial]
	if p != nil {
		p.busy = false
	}
	switch r.Outcome {
	case printer.Dropped:
		// The server refused begin; it already knows.
	case printer.Released:
		o.add(c.sess, cloud.MsgJobRelease, cloud.JobRelease{JobID: r.JobID, LeaseID: r.LeaseID, Reason: r.Detail})
	default:
		msg := cloud.JobResult{JobID: r.JobID, LeaseID: r.LeaseID, Outcome: string(r.Outcome), Reason: r.Detail}
		// Kept until resultAck, and resent on every reconnect (at least once).
		c.unacked[r.JobID] = unacked{serial: r.Serial, msg: msg}
		o.add(c.sess, cloud.MsgJobResult, msg)
	}
	// A job that ended without the printer's state changing (failed,
	// released, dropped) wouldn't otherwise trigger a new printer:ready.
	if p != nil {
		c.readyLocked(&o, p)
	}
	c.mu.Unlock()
	o.flush()
}

// connected sends hello; nothing else goes out until welcome.
func (c *cloudJobs) connected(s *cloud.Session) error {
	entries, err := c.journal.List()
	if err != nil {
		slog.Error("cannot read journal for hello", "err", err)
	}
	h := cloud.Hello{Version: version, Hostname: c.hostname, Printers: []cloud.PrinterInfo{}, Journal: []cloud.JournalEntry{}}
	for serial, e := range entries {
		h.Journal = append(h.Journal, cloud.JournalEntry{
			Serial: serial, JobID: e.JobID, LeaseID: e.LeaseID, Phase: e.Phase, CounterBefore: e.CounterBefore, Outcome: e.Outcome,
		})
	}
	c.mu.Lock()
	for _, p := range c.printers {
		h.Printers = append(h.Printers, p.info)
	}
	c.mu.Unlock()
	sort.Slice(h.Printers, func(i, j int) bool { return h.Printers[i].Serial < h.Printers[j].Serial })
	return s.Send(cloud.MsgHello, h)
}

func (c *cloudJobs) disconnected(error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.sess = nil
	// No ack can arrive on a dead connection: no write (spec §7.5).
	for lease, ch := range c.begins {
		ch <- false
		delete(c.begins, lease)
	}
	for _, p := range c.printers {
		p.readySent = false
	}
}

func (c *cloudJobs) message(s *cloud.Session, m cloud.Envelope) {
	switch m.Name {
	case cloud.MsgWelcome:
		var w cloud.Welcome
		json.Unmarshal(m.Data, &w)
		slog.Info("cloud welcome", "relay", w.RelayID, "epoch", w.Epoch)
		var o out
		c.mu.Lock()
		c.sess = s
		for _, u := range c.unacked {
			o.add(s, cloud.MsgJobResult, u.msg)
		}
		for _, p := range c.printers {
			if p.config != nil {
				o.add(s, cloud.MsgPrinterConfig, cloud.PrinterConfig{Serial: p.info.Serial, Settings: p.config})
			}
			o.add(s, cloud.MsgPrinterStatus, c.statusLocked(p))
			c.readyLocked(&o, p)
		}
		c.mu.Unlock()
		o.flush()

	case cloud.MsgJobOffer:
		var offer cloud.JobOffer
		if err := json.Unmarshal(m.Data, &offer); err != nil {
			slog.Warn("bad job:offer", "err", err)
			return
		}
		go c.offer(s, offer)

	case cloud.MsgJobBeginAck:
		var a cloud.JobBeginAck
		json.Unmarshal(m.Data, &a)
		c.mu.Lock()
		if ch := c.begins[a.LeaseID]; ch != nil {
			delete(c.begins, a.LeaseID)
			ch <- a.OK
		}
		c.mu.Unlock()

	case cloud.MsgJobResultAck:
		var a cloud.JobResultAck
		json.Unmarshal(m.Data, &a)
		c.mu.Lock()
		u, ok := c.unacked[a.JobID]
		if ok && u.msg.LeaseID == a.LeaseID {
			delete(c.unacked, a.JobID)
		}
		c.mu.Unlock()
		if ok {
			if err := c.journal.Clear(u.serial, a.JobID); err != nil {
				slog.Error("cannot clear journal", "serial", u.serial, "job", a.JobID, "err", err)
			}
		}

	case cloud.MsgRelayAction:
		var a cloud.RelayAction
		if err := json.Unmarshal(m.Data, &a); err != nil {
			slog.Warn("bad relay:action", "err", err)
			return
		}
		go c.relayAction(s, a)

	case cloud.MsgPrinterAction:
		var a cloud.PrinterAction
		if err := json.Unmarshal(m.Data, &a); err != nil {
			slog.Warn("bad printer:action", "err", err)
			return
		}
		go c.action(s, a)

	default:
		slog.Debug("cloud: unhandled message", "name", m.Name)
	}
}

// offer hands a leased job to its printer's worker, or releases it.
func (c *cloudJobs) offer(s *cloud.Session, offer cloud.JobOffer) {
	log := slog.With("job", offer.JobID, "serial", offer.Serial)
	release := func(reason string) {
		log.Info("releasing job", "reason", reason)
		send(s, cloud.MsgJobRelease, cloud.JobRelease{JobID: offer.JobID, LeaseID: offer.LeaseID, Reason: reason})
	}

	c.mu.Lock()
	p := c.printers[offer.Serial]
	switch {
	case p == nil:
		c.mu.Unlock()
		release("printer not attached")
		return
	case p.busy:
		c.mu.Unlock()
		release("printer busy")
		return
	case c.desk.Inhibited():
		c.mu.Unlock()
		release("desk switch on pause")
		return
	}
	p.busy, p.readySent = true, false
	jobs := p.jobs
	c.mu.Unlock()

	job := &printer.Job{
		ID: offer.JobID, LeaseID: offer.LeaseID, PNG: offer.PNG, Width: offer.WidthDots, Height: offer.HeightDots,
		Begin: func(ctx context.Context) bool { return c.begin(ctx, offer.JobID, offer.LeaseID) },
	}
	log.Info("job offered", "png_bytes", len(offer.PNG))
	select {
	case jobs <- job:
		return
	case <-time.After(offerTimeout):
	case <-s.Done():
	}
	// The worker didn't take it: the printer stopped being ready meanwhile.
	var o out
	c.mu.Lock()
	if p := c.printers[offer.Serial]; p != nil && p.jobs == jobs {
		p.busy = false
		c.readyLocked(&o, p)
	}
	c.mu.Unlock()
	release("printer not ready")
	o.flush()
}

// begin is job:begin → job:beginAck (spec §7.2). Only true lets the worker
// write.
func (c *cloudJobs) begin(ctx context.Context, jobID, leaseID string) bool {
	ch := make(chan bool, 1)
	c.mu.Lock()
	s := c.sess
	if s == nil {
		c.mu.Unlock()
		return false
	}
	c.begins[leaseID] = ch
	c.mu.Unlock()
	forget := func() {
		c.mu.Lock()
		delete(c.begins, leaseID)
		c.mu.Unlock()
	}

	if err := s.Send(cloud.MsgJobBegin, cloud.JobBegin{JobID: jobID, LeaseID: leaseID}); err != nil {
		forget()
		return false
	}
	select {
	case ok := <-ch:
		return ok
	case <-time.After(beginTimeout):
		// The server may already have the job in sending. Tell it nothing was
		// written, so it re-queues the job now instead of at the next
		// reconnect (spec §13.5). True by construction: we never write
		// without an ack.
		slog.Warn("no beginAck; not writing, releasing the job", "job", jobID, "lease", leaseID)
		forget()
		send(s, cloud.MsgJobRelease, cloud.JobRelease{JobID: jobID, LeaseID: leaseID, Reason: "no beginAck"})
		return false
	case <-ctx.Done():
	}
	forget()
	return false
}

// heartbeat re-sends every printer's status periodically, so the server can
// tell a quiet relay from a dead one.
func (c *cloudJobs) heartbeat(ctx context.Context) {
	t := time.NewTicker(statusHeartbeat)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
		var o out
		c.mu.Lock()
		for _, p := range c.printers {
			o.add(c.sess, cloud.MsgPrinterStatus, c.statusLocked(p))
		}
		c.mu.Unlock()
		o.flush()
	}
}

// runCloud keeps the relay connected until ctx is done: enroll if there's no
// key, connect, and enroll again if the server rejects the key (revoked).
func runCloud(ctx context.Context, server, keyPath string, en *enroll.Enroller, cj *cloudJobs) {
	for ctx.Err() == nil {
		key, err := readKey(keyPath)
		if err != nil {
			if !errors.Is(err, fs.ErrNotExist) {
				slog.Warn("relay key unusable; enrolling again", "err", err)
			}
			if key, err = en.Run(ctx); err != nil {
				return // ctx done
			}
		}
		client := &cloud.Client{
			Server:       server,
			Key:          func() (string, error) { return key, nil },
			Connected:    cj.connected,
			Message:      cj.message,
			Disconnected: cj.disconnected,
		}
		err = client.Run(ctx)
		switch {
		case errors.Is(err, cloud.ErrUnauthorized):
			slog.Warn("relay key rejected (revoked?); enrolling again")
			os.Remove(keyPath)
		case err != nil:
			slog.Error("cloud connection disabled", "err", err)
			return
		}
	}
}

// attachedPrinters lists the printers plugged in right now, for the
// enrollment request.
func attachedPrinters(ports hw.PortMap) []cloud.PrinterInfo {
	out := []cloud.PrinterInfo{}
	for _, dev := range printer.Scan() {
		info := cloud.PrinterInfo{Serial: dev.Serial, Product: dev.Product}
		if led, ok := ports.LEDFor(dev.USBPath); ok {
			info.Port = led + 1
		}
		out = append(out, info)
	}
	return out
}

// readKey reads the relay key stored by enrollment.
func readKey(path string) (string, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	key := strings.TrimSpace(string(b))
	if key == "" {
		return "", fmt.Errorf("relay key %s is empty", path)
	}
	return key, nil
}
