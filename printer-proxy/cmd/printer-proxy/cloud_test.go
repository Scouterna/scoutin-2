package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"image"
	"image/color"
	"image/png"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Scouterna/scoutin-2/printer-proxy/internal/cloud"
	"github.com/Scouterna/scoutin-2/printer-proxy/internal/cloud/fakecloud"
	"github.com/Scouterna/scoutin-2/printer-proxy/internal/desk"
	"github.com/Scouterna/scoutin-2/printer-proxy/internal/enroll"
	"github.com/Scouterna/scoutin-2/printer-proxy/internal/journal"
	"github.com/Scouterna/scoutin-2/printer-proxy/internal/printer"
)

// rig is a relay's cloud side connected to a fake server, with one pretend
// printer whose worker the test plays.
type rig struct {
	t       *testing.T
	ctx     context.Context
	fake    *fakecloud.Server
	cj      *cloudJobs
	jr      *journal.Dir
	dev     printer.Device
	jobs    chan *printer.Job
	actions chan *printer.Action
}

func newRig(t *testing.T, fake *fakecloud.Server) *rig {
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	fake.Key = "k"
	ts := httptest.NewServer(fake)
	t.Cleanup(ts.Close)

	jr, err := journal.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	cj := newCloudJobs(desk.New(4), jr, "test-pi")
	client := &cloud.Client{
		Server: ts.URL, Key: func() (string, error) { return "k", nil },
		Connected: cj.connected, Message: cj.message, Disconnected: cj.disconnected,
	}
	go client.Run(ctx)

	r := &rig{t: t, ctx: ctx, fake: fake, cj: cj, jr: jr, dev: printer.Device{Serial: "S1", Product: "ZD421"}}
	r.jobs, r.actions = cj.attach(r.dev, 1)
	cj.report(printer.Update{Device: r.dev, State: printer.Ready, WidthDots: 800})
	return r
}

