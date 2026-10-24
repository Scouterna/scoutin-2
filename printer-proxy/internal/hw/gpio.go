package hw

import (
	"fmt"
	"os"
	"syscall"
	"unsafe"
)

// GPIO character device uAPI v2 (linux/gpio.h).
const (
	gpioV2GetLineIoctl       = 0xc250b407 // _IOWR(0xB4, 0x07, struct gpio_v2_line_request)
	gpioV2LineGetValuesIoctl = 0xc010b40e // _IOWR(0xB4, 0x0E, struct gpio_v2_line_values)

	gpioV2LineFlagInput      = 1 << 2
	gpioV2LineFlagBiasPullUp = 1 << 8
)

type gpioV2LineAttribute struct {
	id      uint32
	padding uint32
	value   uint64 // union: flags / values / debounce_period_us
}

type gpioV2LineConfigAttribute struct {
	attr gpioV2LineAttribute
	mask uint64
}

type gpioV2LineConfig struct {
	flags    uint64
	numAttrs uint32
	padding  [5]uint32
	attrs    [10]gpioV2LineConfigAttribute
}

type gpioV2LineRequest struct {
	offsets         [64]uint32
	consumer        [32]byte
	config          gpioV2LineConfig
	numLines        uint32
	eventBufferSize uint32
	padding         [5]uint32
	fd              int32
}

type gpioV2LineValues struct {
	bits uint64
	mask uint64
}

func init() {
	// Every 64-bit field falls on an 8-byte boundary, so the layout matches the
	// kernel's on both arm and arm64. Guard it anyway.
	if s := unsafe.Sizeof(gpioV2LineRequest{}); s != 592 {
		panic(fmt.Sprintf("gpio_v2_line_request is %d bytes, want 592", s))
	}
}

// Input is a single GPIO line requested as an input.
type Input struct {
	line *os.File
}

// OpenInput requests one line on a GPIO chip (e.g. /dev/gpiochip0, offset =
// BCM GPIO number on a Pi 3) as an input, optionally with the internal pull-up.
func OpenInput(chip string, offset int, pullUp bool, consumer string) (*Input, error) {
	c, err := os.OpenFile(chip, os.O_RDWR, 0)
	if err != nil {
		return nil, fmt.Errorf("%w (are you in the gpio group?)", err)
	}
	defer c.Close()

	var req gpioV2LineRequest
	req.offsets[0] = uint32(offset)
	req.numLines = 1
	copy(req.consumer[:len(req.consumer)-1], consumer)
	req.config.flags = gpioV2LineFlagInput
	if pullUp {
		req.config.flags |= gpioV2LineFlagBiasPullUp
	}

	if _, _, errno := syscall.Syscall(syscall.SYS_IOCTL, c.Fd(), gpioV2GetLineIoctl, uintptr(unsafe.Pointer(&req))); errno != 0 {
		return nil, fmt.Errorf("request GPIO%d on %s: %w", offset, chip, errno)
	}
	return &Input{line: os.NewFile(uintptr(req.fd), fmt.Sprintf("gpio%d", offset))}, nil
}

// Value reports whether the line is high.
func (in *Input) Value() (bool, error) {
	vals := gpioV2LineValues{mask: 1}
	if _, _, errno := syscall.Syscall(syscall.SYS_IOCTL, in.line.Fd(), gpioV2LineGetValuesIoctl, uintptr(unsafe.Pointer(&vals))); errno != 0 {
		return false, fmt.Errorf("read GPIO: %w", errno)
	}
	return vals.bits&1 != 0, nil
}

// Close releases the line.
func (in *Input) Close() error { return in.line.Close() }
