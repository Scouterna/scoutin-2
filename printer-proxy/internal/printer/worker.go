package printer

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"github.com/Scouterna/scoutin-2/printer-proxy/internal/journal"
	"github.com/Scouterna/scoutin-2/printer-proxy/internal/zebra"
	"github.com/Scouterna/scoutin-2/printer-proxy/internal/zpl"
)

// State is what the relay reports for a printer.
type State string

const (
	Connecting   State = "connecting" // just appeared; USB is up before the firmware answers
	Ready        State = "ready"
	Printing     State = "printing"
	Paused       State = "paused"
	MediaOut     State = "media_out"
	HeadOpen     State = "head_open"
	Error        State = "error"
	Unresponsive State = "unresponsive"
	Offline      State = "offline" // was here, now gone
)

// Timings, see the spec (§8.3, §8.5).
const (
	idlePoll     = 2 * time.Second
	jobPoll      = 300 * time.Millisecond
	confirmDelay = 300 * time.Millisecond
	replyTimeout = time.Second
	// A printer that just appeared may refuse to open (udev hasn't applied
	// permissions yet) or not answer (firmware still booting). Neither is an
	// error during this window.
	startupGrace = 10 * time.Second
	retryDelay   = 300 * time.Millisecond
	// How long a printer may sit ready and empty after a write, with the
	// counter unchanged, before the job is given up as unknown.
	quietLimit = 10 * time.Second
)

// Update is one state change for a printer.
type Update struct {
	Device    Device
	State     State
	Detail    string
	WidthDots int // print width, once connected; 0 before
}

// Hooks connect a printer's worker to the rest of the relay.
type Hooks struct {
	Journal *journal.Dir
	// Jobs is received from only while the printer is ready and idle.
	Jobs <-chan *Job
	// Actions is received from only while no job is in flight and the
	// printer is ready, paused, out of media or open (spec §8.9).
	Actions    <-chan *Action
	Report     func(Update)
	Result     func(Result)
	Config     func(serial string, settings map[string]string) // optional
	ActionDone func(ActionResult)                              // optional
}

type watcher struct {
	dev     Device
	h       Hooks
	log     *slog.Logger
	started time.Time
	current State
	conn    *zebra.Conn

	widthDots int  // ezpl.print_width, read on connect
	set       bool // connected once: journal settled and buffer cleared
	job       *inflight
}

type inflight struct {
	*Job
	before   int64
	written  time.Time
	write    time.Duration
	bytes    int
	buffered time.Duration
	lastBusy time.Time // last poll that wasn't ready and empty
	pending  verdict   // a cancel verdict waits for a second poll to agree
	seen     State     // last derived state, for confirming changes
}

// Watch tracks one printer and runs its jobs until it disappears or ctx is
// done. It reports Connecting first, then every confirmed state change, and
// returns once the device is gone (after reporting Offline). A job in flight
// when the printer disappears stays in the journal and is settled when the
// printer comes back.
func Watch(ctx context.Context, dev Device, h Hooks) {
	if h.Config == nil {
		h.Config = func(string, map[string]string) {}
	}
	if h.ActionDone == nil {
		h.ActionDone = func(ActionResult) {}
	}
	w := &watcher{
		dev:     dev,
		h:       h,
		log:     slog.With("serial", dev.Serial, "node", dev.Node, "usb", dev.USBPath),
		started: time.Now(),
	}
	w.run(ctx)
}

func (w *watcher) setState(s State, detail string) {
	if s == w.current {
		return
	}
	w.current = s
	w.h.Report(Update{Device: w.dev, State: s, Detail: detail, WidthDots: w.widthDots})
}

func (w *watcher) inGrace() bool { return time.Since(w.started) < startupGrace }

// wait sleeps, but returns false at once if ctx ends or the printer goes away
// mid-sleep.
func (w *watcher) wait(ctx context.Context, d time.Duration) bool {
	_, _, ok := w.waitWork(ctx, d, nil, nil)
	return ok
}

