package hw

import (
	"bytes"
	"testing"
)

func TestEncode(t *testing.T) {
	green := []RGB{{0, 255, 0}}

	tests := []struct {
		spiBits int
		want    []byte // leading zero byte, then G=ff, R=00 (B omitted)
		length  int
	}{
		// 3-bit: G=ff is 110×8 = db 6d b6, R=00 is 100×8 = 92 49 24.
		{3, []byte{0x00, 0xdb, 0x6d, 0xb6, 0x92, 0x49, 0x24}, 1 + 9 + 100},
		// 4-bit: G=ff is 1100×8 = cc×4, R=00 is 1000×8 = 88×4.
		{4, []byte{0x00, 0xcc, 0xcc, 0xcc, 0xcc, 0x88, 0x88, 0x88, 0x88}, 1 + 12 + 140},
	}
	for _, tt := range tests {
		got := encode(green, 1, 1, encodings[tt.spiBits])
		if !bytes.HasPrefix(got, tt.want) {
			t.Errorf("%d-bit: got % x, want prefix % x", tt.spiBits, got[:len(tt.want)], tt.want)
		}
		if len(got) != tt.length {
			t.Errorf("%d-bit: length %d, want %d", tt.spiBits, len(got), tt.length)
		}
	}
}

func TestEncodeGammaAndBrightness(t *testing.T) {
	// 0x80 at gamma 2.8 and brightness 0.2: (128/255)^2.8 * 0.2 * 255 ≈ 7.
	got := encode([]RGB{{0, 0x80, 0}}, 0.2, 2.8, encodings[4])
	// 7 = 00000111 → 1000 1000 1000 1000 1000 1100 1100 1100 = 88 88 8c cc
	want := []byte{0x00, 0x88, 0x88, 0x8c, 0xcc}
	if !bytes.HasPrefix(got, want) {
		t.Errorf("got % x, want prefix % x", got[:len(want)], want)
	}
}
