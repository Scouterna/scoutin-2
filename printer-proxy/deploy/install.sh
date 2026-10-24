#!/bin/bash
# Installs or updates printer-proxy on a Raspberry Pi (spec §8.8). Run it from
# an unpacked release bundle:
#
#   sudo ./install.sh --server https://scoutin.example.se   first install
#   sudo ./install.sh                                         update, keeps the config
#   sudo ./install.sh --no-restart                            as `printer-proxy update` runs it
#
# Safe to re-run. It never reboots by itself; it says when a reboot is needed.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd -P)
prefix=/opt/printer-proxy
config=/etc/printer-proxy/config.yaml
keep_versions=3

die() { echo "install.sh: $*" >&2; exit 1; }
say() { echo "==> $*"; }

server=""
restart=1
while [ $# -gt 0 ]; do
  case "$1" in
    --server) [ $# -ge 2 ] || die "--server needs a URL"; server=$2; shift 2 ;;
    --server=*) server=${1#*=}; shift ;;
    --no-restart) restart=0; shift ;;
    -h | --help) sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown option: $1" ;;
  esac
done

[ "$(id -u)" = 0 ] || die "run as root: sudo $0 $*"
[ "$(uname -m)" = aarch64 ] || die "needs 64-bit Raspberry Pi OS (aarch64), this is $(uname -m)"
[ -x "$here/printer-proxy" ] && [ -f "$here/VERSION" ] || die "run from an unpacked release bundle (printer-proxy and VERSION missing)"
version=$(cat "$here/VERSION")
case "$server" in "" | http://* | https://*) ;; *) die "--server must start with http:// or https://" ;; esac
[ -n "$server" ] || [ -f "$config" ] || die "first install: give --server https://..."

reboot_needed=0

# place SRC DST MODE: install a file only if it differs. Returns 0 if it changed.
place() {
  if [ -f "$2" ] && cmp -s "$1" "$2"; then
    return 1
  fi
  install -D -m "$3" "$1" "$2"
  echo "    updated $2"
}

say "printer-proxy $version"

# --- User ---------------------------------------------------------------------
if ! getent passwd printer-proxy >/dev/null; then
  say "creating system user printer-proxy"
  useradd --system --user-group --home-dir /var/lib/printer-proxy --no-create-home \
    --shell /usr/sbin/nologin printer-proxy
fi

# --- Binary: one directory per version, "current" points at the active one ---
# The whole bundle goes there, so `printer-proxy update` can roll back to a
# kept version by running its install.sh, without a download (spec §8.10).
say "installing binary"
dest=$prefix/versions/$version
if [ "$here" != "$dest" ]; then
  rm -rf "$dest.tmp"
  mkdir -p "$dest.tmp"
  cp -a "$here/." "$dest.tmp/"
  rm -rf "$dest"
  mv "$dest.tmp" "$dest"
fi
touch "$dest" # newest, for the pruning below
ln -sfn "versions/$version" "$prefix/current.tmp"
mv -Tf "$prefix/current.tmp" "$prefix/current" # atomic switch
ln -sfn "$prefix/current/printer-proxy" /usr/local/bin/printer-proxy
# Keep the newest few versions, for rolling back.
ls -1t "$prefix/versions" | tail -n +$((keep_versions + 1)) | while read -r old; do
  [ "$old" = "$version" ] || rm -rf "${prefix:?}/versions/$old"
done

# --- Config -------------------------------------------------------------------
if [ -n "$server" ]; then
  if [ -f "$config" ]; then
    say "setting server in $config"
    tmp=$(mktemp)
    if grep -q '^server:' "$config"; then
      sed "s|^server:.*|server: $server|" "$config" >"$tmp"
    else
      { echo "server: $server"; cat "$config"; } >"$tmp"
    fi
  else
    say "writing $config"
    tmp=$(mktemp)
    sed "s|^server:.*|server: $server|" "$here/config.example.yaml" >"$tmp"
  fi
  install -D -m 0644 "$tmp" "$config"
  rm -f "$tmp"
