// Detecta e remove metadados de imagens e PDFs. 100% client-side.
import { PDFDocument } from "pdf-lib";

export interface MetaField {
  key: string;
  value: string;
  sensitive?: boolean;
}

export interface MetaScanResult {
  kind: "jpg" | "png" | "webp" | "heic" | "pdf" | "unknown";
  fields: MetaField[];
}

const SENSITIVE_RE =
  /(gps|location|latitude|longitude|author|creator|owner|artist|software|device|make|model|serial|copyright|user|computer)/i;

function mark(fields: MetaField[]): MetaField[] {
  return fields.map((f) => ({ ...f, sensitive: SENSITIVE_RE.test(f.key) }));
}

async function readBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

function detectKind(file: File, bytes: Uint8Array): MetaScanResult["kind"] {
  if (bytes.length >= 4) {
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return "jpg";
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
    if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "pdf";
    if (
      bytes.length >= 12 &&
      bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
    ) return "webp";
    if (
      bytes.length >= 12 &&
      bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70
    ) {
      const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
      if (["heic", "heix", "heim", "heis", "hevc", "hevm", "hevs", "mif1", "msf1"].includes(brand)) {
        return "heic";
      }
    }
  }
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  if (ext === "jpg" || ext === "jpeg") return "jpg";
  if (ext === "png") return "png";
  if (ext === "webp") return "webp";
  if (ext === "heic" || ext === "heif") return "heic";
  if (ext === "pdf") return "pdf";
  return "unknown";
}

// --- EXIF parsing (TIFF in APP1) ---------------------------------------------------

const EXIF_TAGS: Record<number, string> = {
  0x010f: "Make",
  0x0110: "Model",
  0x0112: "Orientation",
  0x011a: "XResolution",
  0x011b: "YResolution",
  0x0131: "Software",
  0x0132: "DateTime",
  0x013b: "Artist",
  0x8298: "Copyright",
  0x8769: "ExifIFDPointer",
  0x8825: "GPSIFDPointer",
  0x829a: "ExposureTime",
  0x829d: "FNumber",
  0x8822: "ExposureProgram",
  0x8827: "ISOSpeedRatings",
  0x9000: "ExifVersion",
  0x9003: "DateTimeOriginal",
  0x9004: "DateTimeDigitized",
  0x9201: "ShutterSpeedValue",
  0x9202: "ApertureValue",
  0x9204: "ExposureBiasValue",
  0x9207: "MeteringMode",
  0x9208: "LightSource",
  0x9209: "Flash",
  0x920a: "FocalLength",
  0xa002: "PixelXDimension",
  0xa003: "PixelYDimension",
  0xa402: "ExposureMode",
  0xa403: "WhiteBalance",
  0xa405: "FocalLengthIn35mmFilm",
  0xa406: "SceneCaptureType",
  0xa430: "OwnerName",
  0xa431: "BodySerialNumber",
  0xa432: "LensSpecification",
  0xa433: "LensMake",
  0xa434: "LensModel",
  0xa435: "LensSerialNumber",
};

const GPS_TAGS: Record<number, string> = {
  0x0000: "GPSVersionID",
  0x0001: "GPSLatitudeRef",
  0x0002: "GPSLatitude",
  0x0003: "GPSLongitudeRef",
  0x0004: "GPSLongitude",
  0x0005: "GPSAltitudeRef",
  0x0006: "GPSAltitude",
  0x0007: "GPSTimeStamp",
  0x0009: "GPSStatus",
  0x000c: "GPSSpeedRef",
  0x000d: "GPSSpeed",
  0x0010: "GPSImgDirectionRef",
  0x0011: "GPSImgDirection",
  0x001d: "GPSDateStamp",
};