// waitWork is wait that also returns a job or action arriving meanwhile, from
// whichever channels are non-nil.
func (w *watcher) waitWork(ctx context.Context, d time.Duration, jobs <-chan *Job, actions <-chan *Action) (*Job, *Action, bool) {
	var gone <-chan struct{}
	if w.conn != nil {
		gone = w.conn.Done()
	}
	select {
	case <-ctx.Done():
		return nil, nil, false
	case <-gone:
		return nil, nil, false
	case j := <-jobs:
		return j, nil, true
	case a := <-actions:
		return nil, a, true
	case <-time.After(d):
		return nil, nil, true
	}
}

func (w *watcher) run(ctx context.Context) {
	w.setState(Connecting, "")
	defer func() {
		if w.conn != nil {
			w.conn.Close()
		}
	}()

loop:
	for ctx.Err() == nil {
		if w.conn == nil {
			c, err := zebra.Open(w.dev.Node)
			switch {
			case err == nil:
				w.conn = c
			case errors.Is(err, fs.ErrNotExist):
				w.setState(Offline, "")
				return
			case errors.Is(err, fs.ErrPermission) && w.inGrace():
				w.wait(ctx, retryDelay)
				continue
			default:
				w.log.Warn("cannot open printer", "err", err)
				w.setState(Error, err.Error())
				if !w.wait(ctx, idlePoll) {
					break loop
				}
				continue
			}
		}

		var err error
		switch {
		case !w.set:
			err = w.connect()
		case w.job != nil:
			err = w.track()
			if err == nil {
				if !w.wait(ctx, jobPoll) {
					break loop
				}
				continue
			}
		default:
			var job *Job
			var action *Action
			job, action, err = w.idle(ctx)
			if job != nil {
				w.start(ctx, job)
				continue
			}
			if action != nil {
				err = w.runAction(action)
			}
			if err == nil && ctx.Err() != nil {
				break loop
			}
		}
		if err != nil {
			if errors.Is(err, zebra.ErrClosed) {
				break loop
			}
			if !w.inGrace() {
				w.log.Warn("no reply from printer", "err", err)
				w.setState(Unresponsive, err.Error())
			}
			// Reopen: a timed-out query can leave the conversation out of step.
			w.conn.Close()
			w.conn = nil
			if !w.wait(ctx, retryDelay) {
				break loop
			}
		}
	}

	if w.conn != nil {
		select {
		case <-w.conn.Done():
			if w.job != nil {
				w.log.Warn("printer went away with a job in flight; it settles when the printer is back", "job", w.job.ID)
			}
			w.setState(Offline, "")
		default:
		}
	}
}

// connect runs once per appearance, before the printer may take jobs (spec
// §8.9): read what rendering needs, settle the journal, then clear the
// printer's buffer so every session starts empty.
func (w *watcher) connect() error {
	if _, _, err := w.conn.Status(replyTimeout); err != nil {
		return err // still booting, most likely
	}
	v, err := w.conn.GetVar("ezpl.print_width", replyTimeout)
	if err != nil {
		return err
	}
	width, err := strconv.Atoi(strings.TrimSpace(v))
	if err != nil {
		return fmt.Errorf("print width: bad value %q", v)
	}
	w.widthDots = width

	cfg, err := w.readConfig(ConfigKeys)
	if err != nil {
		return err
	}
	w.h.Config(w.dev.Serial, cfg)

	e, err := w.h.Journal.Load(w.dev.Serial)
	if err != nil {
		w.log.Error("cannot read journal", "err", err)
		// Without the journal we can't tell what the buffer holds; clearing it
		// is still right, and the job's state is resolved upstream.
	}
	if e != nil {
		if err := w.settleJournal(e); err != nil {
			return err
		}
	}
	if err := w.conn.Send("~JA"); err != nil {
		return err
	}
	w.set = true
	w.log.Info("printer connected", "print_width", width)
	return nil
}

