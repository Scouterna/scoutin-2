package enroll_test

import (
	"context"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/Scouterna/scoutin-2/printer-proxy/internal/cloud"
	"github.com/Scouterna/scoutin-2/printer-proxy/internal/cloud/fakecloud"
	"github.com/Scouterna/scoutin-2/printer-proxy/internal/enroll"
)

func setup(t *testing.T) (*fakecloud.Server, *enroll.Enroller, chan enroll.Enrollment) {
	old := enroll.PollInterval
	enroll.PollInterval = 20 * time.Millisecond
	t.Cleanup(func() { enroll.PollInterval = old })

	fake := &fakecloud.Server{}
	ts := httptest.NewServer(fake)
	t.Cleanup(ts.Close)
	shown := make(chan enroll.Enrollment, 4)
	en := &enroll.Enroller{
		Server: ts.URL, StateDir: t.TempDir(), Hostname: "test-pi",
		Printers: func() []cloud.PrinterInfo { return []cloud.PrinterInfo{{Serial: "S1", Port: 1}} },
		Show:     func(e enroll.Enrollment) { shown <- e },
		Clear:    func() {},
	}
	return fake, en, shown
}

func next(t *testing.T, shown chan enroll.Enrollment) enroll.Enrollment {
	t.Helper()
	select {
	case e := <-shown:
		return e
	case <-time.After(5 * time.Second):
		t.Fatal("no code shown")
		return enroll.Enrollment{}
	}
}

type result struct {
	key string
	err error
}

func run(ctx context.Context, en *enroll.Enroller) chan result {
	done := make(chan result, 1)
	go func() {
		key, err := en.Run(ctx)
		done <- result{key, err}
	}()
	return done
}

func TestPairByColors(t *testing.T) {
	fake, en, shown := setup(t)
	done := run(context.Background(), en)

	e := next(t, shown)
	if len(e.Colors) != 4 {
		t.Fatalf("code %+v", e)
	}
	key, ok := fake.Pair(strings.Join(e.Colors, ","))
	if !ok {
		t.Fatal("pairing failed")
	}
	r := <-done
	if r.err != nil || r.key != key {
		t.Fatalf("Run = %q, %v; want %q", r.key, r.err, key)
	}

	fi, err := os.Stat(filepath.Join(en.StateDir, "key"))
	if err != nil || fi.Mode().Perm() != 0o600 {
		t.Fatalf("key file: %v, mode %v", err, fi.Mode())
	}
	if _, err := os.Stat(filepath.Join(en.StateDir, "enrollment.json")); !os.IsNotExist(err) {
		t.Error("enrollment.json left behind")
	}
}

func TestRestartKeepsCode(t *testing.T) {
	fake, en, shown := setup(t)
	ctx, cancel := context.WithCancel(context.Background())
	done := run(ctx, en)
	first := next(t, shown)
	cancel()
	<-done

	done = run(context.Background(), en)
	again := next(t, shown)
	if again.ID != first.ID || !slices.Equal(again.Colors, first.Colors) {
		t.Fatalf("after restart got %s/%v, want the same %s/%v", again.ID, again.Colors, first.ID, first.Colors)
	}
	if n := fake.Enrollments(); n != 1 {
		t.Fatalf("%d enrollments on the server, want 1", n)
	}
	if _, ok := fake.Pair(strings.Join(first.Colors, ",")); !ok {
		t.Fatal("pairing failed")
	}
	if r := <-done; r.err != nil {
		t.Fatal(r.err)
	}
}

func TestExpiredStartsOver(t *testing.T) {
	fake, en, shown := setup(t)
	done := run(context.Background(), en)
	first := next(t, shown)

	fake.ForgetEnrollments()
	second := next(t, shown)
	if second.ID == first.ID {
		t.Fatal("same enrollment after the server forgot it")
	}
	if _, ok := fake.Pair(strings.Join(second.Colors, ",")); !ok {
		t.Fatal("pairing failed")
	}
	if r := <-done; r.err != nil {
		t.Fatal(r.err)
	}
}
