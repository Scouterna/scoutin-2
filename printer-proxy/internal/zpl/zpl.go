// Package zpl turns a rendered 1-bit badge into a ZPL ^GFA graphic.
package zpl

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/png"
)

// ErrInvalidImage means the image can never be printed as sent; the job fails
// without anything being written (spec §8.4).
var ErrInvalidImage = errors.New("invalid_image")

// Bitmap is a 1-bit image, rows packed MSB first, a set bit being a black dot.
type Bitmap struct {
	Width, Height int
	BytesPerRow   int
	Data          []byte
}

// DecodePNG accepts only a 1-bit grayscale or a 2-color paletted PNG of the
// given size, no wider than maxWidth dots.
func DecodePNG(b []byte, width, height, maxWidth int) (*Bitmap, error) {
	// IHDR is always the first chunk: 8-byte signature, 4-byte length, "IHDR",
	// then width, height, bit depth, color type.
	if len(b) < 26 || string(b[12:16]) != "IHDR" {
		return nil, fmt.Errorf("%w: not a PNG", ErrInvalidImage)
	}
	depth, colorType := b[24], b[25]
	if depth != 1 || (colorType != 0 && colorType != 3) {
		return nil, fmt.Errorf("%w: want a 1-bit grayscale or paletted PNG, got bit depth %d, color type %d", ErrInvalidImage, depth, colorType)
	}
	w, h := int(binary.BigEndian.Uint32(b[16:20])), int(binary.BigEndian.Uint32(b[20:24]))
	if w != width || h != height {
		return nil, fmt.Errorf("%w: image is %d×%d, offer says %d×%d", ErrInvalidImage, w, h, width, height)
	}
	if w > maxWidth {
		return nil, fmt.Errorf("%w: image is %d dots wide, printer prints %d", ErrInvalidImage, w, maxWidth)
	}

	img, err := png.Decode(bytes.NewReader(b))
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidImage, err)
	}
	return pack(img)
}

// pack inverts polarity on the way: in PNG gray 0 is black, in ZPL a set bit
// is a black dot. It handles the two types image/png returns for the accepted
// formats, reading their pixel bytes directly (per-pixel At and color
// conversion took ~200 ms per badge on a Pi 3B+).
func pack(img image.Image) (*Bitmap, error) {
	r := img.Bounds()
	var pix []byte
	var stride int
	var black [256]bool
	switch m := img.(type) {
	case *image.Paletted:
		pix, stride = m.Pix[m.PixOffset(r.Min.X, r.Min.Y):], m.Stride
		for i, c := range m.Palette {
			black[i] = color.GrayModel.Convert(c).(color.Gray).Y < 0x80
		}
	case *image.Gray:
		pix, stride = m.Pix[m.PixOffset(r.Min.X, r.Min.Y):], m.Stride
		for v := range black {
			black[v] = v < 0x80
		}
	default:
		return nil, fmt.Errorf("%w: unsupported image type %T", ErrInvalidImage, img)
	}

	bm := &Bitmap{Width: r.Dx(), Height: r.Dy(), BytesPerRow: (r.Dx() + 7) / 8}
	bm.Data = make([]byte, bm.BytesPerRow*bm.Height)
	for y := 0; y < bm.Height; y++ {
		row := pix[y*stride : y*stride+bm.Width]
		out := bm.Data[y*bm.BytesPerRow:]
		for x, v := range row {
			if black[v] {
				out[x/8] |= 0x80 >> (x % 8)
			}
		}
	}
	return bm, nil
}

// Label wraps the bitmap in a complete format at the origin. It deliberately
// sets nothing else (no ^PW, ^LL, ^PR, darkness…): the printer's own
// configuration applies, and that's managed through profiles (spec §8.9).
func Label(bm *Bitmap) []byte {
	var buf bytes.Buffer
	total := len(bm.Data)
	fmt.Fprintf(&buf, "^XA^FO0,0^GFA,%d,%d,%d,", total, total, bm.BytesPerRow)
	writeCompressed(&buf, bm)
	buf.WriteString("^FS^XZ")
	return buf.Bytes()
}

const hexDigits = "0123456789ABCDEF"

// writeCompressed emits the bitmap as hex with ZPL ASCII compression: repeat
// counts before a digit, "," / "!" to fill the rest of a row with 0 / F, and
// ":" to repeat the previous row.
func writeCompressed(buf *bytes.Buffer, bm *Bitmap) {
	row := make([]byte, 2*bm.BytesPerRow)
	var prev []byte
	for y := 0; y < bm.Height; y++ {
		src := bm.Data[y*bm.BytesPerRow : (y+1)*bm.BytesPerRow]
		if prev != nil && bytes.Equal(src, prev) {
			buf.WriteByte(':')
			continue
		}
		prev = src
		for i, b := range src {
			row[2*i], row[2*i+1] = hexDigits[b>>4], hexDigits[b&0xf]
		}
		writeRow(buf, row)
	}
}

func writeRow(buf *bytes.Buffer, row []byte) {
	for i := 0; i < len(row); {
		c := row[i]
		j := i
		for j < len(row) && row[j] == c {
			j++
		}
		if j == len(row) && (c == '0' || c == 'F') {
			if c == '0' {
				buf.WriteByte(',')
			} else {
				buf.WriteByte('!')
			}
			return
		}
		writeCount(buf, j-i)
		buf.WriteByte(c)
		i = j
	}
}

// writeCount writes a repeat count: g–z are 20–400 in steps of 20, G–Y are
// 1–19. A count of 1 needs no prefix.
func writeCount(buf *bytes.Buffer, n int) {
	if n == 1 {
		return
	}
	for ; n >= 400; n -= 400 {
		buf.WriteByte('z')
	}
	if n >= 20 {
		buf.WriteByte(byte('g' + n/20 - 1))
		n %= 20
	}
	if n > 0 {
		buf.WriteByte(byte('G' + n - 1))
	}
}