func (w *watcher) settleJournal(e *journal.Entry) error {
	if e.Phase == journal.PhaseResult {
		// Outcome known but not acknowledged: deliver again.
		w.h.Result(Result{Serial: w.dev.Serial, JobID: e.JobID, LeaseID: e.LeaseID, Outcome: Outcome(e.Outcome), Detail: e.Detail})
		return nil
	}
	hs, _, err := w.conn.Status(replyTimeout)
	if err != nil {
		return err
	}
	now, err := w.conn.LabelCount(replyTimeout)
	if err != nil {
		return err
	}
	v := settle(hs, e.CounterBefore, now)
	w.log.Info("settling journalled job", "job", e.JobID, "counter_before", e.CounterBefore, "counter_now", now,
		"formats", hs.FormatsInBuffer, "labels_remaining", hs.LabelsRemaining, "outcome", v.outcome)
	if v.cancel {
		if err := w.conn.Send("~JA"); err != nil {
			return err
		}
	}
	w.commit(e.JobID, e.LeaseID, v, nil)
	return nil
}

// idle polls a printer with nothing in flight. While it's ready it also
// accepts a job, and while it's idle enough, an action.
func (w *watcher) idle(ctx context.Context) (*Job, *Action, error) {
	state, _, err := poll(w.conn)
	if err != nil {
		return nil, nil, err
	}
	// The two replies are a moment apart and can briefly disagree, so a
	// change only counts once a second poll agrees.
	if state != w.current {
		if !w.wait(ctx, confirmDelay) {
			return nil, nil, nil
		}
		again, detail, err := poll(w.conn)
		if err != nil {
			return nil, nil, err
		}
		if again == state {
			w.setState(state, detail)
		}
		return nil, nil, nil
	}
	var jobs <-chan *Job
	var actions <-chan *Action
	if w.current == Ready {
		jobs = w.h.Jobs
	}
	if idleForActions(w.current) {
		actions = w.h.Actions
	}
	job, action, _ := w.waitWork(ctx, idlePoll, jobs, actions)
	return job, action, nil
}

// start takes a job from offer to written (spec §7.2, §8.4).
func (w *watcher) start(ctx context.Context, job *Job) {
	log := w.log.With("job", job.ID)
	result := func(o Outcome, detail string) {
		log.Info("job ended before writing", "outcome", o, "detail", detail)
		w.h.Result(Result{Serial: w.dev.Serial, JobID: job.ID, LeaseID: job.LeaseID, Outcome: o, Detail: detail})
	}

	bm, err := zpl.DecodePNG(job.PNG, job.Width, job.Height, w.widthDots)
	if err != nil {
		result(Failed, err.Error())
		return
	}
	data := zpl.Label(bm)

	// Still healthy? The last poll may be up to 2 s old.
	state, detail, err := poll(w.conn)
	if err != nil || state != Ready {
		if err != nil {
			detail = err.Error()
		}
		result(Released, fmt.Sprintf("printer not ready (%s): %s", state, detail))
		return
	}
	// The counter is read before begin, so a printer that can't answer is
	// released rather than leaving the job in sending. Nothing can move it in
	// between: the printer is idle and only this worker prints on it.
	before, err := w.conn.LabelCount(replyTimeout)
	if err != nil {
		result(Released, err.Error())
		return
	}

	if !job.Begin(ctx) {
		result(Dropped, "begin refused")
		return
	}
	if err := w.h.Journal.Save(w.dev.Serial, journal.Entry{
		JobID: job.ID, LeaseID: job.LeaseID, Phase: journal.PhaseIntent, CounterBefore: before,
	}); err != nil {
		// Nothing was written, so this is a definite not_sent.
		log.Error("cannot write journal intent", "err", err)
		w.commit(job.ID, job.LeaseID, verdict{outcome: NotSent, detail: "journal: " + err.Error()}, nil)
		return
	}

	w.setState(Printing, "")
	t0 := time.Now()
	n, err := w.conn.Write(data)
	f := &inflight{Job: job, before: before, written: t0, write: time.Since(t0), bytes: len(data), lastBusy: time.Now(), seen: Printing}
	w.job = f
	if err != nil {
		// Some of it may have reached the printer; tracking and the counter
		// decide, like any other job in flight.
		log.Error("write to printer failed", "err", err, "written", n, "of", len(data))
		return
	}
	log.Info("job written", "bytes", len(data), "raw_bytes", len(bm.Data), "write", f.write.Round(time.Millisecond), "counter_before", before)
}

