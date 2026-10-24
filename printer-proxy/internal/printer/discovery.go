// Package printer finds Zebra printers on USB and tracks their state.
package printer

import (
	"os"
	"path/filepath"
	"strings"
)

const zebraVendorID = "0a5f"

// Device is a Zebra printer currently attached over USB.
type Device struct {
	Serial  string // printer identity (USB serial descriptor = printer serial)
	Node    string // e.g. /dev/usb/lp0
	USBPath string // sysfs device name, e.g. 1-1.1.3; identifies the physical port
	Product string
}

// Scan lists the Zebra printers bound to usblp right now.
func Scan() []Device {
	matches, _ := filepath.Glob("/sys/class/usbmisc/lp*")
	var out []Device
	for _, m := range matches {
		// .../usbmisc/lp0/device is the USB interface (1-1.1.3:1.0); its parent
		// is the USB device, which carries the descriptors.
		iface, err := filepath.EvalSymlinks(filepath.Join(m, "device"))
		if err != nil {
			continue
		}
		dev := filepath.Dir(iface)
		if read(dev, "idVendor") != zebraVendorID {
			continue
		}
		serial := read(dev, "serial")
		if serial == "" {
			continue
		}
		out = append(out, Device{
			Serial:  serial,
			Node:    filepath.Join("/dev/usb", filepath.Base(m)),
			USBPath: filepath.Base(dev),
			Product: read(dev, "product"),
		})
	}
	return out
}

func read(dir, name string) string {
	b, err := os.ReadFile(filepath.Join(dir, name))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(b))
}
