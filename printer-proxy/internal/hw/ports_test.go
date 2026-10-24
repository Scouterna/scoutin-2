package hw

import "testing"

func TestLEDFor(t *testing.T) {
	tests := []struct {
		device string
		led    int
		ok     bool
	}{
		{"1-1.1.2", 0, true},
		{"1-1.1.3", 1, true},
		{"1-1.3", 2, true},
		{"1-1.2", 3, true},
		{"1-1.3.4", 2, true},   // behind a hub in port 3
		{"1-1.1.2.1", 0, true}, // behind a hub in port 1
		{"1-1.1.1", 0, false},  // the onboard Ethernet, not a port
		{"1-1", 0, false},
	}
	for _, tt := range tests {
		led, ok := Pi3BPlusPorts.LEDFor(tt.device)
		if led != tt.led || ok != tt.ok {
			t.Errorf("LEDFor(%q) = %d, %v; want %d, %v", tt.device, led, ok, tt.led, tt.ok)
		}
	}
}
