// Package zebra talks to Zebra ZPL printers: status queries and their parsing.
package zebra

import (
	"fmt"
	"strconv"
	"strings"
)

// HostStatus is the parsed reply to ~HS (three STX…ETX frames).
type HostStatus struct {
	PaperOut        bool
	Paused          bool
	LabelLengthDots int
	FormatsInBuffer int
	BufferFull      bool
	UnderTemp       bool
	OverTemp        bool
	HeadUp          bool
	RibbonOut       bool
	LabelWaiting    bool
	LabelsRemaining int
}

// ParseHS parses the three ~HS frames (without STX/ETX).
//
//	frame 1: aaa,b,c,dddd,eee,f,g,h,iii,j,k,l
//	         b paper out, c pause, dddd label length, eee formats in buffer,
//	         f buffer full, k under temperature, l over temperature
//	frame 2: mmm,n,o,p,q,r,s,t,uuuuuuuu,v,www
//	         o head up, p ribbon out, t label waiting, uuuuuuuu labels remaining
func ParseHS(frames []string) (HostStatus, error) {
	if len(frames) < 2 {
		return HostStatus{}, fmt.Errorf("~HS: got %d frames, want 3", len(frames))
	}
	f1 := strings.Split(strings.TrimSpace(frames[0]), ",")
	f2 := strings.Split(strings.TrimSpace(frames[1]), ",")
	if len(f1) < 12 || len(f2) < 9 {
		return HostStatus{}, fmt.Errorf("~HS: unexpected format %q / %q", frames[0], frames[1])
	}
	flag := func(s string) bool { return strings.TrimSpace(s) == "1" }
	num := func(s string) int { n, _ := strconv.Atoi(strings.TrimSpace(s)); return n }
	return HostStatus{
		PaperOut:        flag(f1[1]),
		Paused:          flag(f1[2]),
		LabelLengthDots: num(f1[3]),
		FormatsInBuffer: num(f1[4]),
		BufferFull:      flag(f1[5]),
		UnderTemp:       flag(f1[10]),
		OverTemp:        flag(f1[11]),
		HeadUp:          flag(f2[2]),
		RibbonOut:       flag(f2[3]),
		LabelWaiting:    flag(f2[7]),
		LabelsRemaining: num(f2[8]),
	}, nil
}

// ErrorStatus is the parsed reply to ~HQES: two 64-bit bitmasks, each sent as
// two 8-digit hex groups.
type ErrorStatus struct {
	Errors   uint64
	Warnings uint64
}

// ParseHQES parses the ~HQES frame, which looks like:
//
//	PRINTER STATUS
//	   ERRORS:         1 00000000 00000005
//	   WARNINGS:       0 00000000 00000000
func ParseHQES(frame string) (ErrorStatus, error) {
	var es ErrorStatus
	var gotErr, gotWarn bool
	for _, line := range strings.Split(frame, "\n") {
		key, rest, ok := strings.Cut(strings.TrimSpace(line), ":")
		if !ok {
			continue
		}
		fields := strings.Fields(rest)
		if len(fields) != 3 {
			continue
		}
		hi, err1 := strconv.ParseUint(fields[1], 16, 32)
		lo, err2 := strconv.ParseUint(fields[2], 16, 32)
		if err1 != nil || err2 != nil {
			return es, fmt.Errorf("~HQES: bad hex in %q", line)
		}
		switch strings.TrimSpace(key) {
		case "ERRORS":
			es.Errors, gotErr = hi<<32|lo, true
		case "WARNINGS":
			es.Warnings, gotWarn = hi<<32|lo, true
		}
	}
	if !gotErr || !gotWarn {
		return es, fmt.Errorf("~HQES: unexpected format %q", frame)
	}
	return es, nil
}

// Error and warning bits as documented by Zebra. The low bits are the ones that
// matter for a direct-thermal desktop printer; anything else is reported by
// value so it can be identified.
var errorNames = []struct {
	bit  uint64
	name string
}{
	{0x1, "media out"},
	{0x2, "ribbon out"},
	{0x4, "head open"},
	{0x8, "cutter fault"},
	{0x10, "printhead over temperature"},
	{0x20, "motor over temperature"},
	{0x40, "bad printhead element"},
	{0x80, "printhead detection error"},
	// Not in Zebra's table; observed on the ZD421 together with the ~HS pause
	// flag whenever the printer is paused.
	{errPaused, "paused"},
}

const errPaused = 0x10000

var warningNames = []struct {
	bit  uint64
	name string
}{
	{0x1, "needs media calibration"},
	{0x2, "clean printhead"},
	{0x4, "replace printhead"},
	{0x8, "paper near end"},
}

// ErrorNames returns readable names for the set error bits.
func (es ErrorStatus) ErrorNames() []string { return names(es.Errors, errorNames) }

// WarningNames returns readable names for the set warning bits.
func (es ErrorStatus) WarningNames() []string { return names(es.Warnings, warningNames) }

func names(mask uint64, table []struct {
	bit  uint64
	name string
}) []string {
	var out []string
	for _, e := range table {
		if mask&e.bit != 0 {
			out = append(out, e.name)
			mask &^= e.bit
		}
	}
	if mask != 0 {
		out = append(out, fmt.Sprintf("unknown 0x%x", mask))
	}
	return out
}

// State is the relay's summary of a printer, in priority order.
type State string

const (
	StateMediaOut State = "media_out"
	StateHeadOpen State = "head_open"
	StateError    State = "error"
	StatePaused   State = "paused"
	StatePrinting State = "printing"
	StateReady    State = "ready"
)

// Derive combines both replies into one state. ~HQES is authoritative for
// errors; the ~HS flags back it up.
func Derive(hs HostStatus, es ErrorStatus) State {
	switch {
	case es.Errors&0x1 != 0 || hs.PaperOut:
		return StateMediaOut
	case es.Errors&0x4 != 0 || hs.HeadUp:
		return StateHeadOpen
	case es.Errors&^errPaused != 0 || hs.OverTemp || hs.UnderTemp:
		return StateError
	case hs.Paused || es.Errors&errPaused != 0:
		return StatePaused
	case hs.FormatsInBuffer > 0 || hs.LabelsRemaining > 0:
		return StatePrinting
	default:
		return StateReady
	}
}
