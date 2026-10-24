package zpl

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"math/rand/v2"
	"testing"
)

// badgePNG is a synthetic 800×2060 1-bit badge: a solid header band, blocks
// of "text" and blank space, roughly like a real badge.
func badgePNG(b *testing.B) []byte {
	img := image.NewPaletted(image.Rect(0, 0, 800, 2060), color.Palette{color.White, color.Black})
	rng := rand.New(rand.NewPCG(1, 2))
	for y := range 2060 {
		for x := range 800 {
			switch {
			case y < 300:
				img.Pix[y*img.Stride+x] = 1
			case y > 500 && y < 1400 && (y/40)%2 == 0 && rng.IntN(3) == 0:
				img.Pix[y*img.Stride+x] = 1
			}
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		b.Fatal(err)
	}
	return buf.Bytes()
}

func BenchmarkDecodePNG(b *testing.B) {
	data := badgePNG(b)
	b.SetBytes(int64(len(data)))
	for b.Loop() {
		if _, err := DecodePNG(data, 800, 2060, 800); err != nil {
			b.Fatal(err)
		}
	}
}

// BenchmarkPNGDecodeOnly is the image/png part of DecodePNG on its own.
func BenchmarkPNGDecodeOnly(b *testing.B) {
	data := badgePNG(b)
	for b.Loop() {
		if _, err := png.Decode(bytes.NewReader(data)); err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkPack(b *testing.B) {
	img, err := png.Decode(bytes.NewReader(badgePNG(b)))
	if err != nil {
		b.Fatal(err)
	}
	for b.Loop() {
		pack(img)
	}
}

func BenchmarkLabel(b *testing.B) {
	bm, err := DecodePNG(badgePNG(b), 800, 2060, 800)
	if err != nil {
		b.Fatal(err)
	}
	for b.Loop() {
		Label(bm)
	}
}