function readIFD(view: DataView, base: number, ifdOffset: number, little: boolean, tagMap: Record<number, string>): { fields: MetaField[]; nextOffset: number; subIFDs: Record<string, number> } {
  const fields: MetaField[] = [];
  const subIFDs: Record<string, number> = {};
  if (ifdOffset + 2 > view.byteLength - base) return { fields, nextOffset: 0, subIFDs };
  const count = view.getUint16(base + ifdOffset, little);
  for (let i = 0; i < count; i++) {
    const entry = base + ifdOffset + 2 + i * 12;
    if (entry + 12 > view.byteLength) break;
    const tag = view.getUint16(entry, little);
    const type = view.getUint16(entry + 2, little);
    const cnt = view.getUint32(entry + 4, little);
    const valOffset = entry + 8;
    const name = tagMap[tag];
    if (!name) continue;
    let value = "";
    if (type === 2) {
      // ASCII
      const total = cnt;
      let dataPos = total <= 4 ? valOffset : base + view.getUint32(valOffset, little);
      if (dataPos + total > view.byteLength) continue;
      const arr = new Uint8Array(view.buffer, view.byteOffset + dataPos, total);
      value = new TextDecoder().decode(arr).replace(/\0+$/g, "").trim();
    } else if (type === 3) {
      value = String(view.getUint16(valOffset, little));
    } else if (type === 4) {
      const v = view.getUint32(valOffset, little);
      value = String(v);
      if (name === "ExifIFDPointer" || name === "GPSIFDPointer") subIFDs[name] = v;
    } else if (type === 5) {
      // RATIONAL (8 bytes each, stored at offset)
      const dataPos = base + view.getUint32(valOffset, little);
      const parts: string[] = [];
      for (let k = 0; k < Math.min(cnt, 3); k++) {
        const p = dataPos + k * 8;
        if (p + 8 > view.byteLength) break;
        const num = view.getUint32(p, little);
        const den = view.getUint32(p + 4, little);
        parts.push(den === 0 ? "0" : (num / den).toFixed(4));
      }
      value = parts.join(", ");
    } else {
      value = `(tipo ${type})`;
    }
    if (value) fields.push({ key: name, value });
  }
  const nextOffsetPos = base + ifdOffset + 2 + count * 12;
  const nextOffset = nextOffsetPos + 4 <= view.byteLength ? view.getUint32(nextOffsetPos, little) : 0;
  return { fields, nextOffset, subIFDs };
}

function parseTiff(tiff: Uint8Array): MetaField[] {
  if (tiff.length < 8) return [];
  const little = tiff[0] === 0x49 && tiff[1] === 0x49;
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  const magic = view.getUint16(2, little);
  if (magic !== 0x002a) return [];
  const ifd0Offset = view.getUint32(4, little);
  const out: MetaField[] = [];
  const ifd0 = readIFD(view, 0, ifd0Offset, little, EXIF_TAGS);
  out.push(...ifd0.fields);
  if (ifd0.subIFDs.ExifIFDPointer) {
    const r = readIFD(view, 0, ifd0.subIFDs.ExifIFDPointer, little, EXIF_TAGS);
    out.push(...r.fields);
  }
  if (ifd0.subIFDs.GPSIFDPointer) {
    const r = readIFD(view, 0, ifd0.subIFDs.GPSIFDPointer, little, GPS_TAGS);
    out.push(...r.fields);
    // GPS legível em graus decimais
    const get = (k: string) => r.fields.find((f) => f.key === k)?.value;
    const lat = get("GPSLatitude");
    const latRef = get("GPSLatitudeRef");
    const lon = get("GPSLongitude");
    const lonRef = get("GPSLongitudeRef");
    const toDec = (s?: string, ref?: string) => {
      if (!s) return null;
      const parts = s.split(",").map((x) => parseFloat(x.trim()));
      if (parts.length < 1 || parts.some((n) => Number.isNaN(n))) return null;
      const [d = 0, m = 0, sec = 0] = parts;
      let v = d + m / 60 + sec / 3600;
      if (ref === "S" || ref === "W") v = -v;
      return v;
    };
    const dlat = toDec(lat, latRef);
    const dlon = toDec(lon, lonRef);
    if (dlat !== null && dlon !== null) {
      out.push({ key: "GPS", value: `${dlat.toFixed(5)}, ${dlon.toFixed(5)}` });
    }
  }
  return out;
}

function parseExifSegment(seg: Uint8Array): MetaField[] {
  // seg starts at "Exif\0\0" + TIFF
  if (seg.length < 14) return [];
  if (!(seg[0] === 0x45 && seg[1] === 0x78 && seg[2] === 0x69 && seg[3] === 0x66)) return [];
  return parseTiff(seg.subarray(6));
}

