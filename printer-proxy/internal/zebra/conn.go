package zebra

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	stx = 0x02
	etx = 0x03
)

// ErrClosed is returned once the device has gone away (unplugged, powered off).
var ErrClosed = errors.New("printer connection closed")

// ErrUnknownVar is returned by GetVar when the printer answers "?".
var ErrUnknownVar = errors.New("unknown SGD variable")

// Conn is a printer's USB device node (/dev/usb/lpN). Replies are read by a
// background goroutine, since reads on usblp block until the printer sends
// something. Two kinds of reply arrive: STX…ETX frames for ~ commands, and
// bare quoted strings ("350", no terminator) for SGD getvar.
type Conn struct {
	f      *os.File
	frames chan string
	vars   chan string

	mu   sync.Mutex // serializes queries
	err  error      // set by the reader when it stops
	gone chan struct{}
}

func Open(path string) (*Conn, error) {
	f, err := os.OpenFile(path, os.O_RDWR, 0)
	if err != nil {
		return nil, err
	}
	c := &Conn{f: f, frames: make(chan string, 16), vars: make(chan string, 4), gone: make(chan struct{})}
	go c.read()
	return c, nil
}

func (c *Conn) read() {
	buf := make([]byte, 4096)
	var frame, quoted []byte
	inFrame, inQuote := false, false
	for {
		n, err := c.f.Read(buf)
		for _, b := range buf[:n] {
			switch {
			case b == stx:
				// A frame always starts fresh, even if a quoted reply was cut
				// short.
				frame, inFrame, inQuote = frame[:0], true, false
			case b == etx && inFrame:
				deliver(c.frames, string(frame))
				inFrame = false
			case inFrame:
				frame = append(frame, b)
			case b == '"' && inQuote:
				deliver(c.vars, string(quoted))
				inQuote = false
			case b == '"':
				quoted, inQuote = quoted[:0], true
			case inQuote:
				quoted = append(quoted, b)
			}
		}
		if err != nil {
			c.err = err
			close(c.gone)
			return
		}
	}
}

func deliver(ch chan string, s string) {
	select {
	case ch <- s:
	default: // nobody is listening; drop it
	}
}

// drain discards replies left over from an earlier, timed-out query.
func drain(ch chan string) {
	for {
		select {
		case <-ch:
		default:
			return
		}
	}
}

// Query sends a command and collects the given number of reply frames.
func (c *Conn) Query(cmd string, frames int, timeout time.Duration) ([]string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	drain(c.frames)
	if _, err := c.f.Write([]byte(cmd)); err != nil {
		return nil, fmt.Errorf("write %q: %w", cmd, err)
	}

	deadline := time.After(timeout)
	out := make([]string, 0, frames)
	for len(out) < frames {
		select {
		case f := <-c.frames:
			out = append(out, f)
		case <-c.gone:
			return out, fmt.Errorf("%w: %v", ErrClosed, c.err)
		case <-deadline:
			return out, fmt.Errorf("%q: got %d of %d reply frames within %s", cmd, len(out), frames, timeout)
		}
	}
	return out, nil
}

// Status queries ~HS and ~HQES.
func (c *Conn) Status(timeout time.Duration) (HostStatus, ErrorStatus, error) {
	hsFrames, err := c.Query("~HS", 3, timeout)
	if err != nil {
		return HostStatus{}, ErrorStatus{}, err
	}
	hs, err := ParseHS(hsFrames)
	if err != nil {
		return HostStatus{}, ErrorStatus{}, err
	}
	esFrames, err := c.Query("~HQES", 1, timeout)
	if err != nil {
		return hs, ErrorStatus{}, err
	}
	es, err := ParseHQES(esFrames[0])
	return hs, es, err
}

// GetVar reads an SGD variable, e.g. "odometer.total_label_count".
func (c *Conn) GetVar(name string, timeout time.Duration) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	drain(c.vars)
	if _, err := fmt.Fprintf(c.f, "! U1 getvar \"%s\"\r\n", name); err != nil {
		return "", fmt.Errorf("getvar %s: %w", name, err)
	}
	select {
	case v := <-c.vars:
		if v == "?" {
			return "", fmt.Errorf("%w: %s", ErrUnknownVar, name)
		}
		return v, nil
	case <-c.gone:
		return "", fmt.Errorf("%w: %v", ErrClosed, c.err)
	case <-time.After(timeout):
		return "", fmt.Errorf("getvar %s: no reply within %s", name, timeout)
	}
}

// LabelCount reads the persistent label counter. It goes up by one per
// printed label and doesn't move on a feed (spec §7.4).
func (c *Conn) LabelCount(timeout time.Duration) (int64, error) {
	v, err := c.GetVar("odometer.total_label_count", timeout)
	if err != nil {
		return 0, err
	}
	n, err := strconv.ParseInt(strings.TrimSpace(v), 10, 64)
	if err != nil {
		return 0, fmt.Errorf("label counter: bad value %q", v)
	}
	return n, nil
}

// SetVar sets an SGD variable. The printer doesn't reply; read the value back
// to see whether it took.
func (c *Conn) SetVar(name, value string) error {
	return c.Send(fmt.Sprintf("! U1 setvar \"%s\" \"%s\"\r\n", name, value))
}

// Do runs an SGD action, e.g. Do("device.reset", "").
func (c *Conn) Do(name, value string) error {
	return c.Send(fmt.Sprintf("! U1 do \"%s\" \"%s\"\r\n", name, value))
}

// Send writes a command that has no reply, such as ~JA.
func (c *Conn) Send(cmd string) error {
	_, err := c.Write([]byte(cmd))
	return err
}

// Write sends data to the printer in a single write(), between queries.
func (c *Conn) Write(data []byte) (int, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	n, err := c.f.Write(data)
	if err != nil {
		select {
		case <-c.gone:
			err = fmt.Errorf("%w: %v", ErrClosed, err)
		default:
		}
	}
	return n, err
}

// Done is closed as soon as a read fails, which on usblp happens immediately
// when the printer is unplugged or switched off.
func (c *Conn) Done() <-chan struct{} { return c.gone }

// Close releases the device. The reader goroutine exits on its next read
// error.
func (c *Conn) Close() error { return c.f.Close() }
