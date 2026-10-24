#!/bin/bash
# Builds the release bundle for a Raspberry Pi (64-bit):
#
#   ./dist.sh
#
# The version is the git tree hash of printer-proxy/ (spec §8.10): it changes
# only when something in printer-proxy/ does, and uncommitted changes count, as
# if they were committed (files in .gitignore don't). Override with VERSION=...
#
# Output: dist/printer-proxy-<version>-linux-arm64.tar.gz and its .sha256.
# On the Pi: tar xzf printer-proxy-*.tar.gz && cd printer-proxy-* && sudo ./install.sh ...
set -euo pipefail
cd "$(dirname "$0")"

# tree prints the tree hash of this directory as it is on disk, using a
# throwaway index so the real one (what's staged) is untouched.
tree() {
  local index
  index=$(mktemp)
  trap 'rm -f "$index"' RETURN
  GIT_INDEX_FILE=$index git read-tree HEAD
  GIT_INDEX_FILE=$index git add -A .
  GIT_INDEX_FILE=$index git write-tree --prefix=printer-proxy/
}
version=${VERSION:-$(tree)}
name="printer-proxy-$version-linux-arm64"
out="dist/$name"

rm -rf "$out" "$out.tar.gz" "$out.tar.gz.sha256"
mkdir -p "$out"
GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -trimpath \
  -ldflags "-s -w -X main.version=$version" -o "$out/printer-proxy" ./cmd/printer-proxy
echo "$version" >"$out/VERSION"
cp deploy/install.sh deploy/printer-proxy.service deploy/60-printer-proxy-zebra.rules \
  deploy/50-printer-proxy.rules deploy/journald-printer-proxy.conf \
  deploy/swap-printer-proxy.conf deploy/config.example.yaml "$out/"
tar -C dist -czf "$out.tar.gz" "$name"
(cd dist && sha256sum "$name.tar.gz" >"$name.tar.gz.sha256")
rm -rf "$out"
echo "dist/$name.tar.gz"
