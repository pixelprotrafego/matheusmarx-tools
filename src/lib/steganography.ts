// Steganografia LSB com AES-GCM. 100% client-side.
// Formato do payload (bytes em ordem, escritos nos LSBs dos canais R/G/B):
//   [4] magic "MMSG"
//   [4] uint32 BE — tamanho total dos bytes a seguir (header curto + ciphertext)
//   [12] nonce AES-GCM
//   [16] salt PBKDF2
//   [1] tipo (0 = texto UTF-8, 1 = arquivo)
//   se tipo=1: [1] tamanho do nome + N bytes nome (UTF-8)
//   resto: ciphertext (inclui tag GCM)

const MAGIC = new Uint8Array([0x4d, 0x4d, 0x53, 0x47]); // "MMSG"
const PBKDF2_ITER = 200_000;

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey(
    "raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: toAB(salt), iterations: PBKDF2_ITER },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

// Garante um ArrayBuffer "puro" (não SharedArrayBuffer) — exigido pelos tipos do WebCrypto/DOM.
function toAB(u8: Uint8Array): ArrayBuffer {
  return u8.slice().buffer as ArrayBuffer;
}

export interface HiddenPayload {
  kind: "text" | "file";
  text?: string;
  fileName?: string;
  fileBytes?: Uint8Array;
}

export async function loadImageToCanvas(file: File): Promise<HTMLCanvasElement> {
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
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas indisponível");
    ctx.drawImage(img, 0, 0);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Bytes disponíveis para payload total (incluindo magic+len+nonce+salt+header+ct). */
export function capacityBytes(canvas: HTMLCanvasElement): number {
  // 3 bits utilizáveis por pixel (R,G,B), ignoramos alfa para não alterar transparência.
  const bits = canvas.width * canvas.height * 3;
  return Math.floor(bits / 8);
}

function buildPlain(payload: HiddenPayload): Uint8Array {
  if (payload.kind === "text") {
    const t = new TextEncoder().encode(payload.text ?? "");
    return concat(new Uint8Array([0]), t);
  }
  const nameBytes = new TextEncoder().encode(payload.fileName ?? "file.bin");
  if (nameBytes.length > 255) throw new Error("Nome de arquivo muito longo");
  return concat(
    new Uint8Array([1, nameBytes.length]),
    nameBytes,
    payload.fileBytes ?? new Uint8Array(),
  );
}

function parsePlain(plain: Uint8Array): HiddenPayload {
  if (plain.length < 1) throw new Error("Payload vazio");
  const t = plain[0];
  if (t === 0) {
    return { kind: "text", text: new TextDecoder().decode(plain.subarray(1)) };
  }
  if (t === 1) {
    if (plain.length < 2) throw new Error("Payload inválido");
    const nlen = plain[1];
    if (plain.length < 2 + nlen) throw new Error("Payload inválido");
    const fileName = new TextDecoder().decode(plain.subarray(2, 2 + nlen));
    const fileBytes = plain.subarray(2 + nlen).slice();
    return { kind: "file", fileName, fileBytes };
  }
  throw new Error("Tipo de payload desconhecido");
}

function writeBitsIntoImageData(img: ImageData, bytes: Uint8Array) {
  const data = img.data;
  const totalBits = bytes.length * 8;
  let bit = 0;
  for (let i = 0; i < data.length && bit < totalBits; i += 4) {
    for (let c = 0; c < 3 && bit < totalBits; c++) {
      const byteIdx = bit >> 3;
      const bitInByte = 7 - (bit & 7); // MSB first
      const v = (bytes[byteIdx] >> bitInByte) & 1;
      data[i + c] = (data[i + c] & 0xfe) | v;
      bit++;
    }
  }
}

function readBitsFromImageData(img: ImageData, byteCount: number): Uint8Array {
  const data = img.data;
  const totalBits = byteCount * 8;
  const out = new Uint8Array(byteCount);
  let bit = 0;
  for (let i = 0; i < data.length && bit < totalBits; i += 4) {
    for (let c = 0; c < 3 && bit < totalBits; c++) {
      const v = data[i + c] & 1;
      const byteIdx = bit >> 3;
      const bitInByte = 7 - (bit & 7);
      out[byteIdx] = (out[byteIdx] | (v << bitInByte)) & 0xff;
      bit++;
    }
  }
  return out;
}

export async function embed(
  canvas: HTMLCanvasElement,
  payload: HiddenPayload,
  password: string,
): Promise<Blob> {
  if (!password) throw new Error("Senha é obrigatória");
  const plain = buildPlain(payload);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const ctBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toAB(nonce) },
    key,
    toAB(plain),
  );
  const ct = new Uint8Array(ctBuf);

  const body = concat(nonce, salt, ct);
  const lenBuf = new Uint8Array(4);
  new DataView(lenBuf.buffer).setUint32(0, body.length, false);
  const full = concat(MAGIC, lenBuf, body);

  const cap = capacityBytes(canvas);
  if (full.length > cap) {
    throw new Error(`Dados (${full.length} B) excedem a capacidade da imagem (${cap} B)`);
  }

  const ctx = canvas.getContext("2d")!;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  writeBitsIntoImageData(img, full);
  ctx.putImageData(img, 0, 0);

  return await new Promise<Blob>((res, rej) => {
    canvas.toBlob((b) => (b ? res(b) : rej(new Error("Falha ao gerar PNG"))), "image/png");
  });
}

export async function extract(
  canvas: HTMLCanvasElement,
  password: string,
): Promise<HiddenPayload> {
  if (!password) throw new Error("Senha é obrigatória");
  const ctx = canvas.getContext("2d")!;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const header = readBitsFromImageData(img, 8);
  for (let i = 0; i < 4; i++) {
    if (header[i] !== MAGIC[i]) throw new Error("Esta imagem não contém uma mensagem oculta");
  }
  const bodyLen = new DataView(header.buffer).getUint32(4, false);
  const cap = capacityBytes(canvas);
  if (bodyLen <= 0 || bodyLen > cap - 8) throw new Error("Tamanho de payload inválido");
  const full = readBitsFromImageData(img, 8 + bodyLen);
  const body = full.subarray(8);
  const nonce = body.subarray(0, 12);
  const salt = body.subarray(12, 28);
  const ct = body.subarray(28);
  const key = await deriveKey(password, salt);
  let plainBuf: ArrayBuffer;
  try {
    plainBuf = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: toAB(nonce) },
      key,
      toAB(ct),
    );
  } catch {
    throw new Error("Senha incorreta ou imagem corrompida");
  }
  return parsePlain(new Uint8Array(plainBuf));
}