// Package desk turns printer states and the desk switch into LED frames.
package desk

import (
	"fmt"
	"math"
	"sync"
	"time"

	"github.com/Scouterna/scoutin-2/printer-proxy/internal/hw"
	"github.com/Scouterna/scoutin-2/printer-proxy/internal/printer"
)

// Palette, tuned by eye on the desk LEDs at brightness 0.2 / gamma 2.8 (spec
// §8.6). Values are palette inputs, before gamma and brightness.
var (
	green = hw.RGB{R: 0x00, G: 0xff, B: 0x40}
	amber = hw.RGB{R: 0xff, G: 0xc0, B: 0x00} // provisional
	red   = hw.RGB{R: 0xff}
	white = hw.RGB{R: 0xff, G: 0xff, B: 0xff}
	blue  = hw.RGB{B: 0xff}
)

type pattern int

const (
	off pattern = iota
	steady
	slowBlink // 1 Hz: staff should come
	fastBlink // 4 Hz: something's broken
	breathe   // 2 s cycle: busy
)

type look struct {
	color   hw.RGB
	pattern pattern
}

// lookFor maps a port's printer state to its LED. Steady means nothing to do,
// blinking means someone should come; every red state blinks so red and green
// are never both steady (red/green color blindness).
func lookFor(s printer.State, present, inhibited bool) look {
	if !present {
		return look{pattern: off}
	}
	switch s {
	case printer.Connecting:
		return look{white, breathe}
	case printer.Ready:
		if inhibited {
			return look{amber, steady}
		}
		return look{green, steady}
	case printer.Printing:
		if inhibited {
			return look{amber, breathe}
		}
		return look{green, breathe}
	case printer.Paused:
		return look{amber, slowBlink}
	case printer.MediaOut, printer.HeadOpen:
		return look{red, slowBlink}
	default: // Error, Unresponsive, Offline
		return look{red, fastBlink}
	}
}

type port struct {
	present bool // a printer is here, or was until it disappeared
	serial  string
	state   printer.State
}

// Desk holds what the LEDs should show. It's safe for concurrent use.
type Desk struct {
	mu        sync.Mutex
	ports     []port
	inhibited bool
	code      []hw.RGB // pairing code shown instead of printer states, if set
	halting   bool     // powering off: show "safe to unplug"
}

func New(nports int) *Desk { return &Desk{ports: make([]port, nports)} }

// SetPrinter records a printer's state on a port. An Offline printer keeps its
// port lit (red, fast blink) so a printer that lost power is visible at the
// desk. That clears when the same printer shows up on any port (it was moved),
// another printer takes the port, or staff flick the desk switch (ClearOffline).
func (d *Desk) SetPrinter(index int, serial string, s printer.State) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if index < 0 || index >= len(d.ports) {
		return
	}
	for i, p := range d.ports {
		if i != index && p.serial == serial && p.state == printer.Offline {
			d.ports[i] = port{}
		}
	}
	d.ports[index] = port{present: true, serial: serial, state: s}
}

// ClearOffline forgets every printer that has disappeared, turning its port
// LED off.
func (d *Desk) ClearOffline() {
	d.mu.Lock()
	defer d.mu.Unlock()
	for i, p := range d.ports {
		if p.state == printer.Offline {
			d.ports[i] = port{}
		}
	}
}

func (d *Desk) SetInhibited(v bool) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.inhibited = v
}

// Inhibited reports whether the desk switch is on pause: no printer leases.
func (d *Desk) Inhibited() bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.inhibited
}

// pairingColors are the five colors of an enrollment code (spec §12): the
// ones that read clearly on the desk LEDs (checked by eye, 2026-10-23). Blue
// and cyan were dropped: blue reads as lavender and cyan as white.
var pairingColors = map[string]hw.RGB{
	"red":    {R: 0xff},
	"green":  {G: 0xff},
	"yellow": {R: 0xff, G: 0xff},
	"white":  {R: 0xff, G: 0xff, B: 0xff},
	"pink":   {R: 0xff, B: 0xff},
}

// SetCode shows an enrollment code instead of printer states: color i on
// LED i, i.e. left to right along the row of LEDs. It fails on an unknown
// color name.
func (d *Desk) SetCode(colors []string) error {
	code := make([]hw.RGB, len(colors))
	for i, name := range colors {
		c, ok := pairingColors[name]
		if !ok {
			return fmt.Errorf("unknown pairing color %q", name)
		}
		code[i] = c
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	d.code = code
	return nil
}

// halted is "safe to unplug" (spec §8.8): all LEDs steady blue, which reads as
// lavender on these LEDs and is used for nothing else. Provisional: not yet
// checked by eye. The LEDs keep showing it after the Pi halts, because the
// strip stays powered and holds the last frame it got.
var halted = hw.RGB{B: 0xff}

// SetHalting switches every LED to "safe to unplug", ahead of a power-off.
// Cleared with SetHalting(false) if the power-off fails.
func (d *Desk) SetHalting(v bool) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.halting = v
}

// Halting reports whether a power-off is under way.
func (d *Desk) Halting() bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.halting
}

// ClearCode goes back to showing printer states.
func (d *Desk) ClearCode() {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.code = nil
}

// Frame computes every LED's color at time t. full is true while a pairing
// code is shown: it's meant for full brightness, because at the normal status
// brightness the colors wash out and are hard to tell apart.
func (d *Desk) Frame(t time.Time) (leds []hw.RGB, full bool) {
	d.mu.Lock()
	defer d.mu.Unlock()
	out := make([]hw.RGB, len(d.ports))
	if d.halting {
		for i := range out {
			out[i] = halted
		}
		return out, false
	}
	if d.code != nil {
		// Steady, with a short all-off blink every 3 s, so a code can't be
		// mistaken for printer states.
		if t.UnixMilli()%3000 < 2800 {
			copy(out, d.code)
		}
		return out, true
	}
	for i, p := range d.ports {
		l := lookFor(p.state, p.present, d.inhibited)
		out[i] = scale(l.color, level(l.pattern, t))
	}
	return out, false
}

// level is the pattern's intensity (0-1) at time t. Applied to palette values
// before gamma, so breathing looks even to the eye.
func level(p pattern, t time.Time) float64 {
	ms := t.UnixMilli()
	switch p {
	case steady:
		return 1
	case slowBlink:
		if ms%1000 < 500 {
			return 1
		}
		return 0
	case fastBlink:
		if ms%250 < 125 {
			return 1
		}
		return 0
	case breathe:
		phase := float64(ms%2000) / 2000
		return 0.25 + 0.75*(0.5-0.5*math.Cos(2*math.Pi*phase))
	default:
		return 0
	}
}

func scale(c hw.RGB, f float64) hw.RGB {
	m := func(v uint8) uint8 { return uint8(float64(v)*f + 0.5) }
	return hw.RGB{R: m(c.R), G: m(c.G), B: m(c.B)}
}

// Startup is the "booting" overlay: a blue light chasing across all LEDs.
func Startup(n int, t time.Time) []hw.RGB {
	out := make([]hw.RGB, n)
	out[int(t.UnixMilli()/150)%n] = blue
	return out
}
