package printer

import (
	"testing"

	"github.com/Scouterna/scoutin-2/printer-proxy/internal/zebra"
)

var (
	empty    = zebra.HostStatus{}
	buffered = zebra.HostStatus{FormatsInBuffer: 1}
	printing = zebra.HostStatus{LabelsRemaining: 1}
)

func TestJudge(t *testing.T) {
	cases := []struct {
		name   string
		st     zebra.State
		hs     zebra.HostStatus
		now    int64
		quiet  bool
		want   Outcome
		cancel bool
	}{
		{"not picked up yet", zebra.StateReady, empty, 100, false, "", false},
		{"in buffer", zebra.StatePrinting, buffered, 100, false, "", false},
		{"printing, counter moved early", zebra.StatePrinting, printing, 101, false, "", false},
		{"done", zebra.StateReady, empty, 101, false, Printed, false},
		{"done, then media out at the next mark", zebra.StateMediaOut, empty, 101, false, Printed, false},
		{"done, lid opened right after", zebra.StateHeadOpen, empty, 101, false, Printed, false},
		{"media out before start", zebra.StateMediaOut, buffered, 100, false, NotSent, true},
		{"media out mid-label", zebra.StateMediaOut, printing, 101, false, Unknown, true},
		{"lid open, held", zebra.StateHeadOpen, buffered, 100, false, "", false},
		{"paused, held for a long time", zebra.StatePaused, buffered, 100, true, "", false},
		{"accepted but printed nothing", zebra.StateReady, empty, 100, true, Unknown, true},
	}
	for _, c := range cases {
		v := judge(c.st, c.hs, 100, c.now, c.quiet)
		if v.outcome != c.want || v.cancel != c.cancel {
			t.Errorf("%s: got %q cancel=%v, want %q cancel=%v", c.name, v.outcome, v.cancel, c.want, c.cancel)
		}
	}
}

func TestSettle(t *testing.T) {
	cases := []struct {
		name   string
		hs     zebra.HostStatus
		now    int64
		want   Outcome
		cancel bool
	}{
		{"printed before the crash", empty, 101, Printed, false},
		{"never reached the printer", empty, 100, NotSent, true},
		{"held in the buffer", buffered, 100, NotSent, true},
		{"counter moved, still holds data", printing, 101, Unknown, true},
	}
	for _, c := range cases {
		v := settle(c.hs, 100, c.now)
		if v.outcome != c.want || v.cancel != c.cancel {
			t.Errorf("%s: got %q cancel=%v, want %q cancel=%v", c.name, v.outcome, v.cancel, c.want, c.cancel)
		}
	}
}
