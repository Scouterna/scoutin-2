package zebra

import (
	"reflect"
	"testing"
)

// Replies captured from a ZD421 (203 dpi) on 2026-10-22, idle with no errors.
var (
	idleHS = []string{
		"030,0,0,2108,000,0,0,0,000,0,0,0",
		"000,0,0,0,0,2,6,0,00000000,1,000",
		"0000,0",
	}
	idleHQES = "\r\n\r\n  PRINTER STATUS                            \r\n" +
		"   ERRORS:         0 00000000 00000000   \r\n" +
		"   WARNINGS:       0 00000000 00000000   \r\n"
)

func TestParseIdle(t *testing.T) {
	hs, err := ParseHS(idleHS)
	if err != nil {
		t.Fatal(err)
	}
	if want := (HostStatus{LabelLengthDots: 2108}); hs != want {
		t.Errorf("ParseHS = %+v, want %+v", hs, want)
	}

	es, err := ParseHQES(idleHQES)
	if err != nil {
		t.Fatal(err)
	}
	if es != (ErrorStatus{}) {
		t.Errorf("ParseHQES = %+v, want zero", es)
	}
	if got := Derive(hs, es); got != StateReady {
		t.Errorf("Derive = %s, want ready", got)
	}
}

func TestParseHQESErrors(t *testing.T) {
	es, err := ParseHQES("PRINTER STATUS\n ERRORS: 1 00000000 00000105\n WARNINGS: 1 00000000 00000002\n")
	if err != nil {
		t.Fatal(err)
	}
	if got, want := es.ErrorNames(), []string{"media out", "head open", "unknown 0x100"}; !reflect.DeepEqual(got, want) {
		t.Errorf("ErrorNames = %q, want %q", got, want)
	}
	if got, want := es.WarningNames(), []string{"clean printhead"}; !reflect.DeepEqual(got, want) {
		t.Errorf("WarningNames = %q, want %q", got, want)
	}
	if got := Derive(HostStatus{}, es); got != StateMediaOut {
		t.Errorf("Derive = %s, want media_out", got)
	}
}

func TestPausedIsNotAnError(t *testing.T) {
	// Captured from a paused ZD421: ~HS pause flag plus error bit 0x10000.
	es := ErrorStatus{Errors: 0x10000}
	if got := es.ErrorNames(); !reflect.DeepEqual(got, []string{"paused"}) {
		t.Errorf("ErrorNames = %q, want [paused]", got)
	}
	if got := Derive(HostStatus{Paused: true}, es); got != StatePaused {
		t.Errorf("Derive = %s, want paused", got)
	}
}
