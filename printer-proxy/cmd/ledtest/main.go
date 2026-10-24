// Command ledtest is a hardware spike: it drives WS2812/SK6812 LEDs over SPI
// (MOSI = GPIO10, physical pin 19) to check wiring, timing and colors. It
// exists to verify the desk hardware, not as part of the relay.
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
	device := flag.String("device", "/dev/spidev0.0", "SPI device")
	count := flag.Int("count", 4, "number of LEDs")
	brightness := flag.Float64("brightness", 0.2, "0-1, scales every color")
	color := flag.String("color", "", "show this hex color (e.g. ff0000) on all LEDs and exit")
	off := flag.Bool("off", false, "turn all LEDs off and exit")
	spiBits := flag.Int("spi-bits", 4, "SPI bits per LED bit: 4 (3.2 MHz) or 3 (2.4 MHz)")
	gamma := flag.Float64("gamma", 2.8, "gamma correction per channel (1 = off)")
	flag.Parse()

	strip, err := hw.OpenStrip(*device, hw.StripOptions{Brightness: *brightness, Gamma: *gamma, SPIBits: *spiBits})
	if err != nil {
		fmt.Fprintln(os.Stderr, "ledtest:", err)
		os.Exit(1)
	}
	defer strip.Close()

	show := func(leds []hw.RGB) {
		if err := strip.Show(leds); err != nil {
			fmt.Fprintln(os.Stderr, "ledtest: write:", err)
			os.Exit(1)
		}
	}
	all := func(c hw.RGB) []hw.RGB {
		leds := make([]hw.RGB, *count)
		for i := range leds {
			leds[i] = c
		}
		return leds
	}

	if *off {
		show(all(hw.RGB{}))
		return
	}
	if *color != "" {
		c, err := hw.ParseHex(*color)
		if err != nil {
			fmt.Fprintln(os.Stderr, "ledtest:", err)
			os.Exit(2)
		}
		show(all(c))
		return
	}

	// Turn the LEDs off on Ctrl-C instead of leaving them lit.
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)

	palette := []hw.RGB{{R: 255}, {G: 255}, {B: 255}, {R: 255, G: 255, B: 255}}
	fmt.Println("LED 1-4: red, green, blue, white. Then one chase, then off.")

	steps := []func(){
		func() {
			leds := make([]hw.RGB, *count)
			for i := range leds {
				leds[i] = palette[i%len(palette)]
			}
			show(leds)
		},
	}
	for i := 0; i < *count; i++ {
		steps = append(steps, func() {
			leds := make([]hw.RGB, *count)
			leds[i] = hw.RGB{R: 255, G: 255, B: 255}
			show(leds)
		})
	}

	// One cycle, then off.
	defer show(all(hw.RGB{}))
	for n, step := range steps {
		step()
		wait := 300 * time.Millisecond
		if n == 0 {
			wait = 3 * time.Second
		}
		select {
		case <-stop:
			return
		case <-time.After(wait):
		}
	}
}
