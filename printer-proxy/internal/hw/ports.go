package hw

import "strings"

// PortMap maps a USB port's sysfs device name (e.g. "1-1.1.2") to a zero-based
// LED index. Physical port n uses LED n, counted along the data chain.
type PortMap map[string]int

// Pi3BPlusPorts is the Raspberry Pi 3B+ layout, measured by moving a printer
// through each port. Seen from the USB side, ports are numbered by column:
//
//	1 3
//	2 4
//
// The left pair hangs off the second-level hub inside the LAN7515, hence the
// longer paths.
var Pi3BPlusPorts = PortMap{
	"1-1.1.2": 0, // top left
	"1-1.1.3": 1, // bottom left
	"1-1.3":   2, // top right
	"1-1.2":   3, // bottom right
}

// LEDFor returns the LED index for a USB device's sysfs name. A device behind
// an external hub (e.g. "1-1.3.4") maps to the port the hub is plugged into.
func (m PortMap) LEDFor(device string) (int, bool) {
	for {
		if i, ok := m[device]; ok {
			return i, true
		}
		dot := strings.LastIndexByte(device, '.')
		if dot < 0 {
			return 0, false
		}
		device = device[:dot]
	}
}
