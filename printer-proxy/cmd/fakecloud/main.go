// Command fakecloud is a stand-in for the scoutin server's relay hub, for
// driving printer-proxy end to end before the real backend exists.
//
//	fakecloud -listen :8080 -key test
//	printer-proxy -server http://localhost:8080 ...   (with "test" in <state-dir>/key)
//	curl --data-binary @badge.png 'localhost:8080/jobs?serial=D8J241203531&wait=1'
//	curl localhost:8080/jobs
//	curl localhost:8080/printers
//	curl -X POST localhost:8080/disconnect
//	fakecloud -bundle dist/printer-proxy-<version>-linux-arm64.tar.gz   offer it to `printer-proxy update`
package main

import (
	"flag"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/Scouterna/scoutin-2/printer-proxy/internal/cloud/fakecloud"
)

func main() {
	listen := flag.String("listen", ":8080", "address to listen on")
	key := flag.String("key", "", "relay key to require (empty = accept any)")
	leaseTTL := flag.Duration("lease-ttl", 15*time.Second, "how long a lease waits for job:begin")
	dropBegin := flag.Int("drop-begin-acks", 0, "drop this many beginAcks (tests: no ack, no write)")
	dropResult := flag.Int("drop-result-acks", 0, "drop this many resultAcks (tests: result resent on reconnect)")
	bundle := flag.String("bundle", "", "dist.sh bundle to offer `printer-proxy update` (empty = name no version)")
	flag.Parse()

	s := &fakecloud.Server{Key: *key, LeaseTTL: *leaseTTL, Bundle: *bundle, DropBeginAcks: *dropBegin, DropResultAcks: *dropResult}
	slog.Info("fakecloud listening", "addr", *listen)
	if err := http.ListenAndServe(*listen, s); err != nil {
		slog.Error("fakecloud", "err", err)
		os.Exit(1)
	}
}