fi
"$prefix/current/printer-proxy" check-config "$config" || die "fix $config, then re-run"

# --- systemd unit, udev, polkit --------------------------------------------------
say "installing service, udev and polkit rules"
place "$here/printer-proxy.service" /etc/systemd/system/printer-proxy.service 0644 || true
if place "$here/60-printer-proxy-zebra.rules" /etc/udev/rules.d/60-printer-proxy-zebra.rules 0644; then
  udevadm control --reload
  udevadm trigger --subsystem-match=usb --attr-match=idVendor=0a5f --action=add
fi
if [ -d /etc/polkit-1/rules.d ] || dpkg -s polkitd >/dev/null 2>&1; then
  place "$here/50-printer-proxy.rules" /etc/polkit-1/rules.d/50-printer-proxy.rules 0644 || true
else
  echo "    WARNING: polkit isn't installed, so remote reboot/power-off won't work (apt install polkitd)"
fi

# --- Low-write OS setup: make pulling the plug safe (spec §8.8) ---------------
say "reducing SD card writes"
if place "$here/journald-printer-proxy.conf" /etc/systemd/journald.conf.d/50-printer-proxy.conf 0644; then
  systemctl restart systemd-journald
fi
if [ -d /etc/rpi ]; then
  place "$here/swap-printer-proxy.conf" /etc/rpi/swap.conf.d/50-printer-proxy.conf 0644 && reboot_needed=1
fi
for t in apt-daily.timer apt-daily-upgrade.timer man-db.timer; do
  if systemctl is-enabled --quiet "$t" 2>/dev/null; then
    systemctl disable --now "$t" >/dev/null 2>&1 && echo "    disabled $t"
  fi
done

# --- Boot config for the LEDs (spec §8.1) ------------------------------------
bootcfg=/boot/firmware/config.txt
if [ -f "$bootcfg" ]; then
  missing=()
  grep -q '^dtparam=spi=on' "$bootcfg" || missing+=("dtparam=spi=on")
  # Only a Pi 3 derives the SPI clock from a core clock that scales with load.
  if tr -d '\0' </proc/device-tree/model 2>/dev/null | grep -q 'Raspberry Pi 3'; then
    grep -q '^core_freq=250' "$bootcfg" || missing+=("core_freq=250")
    grep -q '^core_freq_min=250' "$bootcfg" || missing+=("core_freq_min=250")
  fi
  if [ ${#missing[@]} -gt 0 ]; then
    say "adding to $bootcfg: ${missing[*]}"
    cp "$bootcfg" "$bootcfg.bak-printer-proxy"
    {
      echo ""
      echo "# Added by printer-proxy install.sh: SPI for the desk LEDs, with the core"
      echo "# clock pinned so NeoPixel timing doesn't drift with load."
      echo "[all]"
      printf '%s\n' "${missing[@]}"
    } >>"$bootcfg"
    reboot_needed=1
  fi
else
  echo "    WARNING: $bootcfg not found; add dtparam=spi=on, core_freq=250 and core_freq_min=250 by hand"
fi

# --- Start ----------------------------------------------------------------------
systemctl daemon-reload
systemctl enable printer-proxy.service >/dev/null 2>&1
if [ "$restart" = 0 ]; then
  # Run by `printer-proxy update` before a start: systemd starts it next.
  echo "Done: printer-proxy $version installed."
  [ "$reboot_needed" = 1 ] && echo "REBOOT NEEDED for the boot or swap changes"
  exit 0
fi
say "starting the service"
systemctl restart printer-proxy.service

echo
echo "Done: printer-proxy $version is running. Logs: journalctl -u printer-proxy -f"
if [ "$(hostname)" = raspberrypi ]; then
  echo "NOTE: the hostname is still 'raspberrypi'. Admin shows it while pairing, so give"
  echo "      each Pi its own (sudo raspi-config → System Options → Hostname)."
fi
if [ "$reboot_needed" = 1 ]; then
  echo "REBOOT NEEDED for the boot or swap changes: sudo reboot"
fi
