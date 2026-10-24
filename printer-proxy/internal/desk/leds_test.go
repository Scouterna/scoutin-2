package desk

import (
	"testing"
	"time"

	"github.com/Scouterna/scoutin-2/printer-proxy/internal/hw"
	"github.com/Scouterna/scoutin-2/printer-proxy/internal/printer"
)

func TestLookFor(t *testing.T) {
	tests := []struct {
		state     printer.State
		present   bool
		inhibited bool
		want      look
	}{
		{"", false, false, look{pattern: off}},
		{printer.Ready, true, false, look{green, steady}},
		{printer.Ready, true, true, look{amber, steady}},
		{printer.Printing, true, false, look{green, breathe}},
		{printer.Paused, true, false, look{amber, slowBlink}},
		// Faults stay red even while the desk switch inhibits printing.
		{printer.MediaOut, true, true, look{red, slowBlink}},
		{printer.HeadOpen, true, false, look{red, slowBlink}},
		{printer.Offline, true, false, look{red, fastBlink}},
		{printer.Connecting, true, false, look{white, breathe}},
	}
	for _, tt := range tests {
		if got := lookFor(tt.state, tt.present, tt.inhibited); got != tt.want {
			t.Errorf("lookFor(%q, present=%v, inhibited=%v) = %+v, want %+v", tt.state, tt.present, tt.inhibited, got, tt.want)
		}
	}
}

func TestFrameOfflineStaysLit(t *testing.T) {
	d := New(4)
	d.SetPrinter(1, "D8J241203531", printer.Offline)
	// On-phase of the fast blink.
	frame, _ := d.Frame(time.UnixMilli(0))
	if frame[1] != red {
		t.Errorf("port 2 = %+v, want red", frame[1])
	}
	if frame[0] != (frame[2]) || frame[0].R+frame[0].G+frame[0].B != 0 {
		t.Errorf("empty ports should be off, got %+v", frame)
	}
}

func TestOfflineClears(t *testing.T) {
	d := New(4)
	d.SetPrinter(1, "A", printer.Offline)
	d.SetPrinter(2, "B", printer.Offline)

	// Printer A reappears on port 4: its old port goes dark, B's stays.
	d.SetPrinter(3, "A", printer.Connecting)
	if d.ports[1].present {
		t.Errorf("port 2 should be cleared after its printer moved, got %+v", d.ports[1])
	}
	if !d.ports[2].present {
		t.Error("port 3 (a different printer) should still show offline")
	}

	// A switch flick clears what's left, but not live printers.
	d.ClearOffline()
	if d.ports[2].present {
		t.Errorf("port 3 should be cleared, got %+v", d.ports[2])
	}
	if d.ports[3].state != printer.Connecting {
		t.Errorf("port 4 should be untouched, got %+v", d.ports[3])
	}
}

func TestCode(t *testing.T) {
	d := New(4)
	d.SetPrinter(0, "S1", printer.Ready)
	if err := d.SetCode([]string{"red", "yellow", "white", "pink"}); err != nil {
		t.Fatal(err)
	}
	on := time.UnixMilli(1000)
	got, full := d.Frame(on)
	if !full {
		t.Error("code not shown at full brightness")
	}
	want := []hw.RGB{{R: 0xff}, {R: 0xff, G: 0xff}, {R: 0xff, G: 0xff, B: 0xff}, {R: 0xff, B: 0xff}}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("LED %d = %+v, want %+v", i, got[i], want[i])
		}
	}
	if blink, _ := d.Frame(time.UnixMilli(2900)); blink[0] != (hw.RGB{}) {
		t.Errorf("no off-blink: %+v", blink)
	}

	d.ClearCode()
	if got, full := d.Frame(on); got[0] != green || full {
		t.Errorf("after ClearCode, LED 0 = %+v, want ready green", got[0])
	}
	if err := d.SetCode([]string{"blue"}); err == nil {
		t.Error("accepted an unknown color")
	}
}

func TestHalting(t *testing.T) {
	d := New(4)
	d.SetPrinter(0, "S1", printer.Ready)
	d.SetCode([]string{"red", "red", "red", "red"})
	d.SetHalting(true)
	got, _ := d.Frame(time.UnixMilli(2900)) // even during the code's off-blink
	for i, c := range got {
		if c != halted {
			t.Errorf("LED %d = %+v, want halted", i, c)
		}
	}
	d.SetHalting(false)
	if got, full := d.Frame(time.UnixMilli(1000)); got[0] != (hw.RGB{R: 0xff}) || !full {
		t.Errorf("after SetHalting(false): %+v", got)
	}
}
