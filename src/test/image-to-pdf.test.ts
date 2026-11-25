import { describe, it, expect } from "vitest";
import { effectiveDpi, orientationMatrix, readJpegInfo, readPngInfo, swapsAxes } from "@/lib/image-to-pdf";

/** JPEG mínimo: SOI, APP0 JFIF opcional, APP1 Exif opcional, SOF0 e EOI. */
function jpeg(opts: { w: number; h: number; jfif?: { units: number; x: number; y: number }; exif?: number[] }) {
  const parts: number[] = [0xff, 0xd8];
  if (opts.jfif) {
    const { units, x, y } = opts.jfif;
    parts.push(0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, units, x >> 8, x & 255, y >> 8, y & 255, 0, 0);
  }
  if (opts.exif) {
    const payload = [0x45, 0x78, 0x69, 0x66, 0, 0, ...opts.exif];
    const len = payload.length + 2;
    parts.push(0xff, 0xe1, len >> 8, len & 255, ...payload);
  }
  parts.push(0xff, 0xc0, 0, 11, 8, opts.h >> 8, opts.h & 255, opts.w >> 8, opts.w & 255, 1, 1, 0x11, 0);
  parts.push(0xff, 0xd9);
  return new Uint8Array(parts);
}

/** TIFF big-endian com orientação e resolução (72/1 ou o valor dado). */
function exifTiff(orientation: number, dpi: number) {
  // Cabeçalho (8) + IFD com 4 entradas (2 + 4*12 + 4) = 62; racionais depois.
  const rational = 62;
  const entry = (tag: number, type: number, value: number[]) => [tag >> 8, tag & 255, 0, type, 0, 0, 0, 1, ...value];
  const ptr = (o: number) => [0, 0, o >> 8, o & 255];
  return [
    0x4d, 0x4d, 0, 42, 0, 0, 0, 8,
    0, 4,
    ...entry(0x0112, 3, [0, orientation, 0, 0]),
    ...entry(0x011a, 5, ptr(rational)),
    ...entry(0x011b, 5, ptr(rational + 8)),
    ...entry(0x0128, 3, [0, 2, 0, 0]),
    0, 0, 0, 0,
    0, 0, 0, dpi, 0, 0, 0, 1,
    0, 0, 0, dpi, 0, 0, 0, 1,
  ];
}

function png(w: number, h: number, ppm?: number) {
  const chunk = (type: string, data: number[]) => {
    const len = data.length;
    return [len >>> 24, (len >> 16) & 255, (len >> 8) & 255, len & 255, ...[...type].map((c) => c.charCodeAt(0)), ...data, 0, 0, 0, 0];
  };
  const be = (v: number) => [v >>> 24, (v >> 16) & 255, (v >> 8) & 255, v & 255];
  const parts = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunk("IHDR", [...be(w), ...be(h), 8, 6, 0, 0, 0])];
  if (ppm) parts.push(...chunk("pHYs", [...be(ppm), ...be(ppm), 1]));
  parts.push(...chunk("IDAT", []), ...chunk("IEND", []));
  return new Uint8Array(parts);
}

describe("readJpegInfo", () => {
  it("lê tamanho e DPI do JFIF", () => {
    expect(readJpegInfo(jpeg({ w: 2480, h: 3508, jfif: { units: 1, x: 300, y: 300 } }))).toEqual({
      width: 2480, height: 3508, dpiX: 300, dpiY: 300, orientation: 1,
    });
  });

  it("converte DPI em pontos por centímetro", () => {
    expect(readJpegInfo(jpeg({ w: 10, h: 10, jfif: { units: 2, x: 118, y: 118 } }))?.dpiX).toBeCloseTo(299.72, 1);
  });

  it("lê orientação e resolução do EXIF", () => {
    const info = readJpegInfo(jpeg({ w: 4000, h: 3000, exif: exifTiff(6, 72) }));
    expect(info).toMatchObject({ width: 4000, height: 3000, orientation: 6, dpiX: 72, dpiY: 72 });
  });

  it("recusa o que não é JPEG", () => {
    expect(readJpegInfo(png(1, 1))).toBeNull();
  });
});

describe("readPngInfo", () => {
  it("lê tamanho e a resolução do pHYs (pixels por metro)", () => {
    const info = readPngInfo(png(800, 600, 11811));
    expect(info?.width).toBe(800);
    expect(info?.height).toBe(600);
    expect(info?.dpiX).toBeCloseTo(300, 0);
  });

  it("sem pHYs, sem DPI", () => {
    expect(readPngInfo(png(5, 5))?.dpiX).toBeNull();
  });
});

describe("tamanho e orientação na página", () => {
  it("DPI implausível vira o padrão de tela", () => {
    expect(effectiveDpi(null)).toBe(96);
    expect(effectiveDpi(1)).toBe(96);
    expect(effectiveDpi(300)).toBe(300);
  });

  it("orientações 5 a 8 trocam largura e altura", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(swapsAxes)).toEqual([false, false, false, false, true, true, true, true]);
  });

  // Onde cada canto da imagem guardada (u, v; v = 1 é a linha de cima) cai na
  // caixa de exibição x=10, y=20, w=100, h=50.
  const corner = (o: number, u: number, v: number) => {
    const [a, b, c, d, e, f] = orientationMatrix(o, 10, 20, 100, 50);
    return [a * u + c * v + e, b * u + d * v + f];
  };

  it("6 (girar 90° à direita): a linha de cima vai para a direita", () => {
    expect(corner(6, 0, 1)).toEqual([110, 70]); // topo-esquerda -> topo-direita
    expect(corner(6, 1, 1)).toEqual([110, 20]); // topo-direita -> baixo-direita
  });

  it("8 (girar 90° à esquerda): a linha de cima vai para a esquerda", () => {
    expect(corner(8, 0, 1)).toEqual([10, 20]);
    expect(corner(8, 1, 1)).toEqual([10, 70]);
  });

  it("1 e 3: normal e de cabeça para baixo", () => {
    expect(corner(1, 0, 1)).toEqual([10, 70]);
    expect(corner(3, 0, 1)).toEqual([110, 20]);
  });
});
