/**
 * Notas de rodapé.
 *
 * No PDF, a nota é só texto pequeno no pé da página, abaixo de um filete
 * curto, começando com o mesmo número que aparece elevado no corpo. Tratada
 * como texto comum, ela virava um parágrafo solto no meio do documento — e,
 * sem caber no pé da página do Word, empurrava uma página inteira só para ela.
 *
 * Aqui ela só vira nota do Word com as três provas juntas: o filete, a linha
 * que começa com o marcador e o mesmo marcador elevado no corpo da página. O
 * que não fecha as três continua como estava, porque transformar em nota um
 * texto que não era nota seria pior do que deixar uma nota como texto.
 */

import type { TextLine } from "./lines";
import type { RuleSegment } from "./types";

export interface Footnote {
  id: number;
  /** Linhas da nota, já sem o marcador do começo. */
  lines: TextLine[];
}

const MARKER = /^(\d{1,3}|[*†‡§])/;

/** Tira o marcador do começo da primeira linha da nota. */
function stripMarker(line: TextLine, marker: string): TextLine {
  const runs = line.runs.map((r) => ({ ...r }));
  let rest = marker;
  while (runs.length && rest) {
    const text = runs[0].text.replace(/^\s+/, "");
    if (text.startsWith(rest)) {
      runs[0] = { ...runs[0], text: text.slice(rest.length).replace(/^\s+/, "") };
      rest = "";
      if (!runs[0].text) runs.shift();
    } else if (rest.startsWith(text)) {
      rest = rest.slice(text.length);
      runs.shift();
    } else {
      break;
    }
  }
  return { ...line, runs, text: runs.map((r) => r.text).join("") };
}

/**
 * Separa as notas de rodapé de uma página. Devolve o corpo sem elas, com o
 * número elevado de cada uma marcado como referência (`footnote` no trecho), e
 * as notas na ordem em que aparecem.
 */
export function extractFootnotes(
  body: TextLine[],
  rules: RuleSegment[],
  box: { left: number; right: number },
  pageHeight: number,
  nextId: () => number,
): { body: TextLine[]; notes: Footnote[] } {
  const width = box.right - box.left;
  const separators = rules
    .filter(
      (r) =>
        r.axis === "h" &&
        r.thickness <= 1.5 &&
        r.position > pageHeight * 0.45 &&
        Math.abs(r.from - box.left) <= 14 &&
        r.to - r.from >= width * 0.1 &&
        r.to - r.from <= width * 0.55,
    )
    .sort((a, b) => b.position - a.position);

  for (const separator of separators) {
    const below = body
      .filter((l) => l.top >= separator.position - 1)
      .sort((a, b) => a.baseline - b.baseline);
    const above = body.filter((l) => l.bottom <= separator.position + 1);
    if (!below.length || !above.length) continue;

    // Agrupa as linhas de baixo em notas: cada uma começa com um marcador.
    const groups: { marker: string; lines: TextLine[] }[] = [];
    for (const line of below) {
      const first = line.runs.find((r) => r.text.trim());
      const m = first ? MARKER.exec(first.text.trim()) : null;
      const looksLikeMarker =
        m !== null && first !== undefined &&
        (first.vertical === "superscript" || first.text.trim() === m[1] || first.style.size < line.fontSize * 0.9 || /^\S+\s/.test(first.text.trim()));
      if (m && looksLikeMarker) groups.push({ marker: m[1], lines: [line] });
      else if (groups.length) groups[groups.length - 1].lines.push(line);
      else break;
    }
    if (!groups.length || groups.reduce((n, g) => n + g.lines.length, 0) !== below.length) continue;

    // Cada nota precisa do mesmo marcador elevado em algum lugar do corpo.
    const notes: Footnote[] = [];
    const taken = new Set<TextLine>();
    for (const group of groups) {
      let reference: { line: TextLine; run: number } | null = null;
      for (const line of above) {
        const index = line.runs.findIndex(
          (r) => r.vertical === "superscript" && r.footnote === undefined && r.text.trim() === group.marker,
        );
        if (index >= 0) {
          reference = { line, run: index };
          break;
        }
      }
      if (!reference) continue;
      const id = nextId();
      reference.line.runs[reference.run] = { ...reference.line.runs[reference.run], footnote: id };
      group.lines.forEach((l) => taken.add(l));
      notes.push({ id, lines: [stripMarker(group.lines[0], group.marker), ...group.lines.slice(1)] });
    }
    if (!notes.length) continue;
    return { body: body.filter((l) => !taken.has(l)), notes };
  }
  return { body, notes: [] };
}
