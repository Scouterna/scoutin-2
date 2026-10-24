package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func write(t *testing.T, body string) string {
	p := filepath.Join(t.TempDir(), "config.yaml")
	if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestLoad(t *testing.T) {
	c, err := Load(write(t, "server: https://scoutin.example.se\nleds:\n  brightness: 0.1\n  portMap: { \"1-1.2\": 0 }\n"), true)
	if err != nil {
		t.Fatal(err)
	}
	if c.Server != "https://scoutin.example.se" || c.LEDs.Brightness != 0.1 || c.LEDs.PortMap["1-1.2"] != 0 {
		t.Errorf("got %+v", c)
	}
	// Untouched settings keep their defaults.
	if !c.LEDs.Enabled || c.LEDs.SPI != "/dev/spidev0.0" || !c.Switch.Enabled || c.Switch.GPIO != 22 {
		t.Errorf("defaults lost: %+v", c)
	}
}

func TestLoadMissing(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "nope.yaml")
	if c, err := Load(missing, false); err != nil || c.LEDs.Brightness != 0.2 {
		t.Errorf("optional missing file: %+v, %v", c, err)
	}
	if _, err := Load(missing, true); err == nil {
		t.Error("required missing file accepted")
	}
}

func TestLoadRejects(t *testing.T) {
	for name, body := range map[string]string{
		"typo":       "sever: https://x\n",
		"brightness": "leds:\n  brightness: 2\n",
		"type":       "switch:\n  gpio: twenty\n",
	} {
		if _, err := Load(write(t, body), true); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
	if c, err := Load(write(t, ""), true); err != nil || c.Server != "" {
		t.Errorf("empty file: %+v, %v", c, err)
	}
	if _, err := Load(write(t, "sever: x\n"), true); err == nil || !strings.Contains(err.Error(), "sever") {
		t.Errorf("typo error doesn't name the key: %v", err)
	}
}