func badge(t *testing.T) []byte {
	img := image.NewPaletted(image.Rect(0, 0, 16, 4), color.Palette{color.White, color.Black})
	var b bytes.Buffer
	if err := png.Encode(&b, img); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

// next waits for the worker to be handed a job.
func (r *rig) next() *printer.Job {
	r.t.Helper()
	select {
	case j := <-r.jobs:
		return j
	case <-time.After(5 * time.Second):
		r.t.Fatal("no job offered")
		return nil
	}
}

// print plays a worker printing the job successfully.
func (r *rig) print(j *printer.Job) {
	r.t.Helper()
	if !j.Begin(r.ctx) {
		r.t.Fatal("begin refused")
	}
	r.jr.Save(r.dev.Serial, journal.Entry{JobID: j.ID, LeaseID: j.LeaseID, Phase: journal.PhaseIntent, CounterBefore: 1})
	r.cj.report(printer.Update{Device: r.dev, State: printer.Printing})
	r.jr.Save(r.dev.Serial, journal.Entry{JobID: j.ID, LeaseID: j.LeaseID, Phase: journal.PhaseResult, Outcome: "printed"})
	r.cj.result(printer.Result{Serial: r.dev.Serial, JobID: j.ID, LeaseID: j.LeaseID, Outcome: printer.Printed})
	r.cj.report(printer.Update{Device: r.dev, State: printer.Ready})
}

func (r *rig) waitJob(id, state string) {
	r.t.Helper()
	ctx, cancel := context.WithTimeout(r.ctx, 5*time.Second)
	defer cancel()
	for {
		j, _ := r.fake.Job(id)
		if j.State == state {
			return
		}
		select {
		case <-ctx.Done():
			r.t.Fatalf("job %s is %s, want %s", id, j.State, state)
		case <-time.After(20 * time.Millisecond):
		}
	}
}

func (r *rig) waitJournalEmpty() {
	r.t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if e, _ := r.jr.Load(r.dev.Serial); e == nil {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	e, _ := r.jr.Load(r.dev.Serial)
	r.t.Fatalf("journal not cleared: %+v", e)
}

func TestCloudPrint(t *testing.T) {
	r := newRig(t, &fakecloud.Server{})
	for range 2 {
		job := r.fake.AddJob("S1", badge(t))
		j := r.next()
		if j.ID != job.ID || j.Width != 16 || j.Height != 4 {
			t.Fatalf("offered %+v", j)
		}
		r.print(j)
		r.waitJob(job.ID, fakecloud.Printed)
		r.waitJournalEmpty()
	}
}

func TestResultResentAfterReconnect(t *testing.T) {
	r := newRig(t, &fakecloud.Server{DropResultAcks: 1})
	job := r.fake.AddJob("S1", badge(t))
	r.print(r.next())
	r.waitJob(job.ID, fakecloud.Printed)

	// No ack yet, so the journal must still hold the result.
	time.Sleep(200 * time.Millisecond)
	if e, _ := r.jr.Load("S1"); e == nil {
		t.Fatal("journal cleared without an ack")
	}
	r.fake.DisconnectAll()
	r.waitJournalEmpty()
}

func TestLostBeginAckMeansNoWrite(t *testing.T) {
	old := beginTimeout
	beginTimeout = 300 * time.Millisecond
	t.Cleanup(func() { beginTimeout = old })

	r := newRig(t, &fakecloud.Server{DropBeginAcks: 1})
	job := r.fake.AddJob("S1", badge(t))
	j := r.next()
	if j.Begin(r.ctx) {
		t.Fatal("begin succeeded without an ack")
	}
	r.cj.result(printer.Result{Serial: "S1", JobID: j.ID, LeaseID: j.LeaseID, Outcome: printer.Dropped})
	// The relay released it, so the server re-queues it from sending and offers
	// it again, without waiting for a reconnect (spec §13.5).
	j = r.next()
	if j.ID != job.ID {
		t.Fatalf("offered %s, want the re-queued %s", j.ID, job.ID)
	}
	r.print(j)
	r.waitJob(job.ID, fakecloud.Printed)
}

func TestInhibitedReleases(t *testing.T) {
	r := newRig(t, &fakecloud.Server{})
	r.cj.desk.SetInhibited(true)
	r.cj.inhibitChanged()
	job := r.fake.AddJob("S1", badge(t))

	select {
	case j := <-r.jobs:
		t.Fatalf("job %s offered to an inhibited printer", j.ID)
	case <-time.After(300 * time.Millisecond):
	}
	if j, _ := r.fake.Job(job.ID); j.State != fakecloud.Queued {
		t.Fatalf("job is %s, want queued", j.State)
	}

	r.cj.desk.SetInhibited(false)
	r.cj.inhibitChanged()
	r.print(r.next())
	r.waitJob(job.ID, fakecloud.Printed)
}

func TestApplyProfileAction(t *testing.T) {
	r := newRig(t, &fakecloud.Server{})
	waitConnected(t, r)
	profile := map[string]string{"wlan.enable": "off", "print.tone": "15.0"}

	type outcome struct {
		res cloud.PrinterActionResult
		err error
	}
	got := make(chan outcome, 1)
	go func() {
		res, err := r.fake.Action(r.ctx, "S1", printer.ApplyProfile, profile)
		got <- outcome{res, err}
	}()

	var a *printer.Action
	select {
	case a = <-r.actions:
	case <-time.After(5 * time.Second):
		t.Fatal("action not delivered to the worker")
	}
	if a.Kind != printer.ApplyProfile || a.Settings["wlan.enable"] != "off" {
		t.Fatalf("worker got %+v", a)
	}

	// While the action runs, the printer must not be offered a job.
	job := r.fake.AddJob("S1", badge(t))
	select {
	case j := <-r.jobs:
		t.Fatalf("job %s offered during an action", j.ID)
	case <-time.After(300 * time.Millisecond):
	}

	// Play the worker: report the new settings, then the result, with a restart.
	r.cj.config("S1", map[string]string{"wlan.enable": "off", "print.tone": "15.0", "head.resolution.in_dpi": "203"})
	r.cj.actionDone(printer.ActionResult{
		ID: a.ID, Serial: "S1", OK: true, Restart: true,
		Results: map[string]printer.SettingResult{"wlan.enable": {Applied: true, Value: "off"}, "print.tone": {Applied: true, Value: "15.0"}},
	})

	o := <-got
	if o.err != nil || !o.res.OK || !o.res.Restart || !o.res.Results["wlan.enable"].Applied {
		t.Fatalf("action result %+v, %v", o.res, o.err)
	}
	if cfg, ok := r.fake.Config("S1"); !ok || cfg.Settings["wlan.enable"] != "off" {
		t.Fatalf("server's config for S1: %+v", cfg)
	}

	// Done: the queued job is offered now.
	if j := r.next(); j.ID != job.ID {
		t.Fatalf("offered %s, want %s", j.ID, job.ID)
	}
}

func TestActionRefusedDuringJob(t *testing.T) {
	r := newRig(t, &fakecloud.Server{})
	r.fake.AddJob("S1", badge(t))
	r.next() // in flight, never finished

	res, err := r.fake.Action(r.ctx, "S1", printer.CancelBuffer, nil)
	if err != nil || res.OK || res.Error != "printer busy" {
		t.Fatalf("got %+v, %v; want refused as busy", res, err)
	}
}

// waitConnected waits until the server has the printer waiting for a job,
// so it knows where to route actions.
func waitConnected(t *testing.T, r *rig) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		rec := httptest.NewRecorder()
		r.fake.ServeHTTP(rec, httptest.NewRequest("GET", "/printers", nil))
		var ps []fakecloud.PrinterView
		json.Unmarshal(rec.Body.Bytes(), &ps)
		for _, p := range ps {
			if p.Serial == "S1" && p.Waiting {
				return
			}
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("printer never reached the server")
}

func TestRevokedKeyEnrollsAgain(t *testing.T) {
	old := enroll.PollInterval
	enroll.PollInterval = 20 * time.Millisecond
	t.Cleanup(func() { enroll.PollInterval = old })

	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	fake := &fakecloud.Server{Key: "unused"} // only issued keys work
	ts := httptest.NewServer(fake)
	t.Cleanup(ts.Close)
	jr, _ := journal.Open(t.TempDir())
	dir := t.TempDir()
	cj := newCloudJobs(desk.New(4), jr, "test-pi")
	shown := make(chan enroll.Enrollment, 4)
	en := &enroll.Enroller{
		Server: ts.URL, StateDir: dir, Hostname: "test-pi",
		Printers: func() []cloud.PrinterInfo { return nil },
		Show:     func(e enroll.Enrollment) { shown <- e },
		Clear:    func() {},
	}
	go runCloud(ctx, ts.URL, filepath.Join(dir, "key"), en, cj)

	connected := func() bool {
		cj.mu.Lock()
		defer cj.mu.Unlock()
		return cj.sess != nil
	}
	waitFor := func(what string, cond func() bool) {
		t.Helper()
		deadline := time.Now().Add(5 * time.Second)
		for !cond() {
			if time.Now().After(deadline) {
				t.Fatalf("timed out waiting for %s", what)
			}
			time.Sleep(20 * time.Millisecond)
		}
	}
	pair := func() string {
		t.Helper()
		select {
		case e := <-shown:
			key, ok := fake.Pair(strings.Join(e.Colors, ","))
			if !ok {
				t.Fatal("pairing failed")
			}
			return key
		case <-time.After(5 * time.Second):
			t.Fatal("no code shown")
			return ""
		}
	}

	key := pair()
	waitFor("connection with the first key", connected)

	fake.Revoke(key)
	key2 := pair() // a new code appears once the server rejects the old key
	if key2 == key {
		t.Fatal("same key after revoking")
	}
	waitFor("connection with the new key", connected)
	if b, _ := os.ReadFile(filepath.Join(dir, "key")); strings.TrimSpace(string(b)) != key2 {
		t.Fatalf("stored key %q, want %q", b, key2)
	}
}

func TestRelayPowerOff(t *testing.T) {
	oldDelay := powerDelay
	powerDelay = 10 * time.Millisecond
	t.Cleanup(func() { powerDelay = oldDelay })

	r := newRig(t, &fakecloud.Server{})
	waitConnected(t, r)
	called := make(chan string, 2)
	fail := false
	var mu sync.Mutex
	r.cj.power = func(kind string) error {
		called <- kind
		mu.Lock()
		defer mu.Unlock()
		if fail {
			return errors.New("polkit said no")
		}
		return nil
	}

	res, err := r.fake.RelayAction(r.ctx, "S1", "poweroff")
	if err != nil || !res.OK {
		t.Fatalf("result %+v, %v", res, err)
	}
	if kind := <-called; kind != "poweroff" {
		t.Fatalf("ran %q", kind)
	}
	if !r.cj.desk.Halting() {
		t.Error("LEDs not showing safe-to-unplug")
	}

	// A failed power-off puts the LEDs back.
	r.cj.desk.SetHalting(false)
	mu.Lock()
	fail = true
	mu.Unlock()
	r.fake.RelayAction(r.ctx, "S1", "poweroff")
	<-called
	deadline := time.Now().Add(2 * time.Second)
	for r.cj.desk.Halting() && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if r.cj.desk.Halting() {
		t.Error("LEDs still halted after a failed power-off")
	}

	if res, _ := r.fake.RelayAction(r.ctx, "S1", "selfdestruct"); res.OK {
		t.Error("unknown kind accepted")
	}
}