// track polls the printer with a job in flight (spec §8.5).
func (w *watcher) track() error {
	f := w.job
	hs, es, err := w.conn.Status(replyTimeout)
	if err != nil {
		return err
	}
	now, err := w.conn.LabelCount(replyTimeout)
	if err != nil {
		return err
	}
	st := zebra.Derive(hs, es)
	elapsed := time.Since(f.written)
	// The poll-by-poll timeline, to see when "printed" fires relative to the
	// label coming out (spec §8.5 SPIKE). Visible with -debug.
	w.log.Debug("job poll", "job", f.ID, "t", elapsed.Round(time.Millisecond), "state", st,
		"formats", hs.FormatsInBuffer, "labels_remaining", hs.LabelsRemaining, "counter", now)

	if f.buffered == 0 && !bufferEmpty(hs) {
		f.buffered = elapsed
		w.log.Debug("job in printer buffer", "job", f.ID, "after", elapsed.Round(time.Millisecond))
	}
	if st != zebra.StateReady || !bufferEmpty(hs) {
		f.lastBusy = time.Now()
	}

	// Report the printer's state, confirmed by two polls in a row. Ready with
	// a job in flight is still printing as far as leasing goes.
	shown := State(st)
	if st == zebra.StateReady {
		shown = Printing
	}
	if shown == f.seen {
		w.setState(shown, strings.Join(append(es.ErrorNames(), es.WarningNames()...), ", "))
	}
	f.seen = shown

	v := judge(st, hs, f.before, now, time.Since(f.lastBusy) > quietLimit)
	if v.outcome == "" {
		f.pending = verdict{}
		return nil
	}
	// Canceling throws the job away, so that needs two polls to agree.
	if v.cancel && f.pending != v {
		f.pending = v
		return nil
	}
	if v.cancel {
		if err := w.conn.Send("~JA"); err != nil {
			return err
		}
	}
	if moved := now - f.before; moved > 1 {
		w.log.Warn("label counter moved by more than one", "job", f.ID, "moved", moved)
	}
	t := &Timings{Bytes: f.bytes, Write: f.write, Buffered: f.buffered, Done: elapsed, CounterMov: now - f.before}
	w.commit(f.ID, f.LeaseID, v, t)
	w.job = nil
	return nil
}

// commit journals an outcome, then delivers it. The entry stays until the
// result is acknowledged.
func (w *watcher) commit(jobID, leaseID string, v verdict, t *Timings) {
	if err := w.h.Journal.Save(w.dev.Serial, journal.Entry{
		JobID: jobID, LeaseID: leaseID, Phase: journal.PhaseResult, Outcome: string(v.outcome), Detail: v.detail,
	}); err != nil {
		w.log.Error("cannot write journal result", "job", jobID, "err", err)
	}
	args := []any{"job", jobID, "outcome", v.outcome, "detail", v.detail}
	if t != nil {
		args = append(args, "write", t.Write.Round(time.Millisecond), "buffered", t.Buffered.Round(time.Millisecond), "done", t.Done.Round(time.Millisecond), "counter_moved", t.CounterMov)
	}
	w.log.Info("job finished", args...)
	w.h.Result(Result{Serial: w.dev.Serial, JobID: jobID, LeaseID: leaseID, Outcome: v.outcome, Detail: v.detail, Timings: t})
}

func poll(conn *zebra.Conn) (State, string, error) {
	hs, es, err := conn.Status(replyTimeout)
	if err != nil {
		return "", "", err
	}
	detail := strings.Join(append(es.ErrorNames(), es.WarningNames()...), ", ")
	return State(zebra.Derive(hs, es)), detail, nil
}
