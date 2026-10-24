package zpl

import (
	"bytes"
	"errors"
	"image"
	"image/color"
	"image/png"
	"math/rand/v2"
	"strconv"
	"strings"
	"testing"
)

// decompress expands ZPL ASCII-compressed ^GFA data back to raw bytes, as the
// printer would.
func decompress(t *testing.T, s string, bytesPerRow, rows int) []byte {
	t.Helper()
	hexPerRow := 2 * bytesPerRow
	var out, row, prev []byte
	endRow := func() {
		if len(row) != hexPerRow {
			t.Fatalf("row %d has %d hex digits, want %d", len(out)/bytesPerRow, len(row), hexPerRow)
		}
		for i := 0; i < len(row); i += 2 {
			v, _ := strconv.ParseUint(string(row[i:i+2]), 16, 8)
			out = append(out, byte(v))
		}
		prev, row = row, nil
	}
	count := 0
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c >= 'G' && c <= 'Y':
			count += int(c-'G') + 1
		case c >= 'g' && c <= 'z':
			count += (int(c-'g') + 1) * 20
		case c == ',' || c == '!':
			fill := byte('0')
			if c == '!' {
				fill = 'F'
			}
			for len(row) < hexPerRow {
				row = append(row, fill)
			}
			endRow()
		case c == ':':
			if prev == nil || len(row) != 0 {
				t.Fatalf(": at offset %d without a complete previous row", i)
			}
			row = append(row, prev...)
			endRow()
		default:
			n := max(count, 1)
			count = 0
			for range n {
				row = append(row, c)
			}
			if len(row) == hexPerRow {
				endRow()
			}
		}
	}
	if len(row) != 0 || len(out) != bytesPerRow*rows {
		t.Fatalf("decoded %d bytes (+%d hex digits pending), want %d", len(out), len(row), bytesPerRow*rows)
	}
	return out
}

func gfaData(t *testing.T, zpl []byte) (total, bytesPerRow int, data string) {
	t.Helper()
	s := string(zpl)
	if !strings.HasPrefix(s, "^XA^FO0,0^GFA,") || !strings.HasSuffix(s, "^FS^XZ") {
		t.Fatalf("unexpected framing: %.40q…", s)
	}
	fields := strings.SplitN(strings.TrimSuffix(strings.TrimPrefix(s, "^XA^FO0,0^GFA,"), "^FS^XZ"), ",", 4)
	total, _ = strconv.Atoi(fields[0])
	bytesPerRow, _ = strconv.Atoi(fields[2])
	return total, bytesPerRow, fields[3]
}

func TestRoundTrip(t *testing.T) {
	rng := rand.New(rand.NewPCG(1, 2))
	cases := map[string]func(x, y int) bool{
		"white":   func(x, y int) bool { return false },
		"black":   func(x, y int) bool { return true },
		"stripes": func(x, y int) bool { return y%7 < 3 },
		"block":   func(x, y int) bool { return x > 100 && x < 700 && y > 50 && y < 300 },
		"edge":    func(x, y int) bool { return x == 0 || x == 799 },
		"noise":   func(x, y int) bool { return rng.IntN(5) == 0 },
	}
	for name, black := range cases {
		t.Run(name, func(t *testing.T) {
			// 803 wide: a partial last byte.
			bm := &Bitmap{Width: 803, Height: 400, BytesPerRow: 101}
			bm.Data = make([]byte, bm.BytesPerRow*bm.Height)
			for y := range bm.Height {
				for x := range bm.Width {
					if black(x, y) {
						bm.Data[y*bm.BytesPerRow+x/8] |= 0x80 >> (x % 8)
					}
				}
			}
			total, bpr, data := gfaData(t, Label(bm))
			if total != len(bm.Data) || bpr != bm.BytesPerRow {
				t.Fatalf("header total=%d bytesPerRow=%d", total, bpr)
			}
			if got := decompress(t, data, bpr, bm.Height); !bytes.Equal(got, bm.Data) {
				t.Fatal("round trip changed the data")
			}
		})
	}
}

