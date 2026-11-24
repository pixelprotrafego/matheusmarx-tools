/**
 * Posição da marca d'água na página.
 *
 * O `drawText` do pdf-lib gira o texto em torno do ponto de origem, que é o
 * canto inferior esquerdo da primeira letra — e não em torno do centro. A
 * versão anterior centralizava o texto deitado e depois girava: a 45° a marca
 * escorregava para cima e para a direita, longe do centro da página. Aqui a
 * origem é calculada para que o centro do texto **já girado** caia no centro.
 */

export interface WatermarkInput {
  pageWidth: number;
  pageHeight: number;
  /** `/Rotate` da página, em graus (0, 90, 180 ou 270). */
  pageRotation: number;
  /** Ângulo pedido, em graus, anti-horário, como a pessoa vê a página. */
  angle: number;
  /** Largura do texto no corpo 1. */
  unitWidth: number;
  /** Altura das maiúsculas no corpo 1. */
  unitCapHeight: number;
  /** Fração da página que o texto pode ocupar. */
  fill?: number;
  /** Teto do corpo, como fração do menor lado da página. */
  maxSizeRatio?: number;
}

export interface WatermarkPlacement {
  x: number;
  y: number;
  size: number;
  /** Ângulo a passar ao `drawText`, já somada a rotação da página. */
  rotate: number;
}

export function watermarkPlacement(input: WatermarkInput): WatermarkPlacement {
  const { pageWidth: w, pageHeight: h, unitWidth, unitCapHeight } = input;
  const fill = input.fill ?? 0.85;
  const maxSize = Math.min(w, h) * (input.maxSizeRatio ?? 0.12);

  // A página com `/Rotate` aparece girada no sentido horário para quem lê.
  // Desenhar no ângulo pedido mais essa rotação faz a marca aparecer no
  // ângulo pedido; sem isso, numa página deitada ela sai de lado.
  const rotate = (((input.angle + input.pageRotation) % 360) + 360) % 360;
  const rad = (rotate * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  // Caixa do texto girado, no corpo 1, para caber na página.
  const boxW = unitWidth * Math.abs(cos) + unitCapHeight * Math.abs(sin);
  const boxH = unitWidth * Math.abs(sin) + unitCapHeight * Math.abs(cos);
  const size = Math.max(1, Math.min(maxSize, (w * fill) / (boxW || 1), (h * fill) / (boxH || 1)));

  // Centro do texto em relação à origem, antes de girar…
  const cx = (unitWidth * size) / 2;
  const cy = (unitCapHeight * size) / 2;
  // …e depois de girar, pela mesma rotação que o PDF vai aplicar.
  const rx = cx * cos - cy * sin;
  const ry = cx * sin + cy * cos;

  return { x: w / 2 - rx, y: h / 2 - ry, size, rotate };
}
