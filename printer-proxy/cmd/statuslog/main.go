// Command statuslog is a hardware spike: it polls a Zebra printer's status
// (~HS and ~HQES) and prints a readable line whenever it changes, including the
// state the relay would derive. It exists to learn how the printer reports
// lid, media, pause and power events, not as part of the relay.
package main

import (
	"flag"
	"fmt"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/Scouterna/scoutin-2/printer-proxy/internal/zebra"
)

func main() {
	device := flag.String("device", "/dev/usb/lp0", "printer device")
	interval := flag.Duration("interval", 300*time.Millisecond, "poll interval")
	timeout := flag.Duration("timeout", time.Second, "reply timeout per query")
	flag.Parse()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)

	var conn *zebra.Conn
	last := ""
	report := func(s string) {
		if s != last {
			fmt.Printf("%s  %s\n", time.Now().Format("15:04:05.000"), s)
			last = s
		}
	}

	fmt.Println("Polling", *device, "- Ctrl-C to stop")
	for {
		select {
		case <-stop:
			return
		case <-time.After(*interval):
		}

		if conn == nil {
			if _, err := os.Stat(*device); err != nil {
				report("NO PRINTER (device not present)")
				continue
			}
			c, err := zebra.Open(*device)
			if err != nil {
				report("CANNOT OPEN: " + err.Error())
				continue
			}
			conn = c
		}

		hs, es, err := conn.Status(*timeout)
		if err != nil {
			report("NO REPLY: " + err.Error())
			conn.Close()
			conn = nil
			continue
		}
		report(describe(hs, es))
	}
}

func describe(hs zebra.HostStatus, es zebra.ErrorStatus) string {
	state := strings.ToUpper(strings.ReplaceAll(string(zebra.Derive(hs, es)), "_", " "))

	var flags []string
	for _, f := range []struct {
		on   bool
		name string
	}{
		{hs.PaperOut, "paper out"},
		{hs.Paused, "paused"},
		{hs.HeadUp, "head up"},
		{hs.BufferFull, "buffer full"},
		{hs.LabelWaiting, "label waiting to be taken"},
		{hs.UnderTemp, "under temperature"},
		{hs.OverTemp, "over temperature"},
		{hs.RibbonOut, "ribbon out"},
	} {
		if f.on {
			flags = append(flags, f.name)
		}
	}

	list := func(xs []string) string {
		if len(xs) == 0 {
			return "none"
		}
		return strings.Join(xs, ", ")
	}

	return fmt.Sprintf("%-10s | flags: %s | errors: %s | warnings: %s | in progress: %d formats buffered, %d labels still to print",
		state, list(flags), list(es.ErrorNames()), list(es.WarningNames()), hs.FormatsInBuffer, hs.LabelsRemaining)
}
