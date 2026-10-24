// Package sdnotify tells systemd the service is ready and still alive
// (Type=notify, WatchdogSec). Outside systemd, every call is a no-op.
package sdnotify

import (
	"net"
	"os"
	"strconv"
	"time"
)

// Send writes a notification such as "READY=1". It reports whether systemd
// was listening.
func Send(state string) bool {
	addr := os.Getenv("NOTIFY_SOCKET")
	if addr == "" {
		return false
	}
	if addr[0] == '@' {
		addr = "\x00" + addr[1:] // abstract socket
	}
	conn, err := net.DialUnix("unixgram", nil, &net.UnixAddr{Name: addr, Net: "unixgram"})
	if err != nil {
		return false
	}
	defer conn.Close()
	_, err = conn.Write([]byte(state))
	return err == nil
}

// Ready tells systemd startup is done.
func Ready() bool { return Send("READY=1") }

// Stopping tells systemd a shutdown has begun.
func Stopping() bool { return Send("STOPPING=1") }

// Watchdog pings the watchdog.
func Watchdog() bool { return Send("WATCHDOG=1") }

// WatchdogInterval is how often to ping: half the timeout systemd set
// (WatchdogSec), or 0 if there's no watchdog.
func WatchdogInterval() time.Duration {
	us, err := strconv.ParseInt(os.Getenv("WATCHDOG_USEC"), 10, 64)
	if err != nil || us <= 0 {
		return 0
	}
	if pid := os.Getenv("WATCHDOG_PID"); pid != "" && pid != strconv.Itoa(os.Getpid()) {
		return 0
	}
	return time.Duration(us) * time.Microsecond / 2
}
