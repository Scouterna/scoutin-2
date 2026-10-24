package printer

import "testing"

func TestSameValue(t *testing.T) {
	for _, c := range []struct {
		a, b string
		want bool
	}{
		{"15.0", "15", true},
		{"3.0 ", "3.0", true}, // replies can carry trailing spaces
		{"no motion", "no motion", true},
		{"OFF", "off", true},
		{"800", "0800", true},
		{"on", "off", false},
		{"15.0", "15.5", false},
		{"", "off", false},
	} {
		if got := sameValue(c.a, c.b); got != c.want {
			t.Errorf("sameValue(%q, %q) = %v, want %v", c.a, c.b, got, c.want)
		}
	}
}

func TestNeedsRestart(t *testing.T) {
	for key, want := range map[string]bool{
		"internal_wired.enable": true,
		"wlan.enable":           true,
		"bluetooth.enable":      true,
		"ip.dhcp.enable":        true,
		"device.languages":      true,
		"print.tone":            false,
		"ezpl.tear_off":         false,
		"usb.mirror.auto":       false,
	} {
		if got := needsRestart(key); got != want {
			t.Errorf("needsRestart(%q) = %v, want %v", key, got, want)
		}
	}
}
