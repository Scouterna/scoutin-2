package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"image/png"
	"io"
	"log/slog"
	"net"
	"os"
	"sync"
	"time"

	"github.com/Scouterna/scoutin-2/printer-proxy/internal/desk"
	"github.com/Scouterna/scoutin-2/printer-proxy/internal/journal"
	"github.com/Scouterna/scoutin-2/printer-proxy/internal/printer"
)

// Until the cloud connection exists, jobs come in over a local unix socket
// (`printer-proxy print`). The device node can only be opened by one process,
// so a separate tool couldn't print while the daemon runs.

const defaultControl = "/run/printer-proxy/control.sock"

// offerTimeout is how long a job waits for its printer to be ready and idle.
const offerTimeout = 3 * time.Second

type printRequest struct {
	Serial string `json:"serial"`
	PNG    []byte `json:"png"`
}

type printReply struct {
	JobID   string           `json:"jobId,omitempty"`
	Outcome printer.Outcome  `json:"outcome,omitempty"`
	Detail  string           `json:"detail,omitempty"`
	Timings *printer.Timings `json:"timings,omitempty"`
	Error   string           `json:"error,omitempty"`
}

// jobs routes local jobs to printer workers and their results back. It plays
// the cloud's part: it begins every job at once and acknowledges every result
// as soon as it's delivered.
type jobs struct {
	desk    *desk.Desk
	journal *journal.Dir

	mu      sync.Mutex
	workers map[string]chan *printer.Job // serial → its worker's job channel
	waiters map[string]waiter            // job ID → the client waiting for it
}

type waiter struct {
	serial string
	done   chan printer.Result
}

func newJobs(d *desk.Desk, j *journal.Dir) *jobs {
	return &jobs{desk: d, journal: j, workers: map[string]chan *printer.Job{}, waiters: map[string]waiter{}}
}

// attach registers a printer's worker and returns its job channel.
func (s *jobs) attach(dev printer.Device, port int) (chan *printer.Job, chan *printer.Action) {
	ch := make(chan *printer.Job)
	s.mu.Lock()
	s.workers[dev.Serial] = ch
	s.mu.Unlock()
	// No maintenance actions in local-only mode.
	return ch, nil
}

// detach is called once the worker has returned. A client still waiting is
// told; its job is settled from the journal when the printer comes back.
func (s *jobs) detach(serial string, ch chan *printer.Job) {
	s.mu.Lock()
	if s.workers[serial] == ch {
		delete(s.workers, serial)
	}
	for id, w := range s.waiters {
		if w.serial == serial {
			delete(s.waiters, id)
			w.done <- printer.Result{JobID: id, Detail: "printer went away mid-job; the outcome settles from the journal when it's back"}
		}
	}
	s.mu.Unlock()
}

func (s *jobs) report(printer.Update)            {}
func (s *jobs) inhibitChanged()                  {}
func (s *jobs) config(string, map[string]string) {}
func (s *jobs) actionDone(printer.ActionResult)  {}

// result receives every outcome from the workers, delivers it and
// acknowledges it.
func (s *jobs) result(r printer.Result) {
	s.mu.Lock()
	w := s.waiters[r.JobID]
	delete(s.waiters, r.JobID)
	s.mu.Unlock()
	if w.done != nil {
		w.done <- r
	} else {
		slog.Info("job result with nobody waiting", "serial", r.Serial, "job", r.JobID, "outcome", r.Outcome, "detail", r.Detail)
	}
	if err := s.journal.Clear(r.Serial, r.JobID); err != nil {
		slog.Error("cannot clear journal", "serial", r.Serial, "job", r.JobID, "err", err)
	}
}