func TestCompressionIsCheap(t *testing.T) {
	bm := &Bitmap{Width: 800, Height: 2060, BytesPerRow: 100}
	bm.Data = make([]byte, 100*2060)
	if n := len(Label(bm)); n > 2200 {
		t.Errorf("blank badge is %d bytes", n)
	}
}

func TestWriteCount(t *testing.T) {
	for n, want := range map[int]string{1: "", 2: "H", 19: "Y", 20: "g", 21: "gG", 399: "yY", 400: "z", 401: "zG", 845: "zzhK"} {
		var b bytes.Buffer
		writeCount(&b, n)
		if b.String() != want {
			t.Errorf("writeCount(%d) = %q, want %q", n, b.String(), want)
		}
	}
}

func encode(t *testing.T, img image.Image, enc png.Encoder) []byte {
	var b bytes.Buffer
	if err := enc.Encode(&b, img); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func TestDecodePNG(t *testing.T) {
	// Go's encoder writes a 2-entry paletted image as 1-bit.
	pal := image.NewPaletted(image.Rect(0, 0, 16, 2), color.Palette{color.White, color.Black})
	pal.SetColorIndex(0, 0, 1)
	pal.SetColorIndex(15, 1, 1)
	b := encode(t, pal, png.Encoder{})

	bm, err := DecodePNG(b, 16, 2, 800)
	if err != nil {
		t.Fatal(err)
	}
	if want := []byte{0x80, 0, 0, 0x01}; !bytes.Equal(bm.Data, want) {
		t.Errorf("data = % x, want % x", bm.Data, want)
	}

	for name, err := range map[string]error{
		"wrong size": func() error { _, err := DecodePNG(b, 16, 3, 800); return err }(),
		"too wide":   func() error { _, err := DecodePNG(b, 16, 2, 8); return err }(),
		"8-bit gray": func() error {
			_, err := DecodePNG(encode(t, image.NewGray(image.Rect(0, 0, 16, 2)), png.Encoder{}), 16, 2, 800)
			return err
		}(),
		"garbage": func() error { _, err := DecodePNG([]byte("hello"), 16, 2, 800); return err }(),
	} {
		if !errors.Is(err, ErrInvalidImage) {
			t.Errorf("%s: err = %v, want invalid_image", name, err)
		}
	}
}

func TestPack(t *testing.T) {
	// 10 wide (a partial last byte), offset bounds, black on the left and right
	// edges of row 0 and in the middle of row 1.
	r := image.Rect(5, 7, 15, 9)
	pal := image.NewPaletted(r, color.Palette{color.White, color.Black})
	gray := image.NewGray(r)
	for y := r.Min.Y; y < r.Max.Y; y++ {
		for x := r.Min.X; x < r.Max.X; x++ {
			gray.SetGray(x, y, color.Gray{Y: 255})
		}
	}
	for _, p := range []image.Point{{5, 7}, {14, 7}, {9, 8}} {
		pal.SetColorIndex(p.X, p.Y, 1)
		gray.SetGray(p.X, p.Y, color.Gray{})
	}
	want := []byte{0x80, 0x40, 0x08, 0x00}
	for name, img := range map[string]image.Image{"paletted": pal, "gray": gray} {
		bm, err := pack(img)
		if err != nil {
			t.Fatal(err)
		}
		if bm.Width != 10 || bm.Height != 2 || bm.BytesPerRow != 2 || !bytes.Equal(bm.Data, want) {
			t.Errorf("%s: got %d×%d, %d bytes/row, % x; want 10×2, 2 bytes/row, % x", name, bm.Width, bm.Height, bm.BytesPerRow, bm.Data, want)
		}
	}

	if _, err := pack(image.NewRGBA(r)); !errors.Is(err, ErrInvalidImage) {
		t.Errorf("RGBA: err = %v, want invalid_image", err)
	}
}
