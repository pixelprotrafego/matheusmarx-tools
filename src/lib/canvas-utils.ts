export async function fileToImage(file: File | Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error("Falha ao carregar imagem"));
      img.src = url;
    });
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

export function drawToCanvas(
  img: HTMLImageElement | ImageBitmap,
  width?: number,
  height?: number,
  background?: string
): HTMLCanvasElement {
  const w = width ?? (img as HTMLImageElement).naturalWidth ?? img.width;
  const h = height ?? (img as HTMLImageElement).naturalHeight ?? img.height;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.drawImage(img as CanvasImageSource, 0, 0, w, h);
  return canvas;
}

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number
): Promise<Blob> {
  return new Promise((res, rej) => {
    canvas.toBlob(
      (b) => (b ? res(b) : rej(new Error(`Falha ao gerar ${type}`))),
      type,
      quality
    );
  });
}

export async function supportsImageType(type: string): Promise<boolean> {
  try {
    const c = document.createElement("canvas");
    c.width = 1;
    c.height = 1;
    const b = await new Promise<Blob | null>((res) => c.toBlob(res, type, 0.5));
    return !!b && b.type === type;
  } catch {
    return false;
  }
}