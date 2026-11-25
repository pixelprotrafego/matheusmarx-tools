/**
 * Gravação de .xlsx com aparência (negrito, cor, fundo, bordas, formato de
 * número, mesclagem, largura de coluna).
 *
 * A edição livre do SheetJS grava valores mas não estilos; aqui o pacote é
 * montado direto, com o mínimo que o Excel, o LibreOffice e o Google Planilhas
 * aceitam.
 */

export interface WStyle {
  bold?: boolean;
  italic?: boolean;
  /** Corpo em pontos (padrão 11). */
  size?: number;
  /** "#RRGGBB" */
  color?: string;
  fill?: string;
  /** Borda fina nos quatro lados. */
  border?: boolean;
  /** Código de formato em inglês ("#,##0.00", "dd/mm/yyyy"). */
  numFmt?: string;
  wrap?: boolean;
  align?: "left" | "center" | "right";
  vertical?: "top" | "center" | "bottom";
}

export interface WCell {
  value: string | number | boolean | null;
  style?: WStyle;
}

export interface WSheet {
  name: string;
  /** Linhas de células; `null` ou ausente = célula vazia. */
  rows: (WCell | null | undefined)[][];
  /** Larguras em caracteres (a unidade do Excel). */
  colWidths?: number[];
  merges?: { r1: number; c1: number; r2: number; c2: number }[];
}

const esc = (s: string) =>
  s
    // Caracteres de controle não são permitidos em XML 1.0 (removê-los é o objetivo).
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export function columnLetter(c: number): string {
  let s = "";
  let n = c + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Nome de planilha válido e único (até 31 caracteres, sem []:*?/\). */
export function sheetNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((raw) => {
    let base = raw.replace(/[[\]:*?/\\]/g, " ").replace(/^'+|'+$/g, "").trim().slice(0, 31) || "Planilha";
    let name = base;
    for (let k = 2; used.has(name.toLowerCase()); k++) {
      const suffix = ` (${k})`;
      name = base.slice(0, 31 - suffix.length) + suffix;
    }
    used.add(name.toLowerCase());
    base = name;
    return base;
  });
}

const BUILTIN: Record<string, number> = { General: 0, "0": 1, "0.00": 2, "#,##0": 3, "#,##0.00": 4, "0%": 9, "0.00%": 10 };

export async function writeXlsx(sheets: WSheet[]): Promise<Uint8Array> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();

  // Estilos, sem repetição.
  const fonts = ['<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>'];
  const fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
  const borders = ["<border><left/><right/><top/><bottom/><diagonal/></border>"];
  const numFmts: string[] = [];
  const xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  const xfIndex = new Map<string, number>([["", 0]]);
  const indexIn = (list: string[], xml: string) => {
    const i = list.indexOf(xml);
    if (i >= 0) return i;
    list.push(xml);
    return list.length - 1;
  };
  const fmtIds = new Map<string, number>();
  const styleId = (s: WStyle | undefined): number => {
    if (!s) return 0;
    const key = JSON.stringify(s);
    const hit = xfIndex.get(key);
    if (hit !== undefined) return hit;
    const font = `<font>${s.bold ? "<b/>" : ""}${s.italic ? "<i/>" : ""}<sz val="${s.size ?? 11}"/>${
      s.color ? `<color rgb="FF${s.color.slice(1).toUpperCase()}"/>` : ""
    }<name val="Calibri"/><family val="2"/></font>`;
    const fontId = indexIn(fonts, font);
    const fillId = s.fill
      ? indexIn(fills, `<fill><patternFill patternType="solid"><fgColor rgb="FF${s.fill.slice(1).toUpperCase()}"/><bgColor indexed="64"/></patternFill></fill>`)
      : 0;
    const borderId = s.border
      ? indexIn(borders, '<border><left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right><top style="thin"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom><diagonal/></border>')
      : 0;
    let numFmtId = 0;
    if (s.numFmt) {
      if (BUILTIN[s.numFmt] !== undefined) numFmtId = BUILTIN[s.numFmt];
      else {
        numFmtId = fmtIds.get(s.numFmt) ?? 164 + fmtIds.size;
        if (!fmtIds.has(s.numFmt)) {
          fmtIds.set(s.numFmt, numFmtId);
          numFmts.push(`<numFmt numFmtId="${numFmtId}" formatCode="${esc(s.numFmt)}"/>`);
        }
      }
    }
    const align = s.wrap || s.align || s.vertical
      ? `<alignment${s.align ? ` horizontal="${s.align}"` : ""}${s.vertical ? ` vertical="${s.vertical}"` : ""}${s.wrap ? ' wrapText="1"' : ""}/>`
      : "";
    const xf = `<xf numFmtId="${numFmtId}" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0"${
      numFmtId ? ' applyNumberFormat="1"' : ""}${fontId ? ' applyFont="1"' : ""}${fillId ? ' applyFill="1"' : ""}${
      borderId ? ' applyBorder="1"' : ""}${align ? ' applyAlignment="1">' + align + "</xf>" : "/>"}`;
    xfs.push(xf);
    xfIndex.set(key, xfs.length - 1);
    return xfs.length - 1;
  };

  const names = sheetNames(sheets.map((s) => s.name));
  sheets.forEach((sheet, i) => {
    const rowsXml: string[] = [];
    sheet.rows.forEach((row, r) => {
      const cells: string[] = [];
      row.forEach((cell, c) => {
        if (!cell || (cell.value === null && !cell.style)) return;
        const ref = `${columnLetter(c)}${r + 1}`;
        const s = styleId(cell.style);
        const sAttr = s ? ` s="${s}"` : "";
        const v = cell.value;
        if (v === null || v === "") cells.push(`<c r="${ref}"${sAttr}/>`);
        else if (typeof v === "number" && Number.isFinite(v)) cells.push(`<c r="${ref}"${sAttr}><v>${v}</v></c>`);
        else if (typeof v === "boolean") cells.push(`<c r="${ref}"${sAttr} t="b"><v>${v ? 1 : 0}</v></c>`);
        else cells.push(`<c r="${ref}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`);
      });
      if (cells.length) rowsXml.push(`<row r="${r + 1}">${cells.join("")}</row>`);
    });
    const cols = sheet.colWidths?.length
      ? `<cols>${sheet.colWidths.map((w, c) => `<col min="${c + 1}" max="${c + 1}" width="${Math.round(w * 100) / 100}" customWidth="1"/>`).join("")}</cols>`
      : "";
    const merges = sheet.merges?.length
      ? `<mergeCells count="${sheet.merges.length}">${sheet.merges
          .map((m) => `<mergeCell ref="${columnLetter(m.c1)}${m.r1 + 1}:${columnLetter(m.c2)}${m.r2 + 1}"/>`)
          .join("")}</mergeCells>`
      : "";
    zip.file(
      `xl/worksheets/sheet${i + 1}.xml`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${
        i === 0 ? '<sheetViews><sheetView workbookViewId="0" tabSelected="1"/></sheetViews>' : ""
      }<sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${rowsXml.join("")}</sheetData>${merges}<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>`,
    );
  });

  zip.file(
    "xl/styles.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${
      numFmts.length ? `<numFmts count="${numFmts.length}">${numFmts.join("")}</numFmts>` : ""
    }<fonts count="${fonts.length}">${fonts.join("")}</fonts><fills count="${fills.length}">${fills.join("")}</fills><borders count="${borders.length}">${borders.join(
      "",
    )}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join(
      "",
    )}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
  );
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names
      .map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join("")}</sheets></workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names
      .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
      .join("")}<Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
  );
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${names
      .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
      .join("")}</Types>`,
  );
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