func (s *jobs) submit(ctx context.Context, req printRequest) printReply {
	if s.desk.Inhibited() {
		return printReply{Error: "desk switch is on pause"}
	}
	s.mu.Lock()
	ch := s.workers[req.Serial]
	s.mu.Unlock()
	if ch == nil {
		return printReply{Error: "printer not connected: " + req.Serial}
	}

	// The image's own size stands in for the size in a cloud offer. If it
	// doesn't decode, the worker fails the job as invalid_image.
	var w, h int
	if cfg, err := png.DecodeConfig(bytes.NewReader(req.PNG)); err == nil {
		w, h = cfg.Width, cfg.Height
	}
	id := newID()
	job := &printer.Job{
		ID: id, LeaseID: id, PNG: req.PNG, Width: w, Height: h,
		Begin: func(context.Context) bool { return true },
	}
	done := make(chan printer.Result, 1)
	s.mu.Lock()
	s.waiters[id] = waiter{serial: req.Serial, done: done}
	s.mu.Unlock()
	forget := func() {
		s.mu.Lock()
		delete(s.waiters, id)
		s.mu.Unlock()
	}

	select {
	case ch <- job:
	case <-time.After(offerTimeout):
		forget()
		return printReply{JobID: id, Error: "printer is busy or not ready"}
	case <-ctx.Done():
		forget()
		return printReply{JobID: id, Error: "shutting down"}
	}
	slog.Info("local job accepted", "serial", req.Serial, "job", id, "png_bytes", len(req.PNG))

	select {
	case r := <-done:
		if r.Outcome == "" {
			return printReply{JobID: id, Error: r.Detail}
		}
		return printReply{JobID: id, Outcome: r.Outcome, Detail: r.Detail, Timings: r.Timings}
	case <-ctx.Done():
		forget()
		return printReply{JobID: id, Error: "shutting down; the job settles from the journal on restart"}
	}
}

func newID() string {
	b := make([]byte, 8)
	rand.Read(b)
	return "local-" + hex.EncodeToString(b)
}

// serveControl accepts print requests until ctx is done.
func serveControl(ctx context.Context, path string, s *jobs) error {
	os.Remove(path) // stale socket from an earlier run
	l, err := net.Listen("unix", path)
	if err != nil {
		return err
	}
	os.Chmod(path, 0o660)
	go func() {
		<-ctx.Done()
		l.Close()
	}()
	slog.Info("local print socket", "path", path)
	for {
		c, err := l.Accept()
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			return err
		}
		go func() {
			defer c.Close()
			var req printRequest
			var reply printReply
			if err := json.NewDecoder(c).Decode(&req); err != nil {
				reply.Error = "bad request: " + err.Error()
			} else {
				reply = s.submit(ctx, req)
			}
			json.NewEncoder(c).Encode(reply)
		}()
	}
}

// printCmd is `printer-proxy print`: send one 1-bit PNG to a printer through
// the running daemon and wait for the outcome.
func printCmd(args []string) int {
	fs := flag.NewFlagSet("print", flag.ExitOnError)
	control := fs.String("control", defaultControl, "daemon's local print socket")
	fs.Usage = func() {
		fmt.Fprintf(os.Stderr, "usage: printer-proxy print [flags] <serial> <badge.png>\n\nThe PNG must be 1-bit, no wider than the printer's print width.\n\n")
		fs.PrintDefaults()
	}
	fs.Parse(args)
	if fs.NArg() != 2 {
		fs.Usage()
		return 2
	}
	img, err := os.ReadFile(fs.Arg(1))
	if err != nil {
		fmt.Fprintln(os.Stderr, "printer-proxy:", err)
		return 1
	}

	c, err := net.Dial("unix", *control)
	if err != nil {
		fmt.Fprintln(os.Stderr, "printer-proxy: is the daemon running?", err)
		return 1
	}
	defer c.Close()
	start := time.Now()
	if err := json.NewEncoder(c).Encode(printRequest{Serial: fs.Arg(0), PNG: img}); err != nil {
		fmt.Fprintln(os.Stderr, "printer-proxy:", err)
		return 1
	}
	var r printReply
	if err := json.NewDecoder(c).Decode(&r); err != nil {
		if errors.Is(err, io.EOF) {
			err = errors.New("daemon closed the connection")
		}
		fmt.Fprintln(os.Stderr, "printer-proxy:", err)
		return 1
	}
	if r.Error != "" {
		fmt.Fprintf(os.Stderr, "printer-proxy: %s (job %s)\n", r.Error, r.JobID)
		return 1
	}
	fmt.Printf("job %s: %s", r.JobID, r.Outcome)
	if r.Detail != "" {
		fmt.Printf(" (%s)", r.Detail)
	}
	fmt.Println()
	if t := r.Timings; t != nil {
		fmt.Printf("  %d bytes, write %s, in buffer after %s, done after %s, counter +%d\n",
			t.Bytes, t.Write.Round(time.Millisecond), t.Buffered.Round(time.Millisecond), t.Done.Round(time.Millisecond), t.CounterMov)
	}
	fmt.Printf("  round trip %s\n", time.Since(start).Round(time.Millisecond))
	if r.Outcome != printer.Printed {
		return 1
	}
	return 0
}
