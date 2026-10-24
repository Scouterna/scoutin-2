// Package config reads /etc/printer-proxy/config.yaml (spec §8.7). Only the
// server URL is required, so every Pi can run the same file apart from that.
package config

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"

	"go.yaml.in/yaml/v3"
)

// DefaultPath is where install.sh writes the config.
const DefaultPath = "/etc/printer-proxy/config.yaml"

type Config struct {
	// Server is the scoutin server, e.g. https://scoutin.example.se. Empty means
	// local-only mode.
	Server string `yaml:"server"`
	// AutoUpdate lets `printer-proxy update` install the version the server
	// expects (spec §8.10). Off for a Pi running a development build.
	AutoUpdate bool   `yaml:"autoUpdate"`
	LEDs       LEDs   `yaml:"leds"`
	Switch     Switch `yaml:"switch"`
}

type LEDs struct {
	Enabled    bool    `yaml:"enabled"`
	SPI        string  `yaml:"spi"`
	Brightness float64 `yaml:"brightness"`
	// PortMap maps a USB port's sysfs name (e.g. "1-1.1.2") to an LED, 0-based.
	// Empty means the built-in Pi 3B+ map.
	PortMap map[string]int `yaml:"portMap"`
}

type Switch struct {
	Enabled bool `yaml:"enabled"`
	GPIO    int  `yaml:"gpio"` // BCM number
}

// Defaults are the settings for a Pi 3B+ desk with LEDs and a switch.
func Defaults() Config {
	return Config{
		AutoUpdate: true,
		LEDs:       LEDs{Enabled: true, SPI: "/dev/spidev0.0", Brightness: 0.2},
		Switch:     Switch{Enabled: true, GPIO: 22},
	}
}

// Load reads a config file over the defaults. A missing file is only an error
// if required is set: without it, the defaults (and flags) are used.
func Load(path string, required bool) (Config, error) {
	c := Defaults()
	b, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) && !required {
		return c, nil
	}
	if err != nil {
		return c, err
	}
	dec := yaml.NewDecoder(bytes.NewReader(b))
	// A misspelled key is an error, not silently ignored.
	dec.KnownFields(true)
	if err := dec.Decode(&c); err != nil && !errors.Is(err, io.EOF) {
		return c, fmt.Errorf("%s: %w", path, err)
	}
	if err := c.validate(); err != nil {
		return c, fmt.Errorf("%s: %w", path, err)
	}
	return c, nil
}

func (c Config) validate() error {
	if c.LEDs.Brightness < 0 || c.LEDs.Brightness > 1 {
		return fmt.Errorf("leds.brightness %v: want 0-1", c.LEDs.Brightness)
	}
	for port, led := range c.LEDs.PortMap {
		if led < 0 {
			return fmt.Errorf("leds.portMap %q: LED %d is negative", port, led)
		}
	}
	return nil
}
