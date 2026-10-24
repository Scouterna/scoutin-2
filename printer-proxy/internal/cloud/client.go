package cloud

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math/rand/v2"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/coder/websocket"
)

// Timings, see the spec (§13).
const (
	pingInterval = 10 * time.Second
	deadAfter    = 30 * time.Second
	backoffMin   = time.Second
	backoffMax   = 30 * time.Second
	writeTimeout = 10 * time.Second
	// A job:offer carries a badge PNG, base64-encoded: 5–20 KB of image, so
	// well under this.
	readLimit = 4 << 20
)

// ErrUnauthorized means the server rejected the relay key (revoked or never
// paired).
var ErrUnauthorized = errors.New("relay key rejected")

// Session is one live connection. Send is safe for concurrent use.
type Session struct {
	conn *websocket.Conn
	ctx  context.Context // ends when the connection does
}

func (s *Session) Send(name string, data any) error {
	b, err := Encode(name, data)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(s.ctx, writeTimeout)
	defer cancel()
	return s.conn.Write(ctx, websocket.MessageText, b)
}

// Done is closed when the connection ends.
func (s *Session) Done() <-chan struct{} { return s.ctx.Done() }

// Client keeps a connection to the server's /ws/print-relay, reconnecting with
// backoff.
type Client struct {
	Server string // e.g. https://scoutin.example.se
	Key    func() (string, error)
	// Connected runs at the start of every connection, before any message is
	// read (it sends hello). Message runs for every message received, one at
	// a time, in order. Both see the same session.
	Connected func(*Session) error
	Message   func(*Session, Envelope)
	// Disconnected runs after every connection ends.
	Disconnected func(err error)
}

func wsURL(server string) (string, error) {
	u, err := url.Parse(server)
	if err != nil {
		return "", err
	}
	switch u.Scheme {
	case "https":
		u.Scheme = "wss"
	case "http":
		u.Scheme = "ws"
	case "ws", "wss":
	default:
		return "", fmt.Errorf("server URL %q: want http(s) or ws(s)", server)
	}
	u.Path = strings.TrimSuffix(u.Path, "/") + "/ws/print-relay"
	return u.String(), nil
}

// Run connects and reconnects until ctx is done. It returns ErrUnauthorized
// at once if the server rejects the key: retrying can't help, the relay has to
// enroll again.
func (c *Client) Run(ctx context.Context) error {
	target, err := wsURL(c.Server)
	if err != nil {
		return err
	}
	backoff := backoffMin
	for ctx.Err() == nil {
		started := time.Now()
		err := c.session(ctx, target)
		if c.Disconnected != nil {
			c.Disconnected(err)
		}
		if ctx.Err() != nil {
			break
		}
		if errors.Is(err, ErrUnauthorized) {
			return err
		}
		// A connection that stayed up a while was healthy: start over.
		if time.Since(started) > backoffMax {
			backoff = backoffMin
		}
		// Full jitter, so a venue's worth of Pis don't reconnect in step
		// after a server restart.
		delay := time.Duration(rand.Int64N(int64(backoff))) + backoffMin/2
		slog.Warn("cloud connection lost", "err", err, "retry_in", delay.Round(100*time.Millisecond))
		select {
		case <-ctx.Done():
		case <-time.After(delay):
		}
		backoff = min(backoff*2, backoffMax)
	}
	return nil
}

func (c *Client) session(ctx context.Context, target string) error {
	key, err := c.Key()
	if err != nil {
		return err
	}
	dialCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	conn, resp, err := websocket.Dial(dialCtx, target, &websocket.DialOptions{
		HTTPHeader: http.Header{"Authorization": {"Bearer " + key}},
	})
	cancel()
	if err != nil {
		if resp != nil && resp.StatusCode == http.StatusUnauthorized {
			return ErrUnauthorized
		}
		return err
	}
	defer conn.CloseNow()
	conn.SetReadLimit(readLimit)
	slog.Info("cloud connected", "url", target)

	sctx, end := context.WithCancel(ctx)
	defer end()
	s := &Session{conn: conn, ctx: sctx}

	// Reads happen on their own goroutine: Ping needs a concurrent reader to
	// see the pong.
	msgs := make(chan Envelope, 16)
	readErr := make(chan error, 1)
	go func() {
		for {
			_, b, err := conn.Read(sctx)
			if err != nil {
				readErr <- err
				return
			}
			var m Envelope
			if err := json.Unmarshal(b, &m); err != nil {
				slog.Warn("cloud: bad message", "err", err)
				continue
			}
			select {
			case msgs <- m:
			case <-sctx.Done():
				return
			}
		}
	}()

	if err := c.Connected(s); err != nil {
		return err
	}

	ping := time.NewTicker(pingInterval)
	defer ping.Stop()
	lastPong := time.Now()
	pongs := make(chan struct{}, 1)
	for {
		select {
		case <-ctx.Done():
			conn.Close(websocket.StatusGoingAway, "relay shutting down")
			return ctx.Err()
		case err := <-readErr:
			return err
		case m := <-msgs:
			c.Message(s, m)
		case <-pongs:
			lastPong = time.Now()
		case <-ping.C:
			if time.Since(lastPong) > deadAfter {
				return fmt.Errorf("no pong for %s", deadAfter)
			}
			go func() {
				pctx, cancel := context.WithTimeout(sctx, deadAfter)
				defer cancel()
				if conn.Ping(pctx) == nil {
					select {
					case pongs <- struct{}{}:
					default:
					}
				}
			}()
		}
	}
}
