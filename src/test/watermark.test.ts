import { describe, expect, it } from "vitest";
import { watermarkPlacement } from "@/lib/watermark";

/** Centro do texto já girado, a partir da origem e do ângulo devolvidos. */
function centerOf(p: { x: number; y: number; size: number; rotate: number }, unitWidth: number, unitCap: number) {
  const rad = (p.rotate * Math.PI) / 180;
  const cx = (unitWidth * p.size) / 2;
  const cy = (unitCap * p.size) / 2;
  return { x: p.x + cx * Math.cos(rad) - cy * Math.sin(rad), y: p.y + cx * Math.sin(rad) + cy * Math.cos(rad) };
}

const A4 = { pageWidth: 595, pageHeight: 842 };
const TEXT = { unitWidth: 7.6, unitCapHeight: 0.718 }; // "CONFIDENCIAL" em Helvetica Bold

describe("watermarkPlacement", () => {
  it.each([0, 30, 45, 90])("centraliza o texto girado a %i°", (angle) => {
    const p = watermarkPlacement({ ...A4, pageRotation: 0, angle, ...TEXT });
    const c = centerOf(p, TEXT.unitWidth, TEXT.unitCapHeight);
    expect(c.x).toBeCloseTo(595 / 2, 6);
    expect(c.y).toBeCloseTo(842 / 2, 6);
  });

  it("compensa a rotação da página para a marca aparecer no ângulo pedido", () => {
    const p = watermarkPlacement({ ...A4, pageRotation: 90, angle: 45, ...TEXT });
    expect(p.rotate).toBe(135);
    const c = centerOf(p, TEXT.unitWidth, TEXT.unitCapHeight);
    expect(c.x).toBeCloseTo(595 / 2, 6);
    expect(c.y).toBeCloseTo(842 / 2, 6);
  });

  it("encolhe texto longo para caber na página", () => {
    const longo = { unitWidth: 40, unitCapHeight: 0.718 };
    const p = watermarkPlacement({ ...A4, pageRotation: 0, angle: 0, ...longo });
    expect(longo.unitWidth * p.size).toBeLessThanOrEqual(595 * 0.85 + 1e-9);
  });

  it("não passa do teto de corpo em texto curto", () => {
    const p = watermarkPlacement({ ...A4, pageRotation: 0, angle: 45, unitWidth: 1, unitCapHeight: 0.718 });
    expect(p.size).toBeCloseTo(595 * 0.12, 6);
  });
});
