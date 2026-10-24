// Command switchtest is a hardware spike: it reads the desk switch and shows
// its state on the LEDs, to check the switch wiring and debounce. It exists to
// verify the desk hardware, not as part of the relay.
//
// The switch connects the GPIO to GND. The internal pull-up holds the line
// high while the switch is open, so open = high = print, closed = low =
// inhibit, and a broken wire reads as open.
package main

import (
	"flag"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/Scouterna/scoutin-2/printer-proxy/internal/hw"
)

func main() {
	chip := flag.String("chip", "/dev/gpiochip0", "GPIO chip")
	gpio := flag.Int("gpio", 22, "switch GPIO (BCM number; GPIO22 = physical pin 15)")
	debounce := flag.Duration("debounce", 50*time.Millisecond, "how long a new state must hold before it counts")
	device := flag.String("device", "/dev/spidev0.0", "LED SPI device")
	count := flag.Int("count", 4, "number of LEDs")
	brightness := flag.Float64("brightness", 0.2, "0-1")
	gamma := flag.Float64("gamma", 2.8, "gamma correction (1 = off)")
	openColor := flag.String("open-color", "00ff40", "LED color while the switch is open (printing allowed)")
	closedColor := flag.String("closed-color", "ffc000", "LED color while the switch is closed (inhibit)")
	flag.Parse()

	if err := run(*chip, *gpio, *debounce, *device, *count, *brightness, *gamma, *openColor, *closedColor); err != nil {
		fmt.Fprintln(os.Stderr, "switchtest:", err)
		os.Exit(1)
	}
}

func run(chip string, gpio int, debounce time.Duration, device string, count int, brightness, gamma float64, openHex, closedHex string) error {
	openC, err := hw.ParseHex(openHex)
	if err != nil {
		return err
	}
	closedC, err := hw.ParseHex(closedHex)
	if err != nil {
		return err
	}

	in, err := hw.OpenInput(chip, gpio, true, "switchtest")
	if err != nil {
		return err
	}
	defer in.Close()

	strip, err := hw.OpenStrip(device, hw.StripOptions{Brightness: brightness, Gamma: gamma})
	if err != nil {
		return err
	}
	defer strip.Close()
	defer strip.Fill(count, hw.RGB{})

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)

	show := func(open bool) error {
		if open {
			fmt.Println(time.Now().Format("15:04:05.000"), "open   → printing allowed")
			return strip.Fill(count, openC)
		}
		fmt.Println(time.Now().Format("15:04:05.000"), "closed → inhibit")
		return strip.Fill(count, closedC)
	}

	stable, err := in.Value()
	if err != nil {
		return err
	}
	if err := show(stable); err != nil {
		return err
	}
	fmt.Printf("watching GPIO%d; flip the switch, Ctrl-C to stop\n", gpio)

	// Poll and debounce in user space: a change only counts once the line has
	// held the new level for the whole debounce period.
	tick := time.NewTicker(5 * time.Millisecond)
	defer tick.Stop()
	var changedAt time.Time
	for {
		select {
		case <-stop:
			return nil
		case <-tick.C:
		}

		v, err := in.Value()
		if err != nil {
			return err
		}
		switch {
		case v == stable:
			changedAt = time.Time{}
		case changedAt.IsZero():
			changedAt = time.Now()
		case time.Since(changedAt) >= debounce:
			stable, changedAt = v, time.Time{}
			if err := show(stable); err != nil {
				return err
			}
		}
	}
}
