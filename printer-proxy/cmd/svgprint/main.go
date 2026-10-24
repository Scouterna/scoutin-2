// Command svgprint is a hardware spike: it rasterizes an SVG (or loads a PNG),
// thresholds it to 1-bit and prints it on a Zebra printer as a ZPL ^GFA
// graphic. It exists to check print quality on real badge stock, not as part
// of the relay.
//
// SVG rasterization shells out to resvg (preferred, same engine as the cloud
// pipeline) or rsvg-convert, whichever is on PATH. Neither loads web fonts from
// @font-face URLs, so fonts must be installed or passed with -font, and
// -font-alias maps a family name used in the SVG to the font's real name.
package main

import (
	"bytes"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
)

// ZD421 maximum print width.
const maxPrintWidthMM = 104.0

func main() {
	dpi := flag.Int("dpi", 203, "printer resolution; also used to convert mm/in units in the SVG")
	width := flag.Int("width", 0, "scale the image to this width in dots (0 = the SVG's own size at -dpi)")
	threshold := flag.Int("threshold", 128, "luminance below this (0-255) prints black")
	x := flag.Int("x", 0, "horizontal offset in dots")
	y := flag.Int("y", 0, "vertical offset in dots")
	device := flag.String("device", "/dev/usb/lp0", "printer device")
	preview := flag.String("preview", "", "also write the 1-bit result to this PNG file")
	zplOut := flag.String("zpl", "", "write the ZPL to this file instead of printing")
	dryRun := flag.Bool("dry-run", false, "don't print")
	var fonts, aliases listFlag
	flag.Var(&fonts, "font", "font file to load (resvg only; repeatable)")
	flag.Var(&aliases, "font-alias", "rewrite a font family in the SVG, e.g. 'MyFont=My Font Pro' (repeatable)")
	flag.Usage = func() {
		fmt.Fprintf(os.Stderr, "usage: svgprint [flags] <file.svg|file.png>\n\n")
		flag.PrintDefaults()
	}
	flag.Parse()

	if flag.NArg() != 1 {
		flag.Usage()
		os.Exit(2)
	}

	r := rasterOpts{dpi: *dpi, width: *width, fonts: fonts, aliases: map[string]string{}}
	for _, a := range aliases {
		from, to, ok := strings.Cut(a, "=")
		if !ok {
			fmt.Fprintf(os.Stderr, "svgprint: -font-alias %q is not FROM=TO\n", a)
			os.Exit(2)
		}
		r.aliases[strings.TrimSpace(from)] = strings.TrimSpace(to)
	}

	if err := run(flag.Arg(0), r, *threshold, *x, *y, *device, *preview, *zplOut, *dryRun); err != nil {
		fmt.Fprintln(os.Stderr, "svgprint:", err)
		os.Exit(1)
	}
}

type listFlag []string

func (l *listFlag) String() string     { return strings.Join(*l, ", ") }
func (l *listFlag) Set(v string) error { *l = append(*l, v); return nil }

type rasterOpts struct {
	dpi, width int
	fonts      []string
	aliases    map[string]string
}

func run(input string, r rasterOpts, threshold, x, y int, device, preview, zplOut string, dryRun bool) error {
	dpi := r.dpi
	img, err := load(input, r)
	if err != nil {
		return err
	}

	mono := toMono(img, uint8(threshold))
	b := mono.Bounds()
	fmt.Printf("image: %dx%d dots (%.1fx%.1f mm at %d dpi)\n",
		b.Dx(), b.Dy(), dotsToMM(b.Dx(), dpi), dotsToMM(b.Dy(), dpi), dpi)

	if maxDots := int(maxPrintWidthMM / 25.4 * float64(dpi)); x+b.Dx() > maxDots {
		fmt.Printf("warning: image ends at %d dots but the print head is only %d dots wide; the right edge will be cut off\n",
			x+b.Dx(), maxDots)
	}

	if preview != "" {
		if err := writePNG(preview, mono); err != nil {
			return err
		}
		fmt.Println("preview written to", preview)
	}

	zpl := toZPL(mono, x, y)

	if zplOut != "" {
		if err := os.WriteFile(zplOut, zpl, 0o644); err != nil {
			return err
		}
		fmt.Println("ZPL written to", zplOut)
		return nil
	}
	if dryRun {
		return nil
	}

	f, err := os.OpenFile(device, os.O_WRONLY, 0)
	if err != nil {
		return fmt.Errorf("open printer (is the user in the lp group?): %w", err)
	}
	defer f.Close()
	if _, err := f.Write(zpl); err != nil {
		return fmt.Errorf("write to printer: %w", err)
	}
	fmt.Printf("sent %d bytes to %s\n", len(zpl), device)
	return nil
}

