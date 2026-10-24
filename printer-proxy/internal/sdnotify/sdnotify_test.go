package sdnotify

import (
	"net"
	"path/filepath"
	"testing"
	"time"
)

func TestSend(t *testing.T) {
	sock := filepath.Join(t.TempDir(), "notify")
	l, err := net.ListenUnixgram("unixgram", &net.UnixAddr{Name: sock, Net: "unixgram"})
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	t.Setenv("NOTIFY_SOCKET", sock)

	if !Ready() {
		t.Fatal("Ready failed")
	}
	buf := make([]byte, 64)
	l.SetReadDeadline(time.Now().Add(time.Second))
	n, _, err := l.ReadFromUnix(buf)
	if err != nil || string(buf[:n]) != "READY=1" {
		t.Fatalf("got %q, %v", buf[:n], err)
	}
}

func TestOutsideSystemd(t *testing.T) {
	t.Setenv("NOTIFY_SOCKET", "")
	t.Setenv("WATCHDOG_USEC", "")
	if Ready() || WatchdogInterval() != 0 {
		t.Error("expected no-ops outside systemd")
	}
	t.Setenv("WATCHDOG_USEC", "30000000")
	if got := WatchdogInterval(); got != 15*time.Second {
		t.Errorf("WatchdogInterval = %s, want 15s", got)
	}
}