function scanJpg(bytes: Uint8Array): MetaField[] {
  const fields: MetaField[] = [];
  let i = 2; // skip SOI
  while (i < bytes.length - 1) {
    if (bytes[i] !== 0xff) break;
    const marker = bytes[i + 1];
    if (marker === 0xd8 || marker === 0xd9) { i += 2; continue; }
    if (marker === 0xda) break; // SOS — começam dados de imagem
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    const seg = bytes.subarray(i + 4, i + 2 + len);
    if (marker === 0xe1) {
      // APP1 — pode ser EXIF ou XMP
      const head = new TextDecoder().decode(seg.subarray(0, Math.min(seg.length, 20)));
      if (head.startsWith("Exif")) {
        fields.push(...parseExifSegment(seg));
      } else if (head.startsWith("http://ns.adobe.com/xap")) {
        const xmp = new TextDecoder().decode(seg);
        const m = xmp.match(/<dc:creator>[\s\S]*?<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/);
        if (m) fields.push({ key: "XMP:Creator", value: m[1].trim() });
        const t = xmp.match(/<dc:title>[\s\S]*?<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/);
        if (t) fields.push({ key: "XMP:Title", value: t[1].trim() });
        fields.push({ key: "XMP", value: `(${seg.length} bytes de metadados XMP)` });
      }
    } else if (marker === 0xfe) {
      // COM — comentário
      const c = new TextDecoder().decode(seg).trim();
      if (c) fields.push({ key: "Comment", value: c });
    }
    i += 2 + len;
  }
  return fields;
}

function scanPng(bytes: Uint8Array): MetaField[] {
  const fields: MetaField[] = [];
  let i = 8; // skip signature
  while (i < bytes.length - 8) {
    const len =
      (bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3];
    const type = new TextDecoder().decode(bytes.subarray(i + 4, i + 8));
    const data = bytes.subarray(i + 8, i + 8 + len);
    if (type === "tEXt" || type === "iTXt" || type === "zTXt") {
      const nul = data.indexOf(0);
      const key = new TextDecoder().decode(data.subarray(0, nul >= 0 ? nul : data.length));
      const value =
        type === "tEXt"
          ? new TextDecoder().decode(data.subarray(nul + 1))
          : `(${data.length} bytes, ${type})`;
      fields.push({ key, value: value.slice(0, 200) });
    } else if (type === "tIME") {
      if (data.length === 7) {
        const y = (data[0] << 8) | data[1];
        fields.push({ key: "tIME", value: `${y}-${data[2]}-${data[3]} ${data[4]}:${data[5]}:${data[6]}` });
      }
    } else if (type === "eXIf") {
      const exif = parseTiff(data);
      if (exif.length) fields.push(...exif);
      else fields.push({ key: "eXIf", value: `(${data.length} bytes de EXIF embutido)` });
    }
    if (type === "IEND") break;
    i += 12 + len; // length + type + data + crc
  }
  return fields;
}

function scanWebp(bytes: Uint8Array): MetaField[] {
  const fields: MetaField[] = [];
  let i = 12;
  while (i < bytes.length - 8) {
    const fourcc = new TextDecoder().decode(bytes.subarray(i, i + 4));
    const size = bytes[i + 4] | (bytes[i + 5] << 8) | (bytes[i + 6] << 16) | (bytes[i + 7] << 24);
    if (fourcc === "EXIF") fields.push({ key: "EXIF", value: `(${size} bytes embutidos)` });
    if (fourcc === "XMP ") fields.push({ key: "XMP", value: `(${size} bytes embutidos)` });
    i += 8 + size + (size & 1);
  }
  return fields;
}

async function scanPdf(bytes: Uint8Array): Promise<MetaField[]> {
  const fields: MetaField[] = [];
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    const add = (k: string, v: string | Date | undefined) => {
      if (!v) return;
      const s = v instanceof Date ? v.toISOString() : String(v);
      if (s.trim()) fields.push({ key: k, value: s });
    };
    add("Title", doc.getTitle());
    add("Author", doc.getAuthor());
    add("Subject", doc.getSubject());
    add("Keywords", doc.getKeywords());
    add("Producer", doc.getProducer());
    add("Creator", doc.getCreator());
    add("CreationDate", doc.getCreationDate());
    add("ModificationDate", doc.getModificationDate());
    fields.push({ key: "PageCount", value: String(doc.getPageCount()) });
    fields.push({ key: "FileSize", value: `${(bytes.length / 1024).toFixed(1)} KB` });
  } catch {
    // ignore
  }
  return fields;
}

// --- HEIC (ISO BMFF) EXIF extraction ----------------------------------------------