func load(path string, r rasterOpts) (image.Image, error) {
	if strings.EqualFold(filepath.Ext(path), ".png") {
		return readPNG(path)
	}
	dpi, width := r.dpi, r.width

	tmp, err := os.MkdirTemp("", "svgprint")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(tmp)
	out := filepath.Join(tmp, "out.png")

	if len(r.aliases) > 0 {
		src, err := os.ReadFile(path)
		if err != nil {
			return nil, err
		}
		path = filepath.Join(tmp, "in.svg")
		if err := os.WriteFile(path, aliasFonts(src, r.aliases), 0o600); err != nil {
			return nil, err
		}
	}

	var cmd *exec.Cmd
	if bin, err := exec.LookPath("resvg"); err == nil {
		args := []string{"--dpi", fmt.Sprint(dpi), "--background", "white"}
		if width > 0 {
			args = append(args, "-w", fmt.Sprint(width))
		}
		for _, f := range r.fonts {
			args = append(args, "--use-font-file", f)
		}
		cmd = exec.Command(bin, append(args, path, out)...)
	} else if len(r.fonts) > 0 {
		return nil, errors.New("-font needs resvg; with rsvg-convert, install the fonts into ~/.local/share/fonts instead")
	} else if bin, err := exec.LookPath("rsvg-convert"); err == nil {
		args := []string{"--dpi-x", fmt.Sprint(dpi), "--dpi-y", fmt.Sprint(dpi), "-b", "white", "-o", out}
		if width > 0 {
			args = append(args, "-w", fmt.Sprint(width), "--keep-aspect-ratio")
		}
		cmd = exec.Command(bin, append(args, path)...)
	} else {
		return nil, errors.New("no SVG rasterizer found: install resvg or rsvg-convert (apt install librsvg2-bin), or pass a PNG")
	}

	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("%s: %w", filepath.Base(cmd.Path), err)
	}
	return readPNG(out)
}

var fontFamilyRe = regexp.MustCompile(`(font-family\s*[:=]\s*)("[^"]*"|[^;">]*)`)

// aliasFonts rewrites family names inside font-family declarations, both CSS
// properties and attributes. Each comma-separated family is matched exactly,
// ignoring quotes.
func aliasFonts(svg []byte, aliases map[string]string) []byte {
	return fontFamilyRe.ReplaceAllFunc(svg, func(m []byte) []byte {
		sub := fontFamilyRe.FindSubmatch(m)
		value := string(sub[2])
		quoted := strings.HasPrefix(value, `"`)
		families := strings.Split(strings.Trim(value, `"`), ",")
		for i, f := range families {
			name := strings.Trim(strings.TrimSpace(f), `'"`)
			if to, ok := aliases[name]; ok {
				families[i] = "'" + to + "'"
			}
		}
		value = strings.Join(families, ",")
		if quoted {
			value = `"` + value + `"`
		}
		return append(append([]byte{}, sub[1]...), value...)
	})
}

func readPNG(path string) (image.Image, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return png.Decode(f)
}

// toMono composites the image over white and thresholds its luminance.
// Returned pixels are 0 (black) or 255 (white).
func toMono(img image.Image, threshold uint8) *image.Gray {
	b := img.Bounds()
	out := image.NewGray(image.Rect(0, 0, b.Dx(), b.Dy()))
	for py := 0; py < b.Dy(); py++ {
		for px := 0; px < b.Dx(); px++ {
			r, g, bl, a := img.At(b.Min.X+px, b.Min.Y+py).RGBA()
			// RGBA() is alpha-premultiplied, so adding the missing coverage as
			// white composites over a white background.
			r, g, bl = r+(0xffff-a), g+(0xffff-a), bl+(0xffff-a)
			lum := (299*r + 587*g + 114*bl) / 1000 >> 8
			v := uint8(255)
			if lum < uint32(threshold) {
				v = 0
			}
			out.SetGray(px, py, color.Gray{Y: v})
		}
	}
	return out
}

// toZPL encodes the image as an uncompressed ASCII-hex ^GFA graphic. It
// deliberately sets no ^PW/^LL so the printer's own configuration is used.
func toZPL(img *image.Gray, x, y int) []byte {
	b := img.Bounds()
	bytesPerRow := (b.Dx() + 7) / 8
	data := make([]byte, bytesPerRow*b.Dy())
	for py := 0; py < b.Dy(); py++ {
		for px := 0; px < b.Dx(); px++ {
			// In ZPL a set bit is a black dot, MSB first.
			if img.GrayAt(px, py).Y == 0 {
				data[py*bytesPerRow+px/8] |= 0x80 >> (px % 8)
			}
		}
	}

	var buf bytes.Buffer
	fmt.Fprintf(&buf, "^XA\n^FO%d,%d^GFA,%d,%d,%d,", x, y, len(data), len(data), bytesPerRow)
	buf.WriteString(strings.ToUpper(hex.EncodeToString(data)))
	buf.WriteString("^FS\n^XZ\n")
	return buf.Bytes()
}

// writePNG writes the thresholded image as a 1-bit PNG (Go encodes a
// two-color palette at bit depth 1), which is what the relay accepts.
func writePNG(path string, img *image.Gray) error {
	r := img.Bounds()
	out := image.NewPaletted(r, color.Palette{color.Black, color.White})
	for y := r.Min.Y; y < r.Max.Y; y++ {
		for x := r.Min.X; x < r.Max.X; x++ {
			if img.GrayAt(x, y).Y != 0 {
				out.SetColorIndex(x, y, 1)
			}
		}
	}
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	if err := png.Encode(f, out); err != nil {
		f.Close()
		return err
	}
	return f.Close()
}

func dotsToMM(dots, dpi int) float64 {
	return float64(dots) / float64(dpi) * 25.4
}
