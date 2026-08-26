// Validação básica de arquivos por tamanho e "magic bytes".
// Defesa em profundidade — extensão pode mentir.

export const SIZE_LIMITS = {
  pdf: 200 * 1024 * 1024,
  video: 2 * 1024 * 1024 * 1024,
  audio: 500 * 1024 * 1024,
  image: 50 * 1024 * 1024,
  text: 50 * 1024 * 1024,
} as const;

export type SizeKind = keyof typeof SIZE_LIMITS;

export function checkSize(file: File, kind: SizeKind): string | null {
  const max = SIZE_LIMITS[kind];
  if (file.size > max) {
    const mb = (max / (1024 * 1024)).toFixed(0);
    return `Arquivo excede o limite de ${mb} MB para ${kind}.`;
  }
  return null;
}

// Limites de batch (quantidade) e timeout máximo por operação.
// Defesa contra "drop 500 imagens de uma vez" e operações travadas.
export const BATCH_LIMITS = {
  imagesPerBatch: 30,
  pdfsPerMerge: 50,
  videosPerJoin: 10,
} as const;

export const OP_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutos

export function checkBatch(count: number, max: number, label = "arquivos"): string | null {
  if (count > max) {
    return `Máximo de ${max} ${label} por operação. Você selecionou ${count}.`;
  }
  return null;
}

/**
 * Aborta uma Promise após `ms` milissegundos.
 * NÃO cancela o trabalho subjacente (canvas/wasm continuam rodando),
 * mas libera a UI e impede que o usuário fique preso sem feedback.
 */
export function withTimeout<T>(p: Promise<T>, ms = OP_TIMEOUT_MS, label = "Operação"): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      reject(new Error(`${label} excedeu ${Math.round(ms / 60000)} min e foi interrompida.`));
    }, ms);
    p.then((v) => { clearTimeout(t); resolve(v); },
           (e) => { clearTimeout(t); reject(e); });
  });
}

export function sanitizeFilename(name: string): string {
  // Bloqueia path traversal e caracteres perigosos.
  return name.replace(/[/\\]/g, "_").replace(/\.\./g, "_").slice(0, 200);
}

const MAGIC: Record<string, number[][]> = {
  pdf: [[0x25, 0x50, 0x44, 0x46]], // %PDF
  png: [[0x89, 0x50, 0x4e, 0x47]],
  jpg: [[0xff, 0xd8, 0xff]],
  gif: [[0x47, 0x49, 0x46, 0x38]],
  webp: [[0x52, 0x49, 0x46, 0x46]], // RIFF (também WAV/AVI)
  zip: [[0x50, 0x4b, 0x03, 0x04]], // DOCX/XLSX/ZIP
};

export async function readMagic(file: File, bytes = 8): Promise<Uint8Array> {
  const buf = await file.slice(0, bytes).arrayBuffer();
  return new Uint8Array(buf);
}

export async function looksLike(file: File, kind: keyof typeof MAGIC): Promise<boolean> {
  const head = await readMagic(file);
  return MAGIC[kind].some((sig) => sig.every((b, i) => head[i] === b));
}