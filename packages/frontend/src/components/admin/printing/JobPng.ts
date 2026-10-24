// Reading a PNG for a test print: signature and size from the header, and the
// file as base64 (the backend takes the PNG in the JSON body).

export const MAX_PNG_BYTES = 2 * 1024 * 1024;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export class PngError extends Error {}

/** Width and height from the IHDR chunk. Throws PngError if it isn't a PNG. */
export function parsePngHeader(bytes: Uint8Array): {
  width: number;
  height: number;
} {
  // 8 signature + 4 length + 4 type + 4 width + 4 height.
  if (bytes.length < 24 || !PNG_SIGNATURE.every((b, i) => bytes[i] === b)) {
    throw new PngError("Filen är inte en PNG-bild.");
  }
  const type = String.fromCharCode(...bytes.subarray(12, 16));
  if (type !== "IHDR") {
    throw new PngError("Filen är inte en giltig PNG-bild.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width === 0 || height === 0) {
    throw new PngError("Filen är inte en giltig PNG-bild.");
  }
  return { width, height };
}

/** Base64 without a stack overflow on big arrays: encodes in chunks. */
export function bytesToBase64(bytes: Uint8Array): string {
  // A multiple of 3 so no chunk but the last needs padding.
  const chunkSize = 0x6000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export type PngFile = {
  name: string;
  width: number;
  height: number;
  base64: string;
};

/** Checks the bytes of a PNG and encodes them. Throws PngError with a message to show. */
export function readPngBytes(bytes: Uint8Array, name: string): PngFile {
  if (bytes.length > MAX_PNG_BYTES) {
    throw new PngError("Filen är större än 2 MB.");
  }
  const { width, height } = parsePngHeader(bytes);
  return { name, width, height, base64: bytesToBase64(bytes) };
}

/** Reads a file chosen by the user. Throws PngError with a message to show. */
export async function readPngFile(file: File): Promise<PngFile> {
  // Refuse before reading, so a huge file never ends up in memory.
  if (file.size > MAX_PNG_BYTES) {
    throw new PngError("Filen är större än 2 MB.");
  }
  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new PngError("Filen kunde inte läsas."));
    reader.readAsArrayBuffer(file);
  });
  return readPngBytes(new Uint8Array(buffer), file.name);
}

/** Fetches a PNG bundled with the app and checks it like a file chosen by the user. */
export async function readPngUrl(url: string, name: string): Promise<PngFile> {
  let buffer: ArrayBuffer;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(String(res.status));
    buffer = await res.arrayBuffer();
  } catch {
    throw new PngError("Bilden kunde inte laddas.");
  }
  return readPngBytes(new Uint8Array(buffer), name);
}
