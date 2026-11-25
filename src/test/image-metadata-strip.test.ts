import { describe, it, expect } from "vitest";
import { exifOrientation, minimalExifTiff, stripJpeg, stripPng, stripWebp } from "@/lib/image-metadata-strip";

const seg = (marker: number, body: number[]) => [0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 255, ...body];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/** Segmentos de um JPEG, pelo marcador. */
function markers(b: Uint8Array): number[] {
  const out: number[] = [];
  let o = 2;
  while (o + 4 <= b.length && b[o] === 0xff) {
    const m = b[o + 1];
    out.push(m);
    if (m === 0xda) break;
    o += 2 + ((b[o + 2] << 8) | b[o + 3]);
  }
  return out;
}

describe("stripJpeg", () => {
  const exif = (orientation: number) => [...ascii("Exif\0\0"), ...minimalExifTiff(orientation), ...ascii("GPS-e-camera")];
  const jpeg = (orientation: number) =>
    new Uint8Array([
      0xff, 0xd8,
      ...seg(0xe0, ascii("JFIF\0\x01\x01\0\0\x01\0\x01\0\0")),
      ...seg(0xe1, exif(orientation)),
      ...seg(0xe1, ascii("http://ns.adobe.com/xap/1.0/\0<x:xmpmeta/>")),
      ...seg(0xe2, ascii("ICC_PROFILE\0\x01\x01perfil")),
      ...seg(0xed, ascii("Photoshop 3.0\0IPTC")),
      ...seg(0xee, ascii("Adobe\0d\0\0\0\0\x01")),
      ...seg(0xfe, ascii("comentario do autor")),
      ...seg(0xdb, [0, ...new Array(64).fill(1)]),
      0xff, 0xda, 0, 2, 0x12, 0x34, 0xff, 0xd9,
    ]);

  it("tira EXIF, XMP, IPTC e comentário; mantém JFIF, perfil de cor, Adobe e a imagem", () => {
    const out = stripJpeg(jpeg(1));
    expect(markers(out)).toEqual([0xe0, 0xe2, 0xee, 0xdb, 0xda]);
    expect(String.fromCharCode(...out)).not.toContain("GPS-e-camera");
    expect(String.fromCharCode(...out)).not.toContain("comentario");
    // Os dados depois do SOS vêm idênticos.
    expect(Array.from(out.slice(-6))).toEqual([0, 2, 0x12, 0x34, 0xff, 0xd9]);
  });

  it("orientação diferente de 1 vira um EXIF mínimo, só com ela", () => {
    const out = stripJpeg(jpeg(6));
    expect(markers(out)).toEqual([0xe0, 0xe1, 0xe2, 0xee, 0xdb, 0xda]);
    const app1 = out.indexOf(0xe1, 2);
    const tiff = out.subarray(app1 + 3 + 6);
    expect(exifOrientation(tiff)).toBe(6);
    expect(String.fromCharCode(...out)).not.toContain("GPS-e-camera");
  });
});

describe("stripPng", () => {
  const chunk = (type: string, data: number[]) => [0, 0, 0, data.length, ...ascii(type), ...data, 0, 0, 0, 0];
  it("tira textos, EXIF e data; mantém cor, resolução e imagem", () => {
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ...chunk("IHDR", new Array(13).fill(0)),
      ...chunk("iCCP", ascii("perfil")),
      ...chunk("tEXt", ascii("Author\0Fulano")),
      ...chunk("iTXt", ascii("XML:com.adobe.xmp")),
      ...chunk("eXIf", ascii("MM")),
      ...chunk("tIME", [7, 234, 1, 1, 0, 0, 0]),
      ...chunk("pHYs", new Array(9).fill(0)),
      ...chunk("IDAT", [1, 2, 3]),
      ...chunk("IEND", []),
    ]);
    const text = String.fromCharCode(...stripPng(png));
    for (const t of ["IHDR", "iCCP", "pHYs", "IDAT", "IEND"]) expect(text).toContain(t);
    for (const t of ["tEXt", "Fulano", "iTXt", "eXIf", "tIME"]) expect(text).not.toContain(t);
  });
});

describe("stripWebp", () => {
  const chunk = (type: string, data: number[]) => {
    const pad = data.length & 1 ? [0] : [];
    return [...ascii(type), data.length & 255, (data.length >> 8) & 255, 0, 0, ...data, ...pad];
  };
  it("tira EXIF e XMP, desliga as marcas e corrige o tamanho do RIFF", () => {
    const body = [
      ...chunk("VP8X", [0x2c, 0, 0, 0, 0, 0, 0, 0, 0, 0]), // ICC + EXIF + XMP
      ...chunk("ICCP", ascii("perfil")),
      ...chunk("VP8 ", [1, 2, 3, 4]),
      ...chunk("EXIF", ascii("MMgps")),
      ...chunk("XMP ", ascii("<xmp/>")),
    ];
    const size = body.length + 4;
    const webp = new Uint8Array([...ascii("RIFF"), size & 255, size >> 8, 0, 0, ...ascii("WEBP"), ...body]);
    const out = stripWebp(webp);
    const text = String.fromCharCode(...out);
    expect(text).not.toContain("EXIF");
    expect(text).not.toContain("XMP ");
    expect(text).toContain("ICCP");
    expect(out[12 + 8] & 0x0c).toBe(0); // marcas de EXIF e XMP desligadas
    expect(out[12 + 8] & 0x20).toBe(0x20); // ICC continua
    expect(out[4] | (out[5] << 8)).toBe(out.length - 8);
  });
});
