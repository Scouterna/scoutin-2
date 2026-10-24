// Package hw drives the relay's desk hardware: WS2812/SK6812 LEDs over SPI and
// GPIO inputs through the GPIO character device. Pure Go, no cgo, no root.
package hw

import (
	"fmt"
	"math"
	"os"
	"strconv"
	"syscall"
	"unsafe"
)

// spidev ioctls: _IOW('k', nr, size). Identical on arm and arm64.
const (
	spiIOCWrMode        = 0x40016b01
	spiIOCWrBitsPerWord = 0x40016b03
	spiIOCWrMaxSpeedHz  = 0x40046b04
)

// encoding describes how one WS2812 bit maps to SPI bits.
type encoding struct {
	speedHz    uint32
	bits       int    // SPI bits per WS2812 bit
	zero, one  uint32 // SPI bit patterns, MSB first
	resetBytes int    // low time that latches the data: >280 µs for newer chips
}

// The default, four SPI bits at 3.2 MHz, gives ~312 ns for a 0 and ~625 ns for
// a 1, inside the spec of both old and new WS2812B revisions. The three-bit
// encoding at 2.4 MHz ends up at ~424 ns for a 0 on a Pi 3 (the SPI clock is
// rounded down), which newer chips (max ~380 ns) can misread as a 1.
var encodings = map[int]encoding{
	3: {speedHz: 2_400_000, bits: 3, zero: 0b100, one: 0b110, resetBytes: 100},
	4: {speedHz: 3_200_000, bits: 4, zero: 0b1000, one: 0b1100, resetBytes: 140},
}

// RGB is a palette color, before gamma and brightness.
type RGB struct{ R, G, B uint8 }

// ParseHex parses a color like "ff8800".
func ParseHex(s string) (RGB, error) {
	if len(s) != 6 {
		return RGB{}, fmt.Errorf("color %q must be 6 hex digits, e.g. ff8800", s)
	}
	v, err := strconv.ParseUint(s, 16, 32)
	if err != nil {
		return RGB{}, fmt.Errorf("color %q: %w", s, err)
	}
	return RGB{uint8(v >> 16), uint8(v >> 8), uint8(v)}, nil
}

type StripOptions struct {
	Brightness float64 // 0-1, applied after gamma
	Gamma      float64 // per channel; 1 = off
	SPIBits    int     // SPI bits per LED bit: 4 (default) or 3
}

// Strip is a chain of LEDs on a spidev device.
type Strip struct {
	f    *os.File
	enc  encoding
	opts StripOptions
}

func OpenStrip(device string, opts StripOptions) (*Strip, error) {
	if opts.SPIBits == 0 {
		opts.SPIBits = 4
	}
	enc, ok := encodings[opts.SPIBits]
	if !ok {
		return nil, fmt.Errorf("unsupported SPI bits per LED bit: %d (use 3 or 4)", opts.SPIBits)
	}

	f, err := os.OpenFile(device, os.O_RDWR, 0)
	if err != nil {
		return nil, fmt.Errorf("%w (is SPI enabled with dtparam=spi=on, and are you in the spi group?)", err)
	}
	mode := uint8(0)
	bits := uint8(8)
	speed := enc.speedHz
	for _, c := range []struct {
		req uintptr
		arg unsafe.Pointer
	}{
		{spiIOCWrMode, unsafe.Pointer(&mode)},
		{spiIOCWrBitsPerWord, unsafe.Pointer(&bits)},
		{spiIOCWrMaxSpeedHz, unsafe.Pointer(&speed)},
	} {
		if _, _, errno := syscall.Syscall(syscall.SYS_IOCTL, f.Fd(), c.req, uintptr(c.arg)); errno != 0 {
			f.Close()
			return nil, fmt.Errorf("configure %s: %w", device, errno)
		}
	}
	return &Strip{f: f, enc: enc, opts: opts}, nil
}

// Show sets every LED in one transfer.
func (s *Strip) Show(leds []RGB) error {
	return s.ShowAt(leds, s.opts.Brightness)
}

// ShowAt is Show at a different brightness (0-1) for this frame only.
func (s *Strip) ShowAt(leds []RGB, brightness float64) error {
	_, err := s.f.Write(encode(leds, brightness, s.opts.Gamma, s.enc))
	return err
}

// Fill sets n LEDs to the same color.
func (s *Strip) Fill(n int, c RGB) error {
	leds := make([]RGB, n)
	for i := range leds {
		leds[i] = c
	}
	return s.Show(leds)
}

func (s *Strip) Close() error { return s.f.Close() }

// encode turns colors into the SPI bit stream: a leading zero byte (MOSI can
// glitch at the start of a transfer), each LED in GRB order, then the reset
// gap.
//
// Gamma is applied before brightness: LED output is linear but perceived
// brightness isn't, so without it half-strength channels look far too bright
// (ff8000 reads as yellow, not amber) and fades look wrong.
func encode(leds []RGB, brightness, gamma float64, enc encoding) []byte {
	scale := func(v uint8) uint8 {
		return uint8(math.Pow(float64(v)/255, gamma)*brightness*255 + 0.5)
	}

	buf := make([]byte, 1, 1+len(leds)*24*enc.bits/8+enc.resetBytes)
	var acc uint32
	var nbits int
	for _, c := range leds {
		for _, v := range []uint8{scale(c.G), scale(c.R), scale(c.B)} {
			for bit := 7; bit >= 0; bit-- {
				pattern := enc.zero
				if v&(1<<bit) != 0 {
					pattern = enc.one
				}
				acc = acc<<enc.bits | pattern
				nbits += enc.bits
				for nbits >= 8 {
					nbits -= 8
					buf = append(buf, byte(acc>>nbits))
				}
			}
		}
	}
	return append(buf, make([]byte, enc.resetBytes)...)
}