function readBoxes(bytes: Uint8Array, start: number, end: number): { type: string; payload: Uint8Array }[] {
  const out: { type: string; payload: Uint8Array }[] = [];
  let i = start;
  while (i + 8 <= end) {
    let size =
      (bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3];
    const type = String.fromCharCode(bytes[i + 4], bytes[i + 5], bytes[i + 6], bytes[i + 7]);
    let headerSize = 8;
    if (size === 1) {
      // 64-bit largesize — pula campo alto (assume <4GB)
      if (i + 16 > end) break;
      size =
        (bytes[i + 12] << 24) | (bytes[i + 13] << 16) | (bytes[i + 14] << 8) | bytes[i + 15];
      headerSize = 16;
    } else if (size === 0) {
      size = end - i;
    }
    if (size < headerSize || i + size > end) break;
    out.push({ type, payload: bytes.subarray(i + headerSize, i + size) });
    i += size;
  }
  return out;
}

function findExifItem(meta: Uint8Array, bytes: Uint8Array): Uint8Array | null {
  // meta é FullBox: pula 4 bytes (version+flags) e lê children.
  if (meta.length < 4) return null;
  const children = readBoxes(meta, 4, meta.length);
  const iinf = children.find((b) => b.type === "iinf");
  const iloc = children.find((b) => b.type === "iloc");
  if (!iinf || !iloc) return null;

  // ---- iinf: encontrar item_id cujo item_type === "Exif" ----
  const ip = iinf;
  const iinfVersion = ip.payload[0];
  let p = 4; // pula version+flags
  const entryCount =
    iinfVersion === 0
      ? (ip.payload[p] << 8) | ip.payload[p + 1]
      : (ip.payload[p] << 24) |
        (ip.payload[p + 1] << 16) |
        (ip.payload[p + 2] << 8) |
        ip.payload[p + 3];
  p += iinfVersion === 0 ? 2 : 4;
  let exifItemId: number | null = null;
  const infes = readBoxes(ip.payload, p, ip.payload.length);
  for (let k = 0; k < Math.min(entryCount, infes.length); k++) {
    const infe = infes[k];
    if (infe.type !== "infe") continue;
    const ver = infe.payload[0];
    if (ver < 2) continue;
    // v2: item_ID(2) + protection(2) + item_type(4)
    // v3: item_ID(4) + protection(2) + item_type(4)
    let pos = 4;
    let itemId: number;
    if (ver === 2) {
      itemId = (infe.payload[pos] << 8) | infe.payload[pos + 1];
      pos += 2;
    } else {
      itemId =
        (infe.payload[pos] << 24) |
        (infe.payload[pos + 1] << 16) |
        (infe.payload[pos + 2] << 8) |
        infe.payload[pos + 3];
      pos += 4;
    }
    pos += 2; // protection_index
    const itemType = String.fromCharCode(
      infe.payload[pos],
      infe.payload[pos + 1],
      infe.payload[pos + 2],
      infe.payload[pos + 3],
    );
    if (itemType === "Exif") {
      exifItemId = itemId;
      break;
    }
  }
  if (exifItemId === null) return null;

  // ---- iloc: encontrar offset/length do item ----
  const lp = iloc.payload;
  const ilocVersion = lp[0];
  let q = 4;
  const offsetSize = (lp[q] >> 4) & 0x0f;
  const lengthSize = lp[q] & 0x0f;
  const baseOffsetSize = (lp[q + 1] >> 4) & 0x0f;
  const indexSize = ilocVersion >= 1 ? lp[q + 1] & 0x0f : 0;
  q += 2;
  const itemCount =
    ilocVersion < 2
      ? (lp[q] << 8) | lp[q + 1]
      : (lp[q] << 24) | (lp[q + 1] << 16) | (lp[q + 2] << 8) | lp[q + 3];
  q += ilocVersion < 2 ? 2 : 4;

  const readN = (n: number): number => {
    let v = 0;
    for (let b = 0; b < n; b++) v = v * 256 + lp[q + b];
    q += n;
    return v;
  };

  for (let k = 0; k < itemCount; k++) {
    const itemId =
      ilocVersion < 2
        ? (lp[q] << 8) | lp[q + 1]
        : (lp[q] << 24) | (lp[q + 1] << 16) | (lp[q + 2] << 8) | lp[q + 3];
    q += ilocVersion < 2 ? 2 : 4;
    if (ilocVersion === 1 || ilocVersion === 2) q += 2; // construction_method
    q += 2; // data_reference_index
    const baseOffset = readN(baseOffsetSize);
    const extentCount = (lp[q] << 8) | lp[q + 1];
    q += 2;
    let firstOffset = 0;
    let totalLen = 0;
    for (let e = 0; e < extentCount; e++) {
      if ((ilocVersion === 1 || ilocVersion === 2) && indexSize > 0) q += indexSize;
      const extOffset = readN(offsetSize);
      const extLen = readN(lengthSize);
      if (e === 0) firstOffset = extOffset;
      totalLen += extLen;
    }
    if (itemId === exifItemId) {
      const start = baseOffset + firstOffset;
      if (start + totalLen > bytes.length) return null;
      return bytes.subarray(start, start + totalLen);
    }
  }
  return null;
}

