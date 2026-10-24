package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
)

// lockStateDir makes sure only one daemon runs per state directory. Two would
// fight over the LEDs, the printers (exclusive open) and the print socket,
// and share one journal. The lock is released when the process exits, however
// it exits, so a crash never leaves a stale lock behind.
func lockStateDir(dir string) (*os.File, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	f, err := os.OpenFile(filepath.Join(dir, "lock"), os.O_RDWR|os.O_CREATE, 0o600)
	if err != nil {
		return nil, err
	}
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		b, _ := os.ReadFile(f.Name())
		f.Close()
		if err == syscall.EWOULDBLOCK {
			if pid := strings.TrimSpace(string(b)); pid != "" {
				return nil, fmt.Errorf("another printer-proxy (pid %s) is already running with %s", pid, dir)
			}
			return nil, fmt.Errorf("another printer-proxy is already running with %s", dir)
		}
		return nil, err
	}
	// The PID is only for the message above; the flock is what counts.
	f.Truncate(0)
	f.WriteAt([]byte(strconv.Itoa(os.Getpid())+"\n"), 0)
	return f, nil
}
