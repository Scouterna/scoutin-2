package printer

import (
	"context"
	"time"

	"github.com/Scouterna/scoutin-2/printer-proxy/internal/zebra"
)

// Job is one badge offered to a printer (spec §7.2).
type Job struct {
	ID, LeaseID   string
	PNG           []byte
	Width, Height int // as rendered; the image must match
	// Begin asks for permission to write (job:begin → beginAck). False means
	// the lease is gone and the job is dropped without writing.
	Begin func(context.Context) bool
}

// Outcome is how a job ended on this relay.
type Outcome string

const (
	Printed  Outcome = "printed"
	NotSent  Outcome = "not_sent" // provably never printed and can't print later: re-queue
	Unknown  Outcome = "unknown"  // may have printed: staff decide
	Failed   Outcome = "failed"   // permanent, never written (e.g. invalid image)
	Released Outcome = "released" // printer not healthy, never begun: re-queue
	Dropped  Outcome = "dropped"  // begin refused, never written
)

// Result is a job's outcome. Printed, NotSent and Unknown are journalled and
// must be acknowledged (journal Clear) once delivered.
type Result struct {
	Serial  string
	JobID   string
	LeaseID string
	Outcome Outcome
	Detail  string
	Timings *Timings // nil for jobs settled from the journal
}

// Timings of one job, measured from the start of the USB write.
type Timings struct {
	Bytes      int
	Write      time.Duration // write() returned
	Buffered   time.Duration // first poll showing the format in the printer, 0 if never seen
	Done       time.Duration // outcome decided
	CounterMov int64         // how far the label counter moved
}

// verdict is what to do with an in-flight job after a poll.
type verdict struct {
	outcome Outcome // "" = keep waiting
	cancel  bool    // send ~JA before committing the outcome
	detail  string
}

func bufferEmpty(hs zebra.HostStatus) bool { return hs.FormatsInBuffer == 0 && hs.LabelsRemaining == 0 }

// judge decides an in-flight job from one poll (spec §8.5). quiet is true once
// the printer has sat ready and empty, without the counter moving, for longer
// than it could take to pick the format up.
func judge(st zebra.State, hs zebra.HostStatus, before, now int64, quiet bool) verdict {
	moved := now > before
	switch {
	case moved && bufferEmpty(hs):
		// Whatever state it's in now (media out at the next mark, lid opened
		// right after), the label came out.
		return verdict{outcome: Printed}
	case st == zebra.StateMediaOut && !moved:
		return verdict{outcome: NotSent, cancel: true, detail: "media out before the label started"}
	case st == zebra.StateMediaOut:
		return verdict{outcome: Unknown, cancel: true, detail: "media out mid-label"}
	case quiet && st == zebra.StateReady && !moved:
		// The bytes were written but the printer printed nothing and holds
		// nothing. Not re-queued: a format the printer discards would loop.
		return verdict{outcome: Unknown, cancel: true, detail: "printer accepted the job but printed nothing"}
	}
	return verdict{}
}

// settle resolves a journalled intent when the printer (re)connects (spec
// §7.4). The printer's buffer is canceled (~JA) before any outcome is
// committed, so a held job can't print later.
func settle(hs zebra.HostStatus, before, now int64) verdict {
	moved := now > before
	switch {
	case moved && bufferEmpty(hs):
		return verdict{outcome: Printed, detail: "settled from journal: label counter moved"}
	case !moved:
		return verdict{outcome: NotSent, cancel: true, detail: "settled from journal: label counter unchanged"}
	default:
		return verdict{outcome: Unknown, cancel: true, detail: "settled from journal: counter moved but printer still holds data"}
	}
}
