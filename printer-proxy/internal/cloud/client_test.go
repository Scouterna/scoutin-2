package cloud

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestUnauthorized(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "no", http.StatusUnauthorized)
	}))
	defer ts.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	got := make(chan error, 1)
	c := &Client{
		Server:    ts.URL,
		Key:       func() (string, error) { return "revoked", nil },
		Connected: func(*Session) error { return nil },
		Message:   func(*Session, Envelope) {},
		Disconnected: func(err error) {
			select {
			case got <- err:
			default:
			}
		},
	}
	if err := c.Run(ctx); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("Run = %v, want ErrUnauthorized", err)
	}
	if err := <-got; !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("Disconnected got %v, want ErrUnauthorized", err)
	}
}

func TestWSURL(t *testing.T) {
	for in, want := range map[string]string{
		"https://scoutin.example.se": "wss://scoutin.example.se/ws/print-relay",
		"http://localhost:8080/":     "ws://localhost:8080/ws/print-relay",
		"https://example.se/scoutin": "wss://example.se/scoutin/ws/print-relay",
	} {
		if got, err := wsURL(in); err != nil || got != want {
			t.Errorf("wsURL(%q) = %q, %v; want %q", in, got, err, want)
		}
	}
}