function scanHeic(bytes: Uint8Array): MetaField[] {
  const fields: MetaField[] = [{ key: "Format", value: "HEIC/HEIF (container ISO BMFF)" }];
  try {
    const top = readBoxes(bytes, 0, bytes.length);
    const meta = top.find((b) => b.type === "meta");
    if (!meta) return fields;
    const item = findExifItem(meta.payload, bytes);
    if (!item || item.length < 4) return fields;
    // Os primeiros 4 bytes são o offset do TIFF dentro do payload (geralmente 0).
    const tiffOffset =
      (item[0] << 24) | (item[1] << 16) | (item[2] << 8) | item[3];
    const tiff = item.subarray(4 + tiffOffset);
    fields.push(...parseTiff(tiff));
  } catch {
    // mantém só o Format
  }
  return fields;
}

export async function scanMetadata(file: File): Promise<MetaScanResult> {
  const bytes = await readBytes(file);
  const kind = detectKind(file, bytes);
  let fields: MetaField[] = [];
  if (kind === "jpg") fields = scanJpg(bytes);
  else if (kind === "png") fields = scanPng(bytes);
  else if (kind === "webp") fields = scanWebp(bytes);
  else if (kind === "heic") fields = scanHeic(bytes);
  else if (kind === "pdf") fields = await scanPdf(bytes);
  if (kind !== "unknown" && fields.length === 0) {
    fields = [{ key: "Status", value: "Sem metadados detectados" }];
  }
  return { kind, fields: mark(fields) };
}

// --- Scrubbing ---------------------------------------------------------------------

async function scrubImageViaCanvas(file: File, mime: string): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("Imagem inválida"));
      i.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    return await new Promise<Blob>((res, rej) => {
      canvas.toBlob(
        (b) => (b ? res(b) : rej(new Error("Falha ao gerar imagem"))),
        mime,
        mime === "image/jpeg" ? 0.95 : undefined,
      );
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function scrubPdf(file: File): Promise<Blob> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const doc = await PDFDocument.load(bytes);
  doc.setTitle("");
  doc.setAuthor("");
  doc.setSubject("");
  doc.setKeywords([]);
  doc.setProducer("");
  doc.setCreator("");
  // Re-zera datas em uma referência fixa e neutra.
  const epoch = new Date(0);
  doc.setCreationDate(epoch);
  doc.setModificationDate(epoch);
  const out = await doc.save({ useObjectStreams: true });
  return new Blob([out.slice().buffer], { type: "application/pdf" });
}

async function scrubHeic(file: File): Promise<Blob> {
  return scrubHeicAs(file, "jpg");
}

async function scrubHeicAs(file: File, format: "jpg" | "png"): Promise<Blob> {
  const toType = format === "png" ? "image/png" : "image/jpeg";
  try {
    const mod = await import("heic2any");
    const heic2any = (mod as { default: (opts: { blob: Blob; toType?: string; quality?: number }) => Promise<Blob | Blob[]> }).default;
    const out = await heic2any(
      format === "png"
        ? { blob: file, toType }
        : { blob: file, toType, quality: 0.95 },
    );
    const blob = Array.isArray(out) ? out[0] : out;
    // heic2any já gera um arquivo recém-codificado sem EXIF da câmera.
    // Garantir o MIME correto no Blob final.
    return blob.type === toType ? blob : new Blob([await blob.arrayBuffer()], { type: toType });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `Falha ao decodificar HEIC: ${msg}. O arquivo pode estar corrompido ou usar um codec não suportado.`,
    );
  }
}

export async function scrubMetadata(
  file: File,
  kind: MetaScanResult["kind"],
  outputFormat: "jpg" | "png" = "jpg",
): Promise<Blob> {
  switch (kind) {
    case "jpg":
      return scrubImageViaCanvas(file, "image/jpeg");
    case "png":
      return scrubImageViaCanvas(file, "image/png");
    case "webp":
      return scrubImageViaCanvas(file, "image/webp");
    case "heic":
      return scrubHeicAs(file, outputFormat);
    case "pdf":
      return scrubPdf(file);
    default:
      throw new Error("Formato não suportado para limpeza");
  }
}