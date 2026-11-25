/**
 * Leitura do pacote .docx para o modelo do documento.
 *
 * Tudo o que depende de herança — estilos, tema, numeração, estilo de tabela —
 * é resolvido aqui, uma vez. Quem monta a página recebe cada parágrafo e cada
 * trecho com as propriedades finais, em pontos.
 */

import type JSZip from "jszip";
import type {
  Anchor, Block, Border, Cell, DocModel, ImageRef, Inline, Paragraph, ParaProps, Row, RunProps, Section,
  SectionProps, Shape, Table,
} from "./model";
import { bulletText, Numbering } from "./numbering";
import {
  applyRun, colorOf, DEFAULT_RUN, mergeTabs, readBorder, readPara, readRun, readTheme, StyleSheet,
  type ParaPatch, type RunPatch,
} from "./styles";
import { attr, descendants, emu, kid, kids, num, onOff, parseXml, path, twip, val } from "./xml";

interface Rel {
  target: string;
  type: string;
  external: boolean;
}

/** Caminho de uma parte relativa a outra, dentro do pacote. */
function resolvePart(base: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const dir = base.includes("/") ? base.slice(0, base.lastIndexOf("/") + 1) : "";
  const parts = (dir + target).split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "..") out.pop();
    else if (p !== "." && p !== "") out.push(p);
  }
  return out.join("/");
}

async function readRels(zip: JSZip, part: string): Promise<Map<string, Rel>> {
  const dir = part.includes("/") ? part.slice(0, part.lastIndexOf("/") + 1) : "";
  const name = part.slice(dir.length);
  const file = zip.file(`${dir}_rels/${name}.rels`);
  const rels = new Map<string, Rel>();
  if (!file) return rels;
  const doc = parseXml(await file.async("string"));
  for (const r of kids(doc.documentElement, "Relationship")) {
    const id = attr(r, "Id");
    const target = attr(r, "Target");
    if (!id || !target) continue;
    const external = attr(r, "TargetMode") === "External";
    rels.set(id, { target: external ? target : resolvePart(part, target), type: attr(r, "Type") ?? "", external });
  }
  return rels;
}

const MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", bmp: "image/bmp",
  svg: "image/svg+xml", webp: "image/webp", tif: "image/tiff", tiff: "image/tiff", emf: "image/emf", wmf: "image/wmf",
};

/** Contexto de leitura de uma parte (corpo, cabeçalho, nota). */
interface PartContext {
  rels: Map<string, Rel>;
  /** Propriedades de estilo de tabela em vigor (para os parágrafos das células). */
  tablePara: ParaPatch[];
  tableRun: RunPatch[];
}

class Reader {
  private readonly media = new Map<string, Uint8Array>();
  private z = 0;

  constructor(
    private readonly zip: JSZip,
    private readonly styles: StyleSheet,
    private readonly numbering: Numbering,
  ) {}

  async preloadMedia(): Promise<void> {
    // Só arquivos: há geradores que gravam também as entradas de pasta.
    const files = Object.values(this.zip.files).filter(
      (f) => !f.dir && (f.name.startsWith("word/media/") || f.name.startsWith("word/embeddings/")),
    );
    await Promise.all(files.map(async (f) => this.media.set(f.name, await f.async("uint8array"))));
  }

  private image(ctx: PartContext, rId: string | null, width: number, height: number): ImageRef | null {
    if (!rId) return null;
    const rel = ctx.rels.get(rId);
    if (!rel || rel.external) return null;
    const data = this.media.get(rel.target);
    if (!data) return null;
    const ext = rel.target.slice(rel.target.lastIndexOf(".") + 1).toLowerCase();
    return { data, mime: MIME[ext] ?? "application/octet-stream", width, height };
  }

  // ------------------------------------------------------------ parágrafo

  paragraph(ctx: PartContext, p: Element): Paragraph[] {
    const pPr = kid(p, "pPr");
    const direct = readPara(this.styles.theme, pPr);
    const styleId = val(pPr, "pStyle");
    const style = this.styles.paragraphStyle(styleId);

    // Numeração: do parágrafo ou do estilo.
    let numId: string | null | undefined = direct.numId;
    let ilvl: number | null | undefined = direct.ilvl;
    for (const s of style.para) {
      if (numId === undefined && s.numId !== undefined) numId = s.numId;
      if ((ilvl === undefined || ilvl === null) && s.ilvl !== undefined && s.ilvl !== null && direct.ilvl === undefined) ilvl = s.ilvl;
    }
    const level = numId ? this.numbering.levelPatches(numId, ilvl ?? 0) : null;

    const paraPatches: ParaPatch[] = [
      readPara(this.styles.theme, this.styles.docPPr),
      ...ctx.tablePara,
      ...style.para,
      ...(level ? [level.para] : []),
      direct,
    ];
    const props = this.finishPara(paraPatches, styleId);
    const baseRun: RunPatch[] = [readRun(this.styles.theme, this.styles.docRPr), ...ctx.tableRun, ...style.run];
    props.markProps = applyRun([...baseRun, readRun(this.styles.theme, kid(pPr, "rPr"))]);

    let marker: Paragraph["marker"] = null;
    if (numId && numId !== "0") {
      const m = this.numbering.next(numId, ilvl ?? 0);
      if (m && (m.text || !m.isBullet)) {
        marker = { text: m.text, props: applyRun([...baseRun, m.run]), suffix: m.suffix };
      }
    }

    const inlines: Inline[] = [];
    this.inlines(ctx, p, baseRun, inlines, undefined);

    // Quebra de página no meio do parágrafo: o que vem depois começa na página
    // seguinte. O parágrafo é partido ali; a parte de depois, se vazia, some —
    // é o que o Word faz com a marca de parágrafo depois da quebra.
    const out: Paragraph[] = [];
    let current: Inline[] = [];
    let first = true;
    const flush = (endsWithBreak: boolean) => {
      const piece: Paragraph = {
        kind: "p",
        props: { ...props, ...(first ? {} : { spaceBefore: 0, pageBreakBefore: true, indFirst: props.indFirst }) },
        marker: first ? marker : null,
        inlines: current,
      };
      if (endsWithBreak) piece.props = { ...piece.props, spaceAfter: 0, keepNext: false };
      out.push(piece);
      current = [];
      first = false;
    };
    for (const inline of inlines) {
      if (inline.kind === "break" && inline.type === "page") {
        flush(true);
        continue;
      }
      current.push(inline);
    }
    if (current.length || out.length === 0) flush(false);
    else {
      // Quebra no fim do parágrafo: a marca de parágrafo que sobra depois dela
      // não ocupa linha (Word 2013+), mas o bloco seguinte vai para a página
      // seguinte.
      out.push({
        kind: "p",
        props: { ...props, spaceBefore: 0, spaceAfter: 0, pageBreakBefore: true, keepNext: false },
        marker: null,
        inlines: [],
        breakOnly: true,
      });
    }
    return out;
  }

  private finishPara(patches: ParaPatch[], styleId: string | null): ParaProps {
    const props: ParaProps = {
      styleId: styleId ?? this.styles.defaultParagraph,
      align: "left",
      indLeft: 0,
      indRight: 0,
      indFirst: 0,
      spaceBefore: 0,
      spaceAfter: 0,
      line: 1,
      lineRule: "auto",
      contextual: false,
      keepNext: false,
      keepLines: false,
      pageBreakBefore: false,
      // Ligado quando nenhum estilo diz nada: é o que o Word faz (medido num
      // contrato sem a opção declarada: ele não deixa linha órfã no pé).
      widowControl: true,
      tabs: [],
      shading: null,
      borders: {},
      markProps: { ...DEFAULT_RUN },
    };
    for (const p of patches) {
      const { tabs, borders, numId: _n, ilvl: _i, ...rest } = p;
      void _n;
      void _i;
      Object.assign(props, rest);
      if (tabs) props.tabs = mergeTabs(props.tabs, tabs);
      if (borders) props.borders = { ...props.borders, ...borders };
    }
    return props;
  }

  /** Trechos de um parágrafo (ou de um hiperlink, campo simples etc.). */
  private inlines(ctx: PartContext, el: Element, baseRun: RunPatch[], out: Inline[], link: string | undefined): void {
    const fieldStack: { instr: string; result: boolean; field: Inline | null }[] = [];
    const inField = () => fieldStack.length > 0;

    const visit = (node: Element, currentLink: string | undefined) => {
      for (const c of kids(node)) {
        switch (c.localName) {
          case "r":
            this.run(ctx, c, baseRun, out, currentLink, fieldStack);
            break;
          case "hyperlink": {
            const rId = attr(c, "id");
            const rel = rId ? ctx.rels.get(rId) : undefined;
            visit(c, rel?.external ? rel.target : currentLink);
            break;
          }
          case "fldSimple": {
            const instr = (attr(c, "instr") ?? "").trim().split(/\s+/)[0]?.toUpperCase() ?? "";
            if (instr === "PAGE" || instr === "NUMPAGES" || instr === "SECTIONPAGES") {
              const props = applyRun([...baseRun, readRun(this.styles.theme, path(c, "r", "rPr"))]);
              const fallback = descendants(c, "t").map((t) => t.textContent ?? "").join("");
              out.push({ kind: "field", field: instr, props, fallback, format: fieldFormat(attr(c, "instr") ?? "") });
            } else {
              visit(c, currentLink);
            }
            break;
          }
          case "ins":
          case "smartTag":
          case "customXml":
          case "dir":
          case "bdo":
            visit(c, currentLink);
            break;
          case "sdt":
            visit(kid(c, "sdtContent") ?? c, currentLink);
            break;
          case "oMath":
          case "oMathPara": {
            // Equação: o texto dela, na fonte do parágrafo. Sem o desenho da
            // fórmula, mas sem perder o conteúdo.
            const text = descendants(c, "t").map((t) => t.textContent ?? "").join("");
            if (text) out.push({ kind: "text", text, props: applyRun([...baseRun, { font: "Cambria Math" }]), link: currentLink });
            break;
          }
          default:
            break;
        }
      }
    };
    void inField;
    visit(el, link);
  }

  private run(
    ctx: PartContext,
    r: Element,
    baseRun: RunPatch[],
    out: Inline[],
    link: string | undefined,
    fieldStack: { instr: string; result: boolean; field: Inline | null }[],
  ): void {
    const rPr = kid(r, "rPr");
    const props = applyRun([
      ...baseRun,
      ...this.styles.characterStyle(val(rPr, "rStyle")),
      readRun(this.styles.theme, rPr),
    ]);
    if (props.hidden) return;

    for (const c of kids(r)) {
      // Dentro de um campo: só o resultado aparece; PAGE e afins viram campo
      // vivo. Reavaliado a cada elemento: há geradores que gravam o campo
      // inteiro (início, código, separador e fim) num trecho só.
      const top = fieldStack[fieldStack.length - 1];
      const showing = !top || top.result;
      const replaced = fieldStack.some((f) => f.field !== null);
      switch (c.localName) {
        case "fldChar": {
          const type = attr(c, "fldCharType");
          if (type === "begin") fieldStack.push({ instr: "", result: false, field: null });
          else if (type === "separate" && fieldStack.length) {
            const f = fieldStack[fieldStack.length - 1];
            f.result = true;
            const code = f.instr.trim().split(/\s+/)[0]?.toUpperCase() ?? "";
            if (code === "PAGE" || code === "NUMPAGES" || code === "SECTIONPAGES") {
              f.field = { kind: "field", field: code, props, fallback: "", format: fieldFormat(f.instr) };
              out.push(f.field);
            }
          } else if (type === "end") fieldStack.pop();
          break;
        }
        case "instrText":
          if (top && !top.result) top.instr += c.textContent ?? "";
          break;
        case "t":
          if (showing && !replaced) pushText(out, c.textContent ?? "", props, link);
          else if (replaced) {
            const f = fieldStack.find((x) => x.field)?.field;
            if (f && f.kind === "field") f.fallback += c.textContent ?? "";
          }
          break;
        case "tab":
        case "ptab":
          if (showing && !replaced) out.push({ kind: "tab", props });
          break;
        case "br":
        case "cr": {
          if (!showing || replaced) break;
          const type = attr(c, "type");
          out.push({ kind: "break", type: type === "page" ? "page" : type === "column" ? "column" : "line", props });
          break;
        }
        case "noBreakHyphen":
          if (showing && !replaced) pushText(out, "‑", props, link);
          break;
        case "softHyphen":
          if (showing && !replaced) pushText(out, "­", props, link);
          break;
        case "sym": {
          if (!showing || replaced) break;
          const code = parseInt(attr(c, "char") ?? "", 16);
          if (Number.isFinite(code)) {
            const raw = String.fromCharCode(code < 0xf000 ? code + 0xf000 : code);
            const mapped = bulletText(raw);
            pushText(out, mapped === raw ? String.fromCharCode(code & 0xff) : mapped, props, link);
          }
          break;
        }
        case "drawing":
          if (showing && !replaced) this.drawing(ctx, c, props, out);
          break;
        case "pict":
        case "object":
          if (showing && !replaced) this.vml(ctx, c, props, out);
          break;
        case "AlternateContent": {
          if (!showing || replaced) break;
          const choice = kid(c, "Choice");
          const fallback = kid(c, "Fallback");
          const drawing = kid(choice, "drawing");
          if (drawing) this.drawing(ctx, drawing, props, out);
          else if (fallback) {
            for (const f of kids(fallback)) {
              if (f.localName === "pict") this.vml(ctx, f, props, out);
              if (f.localName === "drawing") this.drawing(ctx, f, props, out);
            }
          }
          break;
        }
        case "footnoteReference":
          if (showing) out.push({ kind: "footnote", id: attr(c, "id") ?? "", props: { ...props, vertAlign: "superscript" } });
          break;
        case "endnoteReference":
          if (showing) out.push({ kind: "footnote", id: `e${attr(c, "id") ?? ""}`, props: { ...props, vertAlign: "superscript" } });
          break;
        case "footnoteRef":
        case "endnoteRef":
          // Número da própria nota, dentro do texto da nota.
          out.push({ kind: "footnote", id: "self", props: { ...props, vertAlign: "superscript" } });
          break;
        default:
          break;
      }
    }
  }

  // --------------------------------------------------------- desenhos

  private anchorOf(el: Element): Anchor | null {
    if (el.localName !== "anchor") return null;
    const h = kid(el, "positionH");
    const v = kid(el, "positionV");
    const wrap = kids(el).find((k) => k.localName.startsWith("wrap"));
    const wrapType: Anchor["wrap"] =
      wrap?.localName === "wrapSquare" ? "square"
      : wrap?.localName === "wrapTight" ? "tight"
      : wrap?.localName === "wrapThrough" ? "through"
      : wrap?.localName === "wrapTopAndBottom" ? "topAndBottom"
      : "none";
    return {
      hRelative: (attr(h, "relativeFrom") ?? "column") as Anchor["hRelative"],
      hAlign: (kid(h, "align")?.textContent?.trim() as Anchor["hAlign"]) ?? null,
      hOffset: emu(Number(kid(h, "posOffset")?.textContent ?? 0)) ?? 0,
      vRelative: (attr(v, "relativeFrom") ?? "paragraph") as Anchor["vRelative"],
      vAlign: (kid(v, "align")?.textContent?.trim() as Anchor["vAlign"]) ?? null,
      vOffset: emu(Number(kid(v, "posOffset")?.textContent ?? 0)) ?? 0,
      wrap: wrapType,
      behind: attr(el, "behindDoc") === "1" || attr(el, "behindDoc") === "true",
      distLeft: emu(num(el, "distL") ?? 0) ?? 0,
      distRight: emu(num(el, "distR") ?? 0) ?? 0,
      distTop: emu(num(el, "distT") ?? 0) ?? 0,
      distBottom: emu(num(el, "distB") ?? 0) ?? 0,
      z: num(el, "relativeHeight") ?? this.z++,
    };
  }

  private drawing(ctx: PartContext, drawing: Element, props: RunProps, out: Inline[]): void {
    for (const holder of kids(drawing)) {
      if (holder.localName !== "inline" && holder.localName !== "anchor") continue;
      const extent = kid(holder, "extent");
      const width = emu(num(extent, "cx") ?? 0) ?? 0;
      const height = emu(num(extent, "cy") ?? 0) ?? 0;
      const anchor = this.anchorOf(holder);
      const data = path(holder, "graphic", "graphicData");
      const blip = descendants(data, "blip")[0];
      if (blip) {
        const image = this.image(ctx, attr(blip, "embed"), width, height);
        if (image) out.push({ kind: "image", image, props, anchor });
        continue;
      }
      const wsp = descendants(data, "wsp")[0];
      if (wsp) {
        const txbx = path(wsp, "txbx", "txbxContent");
        const shape = this.shapeOf(wsp);
        const bodyPr = kid(wsp, "bodyPr");
        const inset = (n: string, d: number) => emu(num(bodyPr, n) ?? d) ?? 0;
        out.push({
          kind: "box",
          width,
          height,
          blocks: txbx ? this.blocks({ ...ctx, tablePara: [], tableRun: [] }, txbx) : [],
          shape,
          anchor,
          props,
          padding: [inset("tIns", 45720), inset("rIns", 91440), inset("bIns", 45720), inset("lIns", 91440)],
        });
      }
    }
  }

  private shapeOf(wsp: Element): Shape | null {
    const spPr = kid(wsp, "spPr");
    if (!spPr) return null;
    const geom = attr(kid(spPr, "prstGeom"), "prst") ?? "rect";
    const fillEl = kid(spPr, "solidFill");
    const fill = fillEl ? this.drawingColor(fillEl) : kid(spPr, "noFill") ? null : null;
    const ln = kid(spPr, "ln");
    const lnFill = kid(ln, "solidFill");
    const stroke = ln && !kid(ln, "noFill") && lnFill ? this.drawingColor(lnFill) : null;
    return {
      geometry: geom === "ellipse" ? "ellipse" : geom === "roundRect" ? "roundRect" : geom === "line" || geom.includes("Connector") ? "line" : "rect",
      fill,
      stroke,
      strokeWidth: emu(num(ln, "w") ?? 9525) ?? 0.75,
    };
  }

  private drawingColor(fill: Element): string | null {
    const srgb = kid(fill, "srgbClr");
    if (srgb) return `#${(attr(srgb, "val") ?? "000000").toUpperCase()}`;
    const scheme = kid(fill, "schemeClr");
    if (scheme) {
      const name = attr(scheme, "val") ?? "accent1";
      const alias: Record<string, string> = { tx1: "dk1", bg1: "lt1", tx2: "dk2", bg2: "lt2" };
      return this.styles.theme.colors.get(alias[name] ?? name) ?? null;
    }
    return null;
  }

  /** Desenho no formato antigo (VML): imagem e marca d'água de texto. */
  private vml(ctx: PartContext, el: Element, props: RunProps, out: Inline[]): void {
    const imagedata = descendants(el, "imagedata")[0];
    const shape = descendants(el, "shape")[0] ?? descendants(el, "rect")[0];
    const style = attr(shape, "style") ?? "";
    const dim = (name: string) => {
      const m = new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([\\d.]+)(pt|in|cm|mm|px)?`).exec(style);
      if (!m) return 0;
      const v = Number(m[1]);
      const unit = m[2] ?? "pt";
      return unit === "in" ? v * 72 : unit === "cm" ? (v * 72) / 2.54 : unit === "mm" ? (v * 72) / 25.4 : unit === "px" ? v * 0.75 : v;
    };
    const absolute = /position\s*:\s*absolute/.test(style);
    const anchor = (): Anchor | null =>
      absolute
        ? {
            hRelative: /mso-position-horizontal-relative\s*:\s*page/.test(style) ? "page" : "margin",
            hAlign: /mso-position-horizontal\s*:\s*center/.test(style) ? "center" : null,
            hOffset: dim("margin-left"),
            vRelative: /mso-position-vertical-relative\s*:\s*page/.test(style) ? "page" : "margin",
            vAlign: /mso-position-vertical\s*:\s*center/.test(style) ? "center" : null,
            vOffset: dim("margin-top"),
            wrap: "none",
            behind: /z-index\s*:\s*-/.test(style),
            distLeft: 0, distRight: 0, distTop: 0, distBottom: 0,
            z: this.z++,
          }
        : null;
    if (imagedata) {
      const image = this.image(ctx, attr(imagedata, "id"), dim("width"), dim("height"));
      if (image && image.width > 0 && image.height > 0) out.push({ kind: "image", image, props, anchor: anchor() });
      return;
    }
    // Marca d'água de texto: forma com "caminho de texto" (WordArt).
    // O da própria forma: o do tipo de forma (`v:shapetype`) não tem texto.
    const textpath = descendants(shape, "textpath")[0];
    const text = attr(textpath, "string");
    if (shape && text && dim("width") > 0 && dim("height") > 0) {
      const font = /font-family\s*:\s*"?([^";]+)"?/.exec(attr(textpath, "style") ?? "")?.[1]?.trim() ?? props.font;
      const opacityRaw = attr(descendants(shape, "fill")[0], "opacity");
      const opacity = opacityRaw === null ? 1 : opacityRaw.endsWith("f") ? Number(opacityRaw.slice(0, -1)) / 65536 : Number(opacityRaw);
      out.push({
        kind: "box",
        width: dim("width"),
        height: dim("height"),
        blocks: [],
        shape: null,
        anchor: anchor(),
        props,
        padding: [0, 0, 0, 0],
        watermark: {
          text,
          font,
          color: vmlColor(attr(shape, "fillcolor")) ?? "#C0C0C0",
          opacity: Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 1,
          rotation: Number(/rotation\s*:\s*(-?[\d.]+)/.exec(style)?.[1] ?? 0),
        },
      });
    }
  }

  // ------------------------------------------------------------ tabelas

  table(ctx: PartContext, tbl: Element): Table {
    const tblPr = kid(tbl, "tblPr");
    const styleChain = this.styles.tableStyle(val(tblPr, "tblStyle"));
    const look = kid(tblPr, "tblLook");
    const lookFlag = (name: string, bit: number, def: boolean) => {
      const a = attr(look, name);
      if (a !== null) return a === "1" || a === "true";
      const v = attr(look, "val");
      if (v !== null) return (parseInt(v, 16) & bit) !== 0;
      return def;
    };
    const firstRow = lookFlag("firstRow", 0x0020, true);
    const lastRow = lookFlag("lastRow", 0x0040, false);
    const firstCol = lookFlag("firstColumn", 0x0080, true);
    const lastCol = lookFlag("lastColumn", 0x0100, false);
    const noHBand = lookFlag("noHBand", 0x0200, false);
    const noVBand = lookFlag("noVBand", 0x0400, true);

    // Bordas e margens: estilo (com herança) e depois a própria tabela.
    const tableBorders: Record<string, Border | null> = {};
    // Margem lateral da célula: 108 twips no estilo "Tabela normal" do Word.
    // Num arquivo sem estilo de tabela padrão (comum nos gerados por
    // programas), o Word usa 10 twips (medido: as linhas só batem assim, e é o
    // que ele grava ao salvar o arquivo de novo).
    const side = this.styles.defaultTable ? 5.4 : 0.5;
    const cellMar = { top: 0, right: side, bottom: 0, left: side };
    const readTblPr = (pr: Element | null) => {
      const b = kid(pr, "tblBorders");
      for (const side of ["top", "left", "bottom", "right", "insideH", "insideV", "start", "end"]) {
        const border = readBorder(this.styles.theme, kid(b, side));
        if (border !== undefined) tableBorders[side === "start" ? "left" : side === "end" ? "right" : side] = border;
      }
      const m = kid(pr, "tblCellMar");
      for (const side of ["top", "right", "bottom", "left", "start", "end"] as const) {
        const w = twip(num(kid(m, side), "w"));
        if (w !== null) cellMar[side === "start" ? "left" : side === "end" ? "right" : side] = w;
      }
    };
    for (const s of styleChain) readTblPr(s.tblPr);
    readTblPr(tblPr);

    const grid = kids(kid(tbl, "tblGrid"), "gridCol").map((g) => (num(g, "w") ?? 0) / 20);
    const jc = val(tblPr, "jc");
    const indent = twip(num(kid(tblPr, "tblInd"), "w")) ?? 0;
    const tblW = kid(tblPr, "tblW");
    const tblWType = attr(tblW, "type") ?? "dxa";
    const tblWRaw = attr(tblW, "w");
    let width: Table["width"] = null;
    if (tblWRaw && tblWType === "dxa" && Number(tblWRaw) > 0) width = { type: "pt", value: Number(tblWRaw) / 20 };
    // Em porcentagem, o Word grava cinquentésimos ("5000" = 100%) ou o texto "100%".
    else if (tblWRaw && tblWType === "pct") {
      const pct = tblWRaw.endsWith("%") ? parseFloat(tblWRaw) : Number(tblWRaw) / 50;
      if (pct > 0) width = { type: "pct", value: pct };
    }
    let fixed = false;
    for (const s of styleChain) if (attr(kid(s.tblPr, "tblLayout"), "type") === "fixed") fixed = true;
    if (kid(tblPr, "tblLayout")) fixed = attr(kid(tblPr, "tblLayout"), "type") === "fixed";

    const trs = kids(tbl, "tr");
    const rows: Row[] = [];
    trs.forEach((tr, r) => {
      const trPr = kid(tr, "trPr");
      const heightEl = kid(trPr, "trHeight");
      const hRule = attr(heightEl, "hRule");
      const row: Row = {
        height: twip(num(heightEl, "val")),
        heightRule: hRule === "exact" ? "exact" : heightEl ? "atLeast" : "auto",
        header: onOff(trPr, "tblHeader") === true,
        cantSplit: onOff(trPr, "cantSplit") === true,
        cells: [],
        gridBefore: num(kid(trPr, "gridBefore"), "val") ?? 0,
      };
      const tcs = kids(tr, "tc").concat(kids(tr, "sdt").flatMap((s) => kids(kid(s, "sdtContent"), "tc")));
      let col = row.gridBefore;
      tcs.forEach((tc, ci) => {
        const tcPr = kid(tc, "tcPr");
        const span = num(kid(tcPr, "gridSpan"), "val") ?? 1;
        const vMergeEl = kid(tcPr, "vMerge");
        const vMerge = vMergeEl ? (attr(vMergeEl, "val") === "restart" ? "restart" : "continue") : null;

        // Formatação condicional do estilo de tabela, na ordem de força do Word.
        const conditions: string[] = ["wholeTable"];
        const bodyRow = firstRow ? r - 1 : r;
        if (!noVBand) conditions.push(Math.floor(col / 1) % 2 === 0 ? "band1Vert" : "band2Vert");
        if (!noHBand && !(firstRow && r === 0) && !(lastRow && r === trs.length - 1)) {
          conditions.push(bodyRow % 2 === 0 ? "band1Horz" : "band2Horz");
        }
        if (firstCol && col === 0) conditions.push("firstCol");
        if (lastCol && ci === tcs.length - 1) conditions.push("lastCol");
        if (firstRow && r === 0) conditions.push("firstRow");
        if (lastRow && r === trs.length - 1) conditions.push("lastRow");
        if (firstRow && r === 0 && firstCol && col === 0) conditions.push("nwCell");
        if (firstRow && r === 0 && lastCol && ci === tcs.length - 1) conditions.push("neCell");
        if (lastRow && r === trs.length - 1 && firstCol && col === 0) conditions.push("swCell");
        if (lastRow && r === trs.length - 1 && lastCol && ci === tcs.length - 1) conditions.push("seCell");

        const tablePara: ParaPatch[] = [];
        const tableRun: RunPatch[] = [];
        let shading: string | null = null;
        const condBorders: Record<string, Border | null> = {};
        for (const s of styleChain) {
          tablePara.push(readPara(this.styles.theme, s.pPr));
          tableRun.push(readRun(this.styles.theme, s.rPr));
          const fill = colorOf(this.styles.theme, kid(s.tcPr, "shd"), "fill", "themeFill");
          if (fill !== undefined) shading = fill;
        }
        for (const c of conditions) {
          for (const s of styleChain) {
            const cond = s.conditional.get(c);
            if (!cond) continue;
            tablePara.push(readPara(this.styles.theme, cond.pPr));
            tableRun.push(readRun(this.styles.theme, cond.rPr));
            const fill = colorOf(this.styles.theme, kid(cond.tcPr, "shd"), "fill", "themeFill");
            if (fill !== undefined) shading = fill;
            const tb = kid(cond.tcPr, "tcBorders");
            for (const side of ["top", "left", "bottom", "right", "insideH", "insideV"]) {
              const border = readBorder(this.styles.theme, kid(tb, side));
              if (border !== undefined) condBorders[side] = border;
            }
          }
        }
        const directFill = colorOf(this.styles.theme, kid(tcPr, "shd"), "fill", "themeFill");
        if (directFill !== undefined) shading = directFill;

        // Bordas da célula: as da tabela pela posição, as condicionais e as próprias.
        const lastColumn = col + span >= grid.length;
        const pick = (outer: string, inner: string, isOuter: boolean) => {
          const key = isOuter ? outer : inner;
          const fromCond = condBorders[key] !== undefined ? condBorders[key] : condBorders[outer];
          return fromCond !== undefined ? fromCond : tableBorders[key];
        };
        const borders: Cell["borders"] = {};
        const top = pick("top", "insideH", r === 0);
        const bottom = pick("bottom", "insideH", r === trs.length - 1);
        const left = pick("left", "insideV", col === 0);
        const right = pick("right", "insideV", lastColumn);
        if (top) borders.top = top;
        if (bottom) borders.bottom = bottom;
        if (left) borders.left = left;
        if (right) borders.right = right;
        const tcBorders = kid(tcPr, "tcBorders");
        for (const side of ["top", "left", "bottom", "right", "start", "end"] as const) {
          const border = readBorder(this.styles.theme, kid(tcBorders, side));
          const key = side === "start" ? "left" : side === "end" ? "right" : side;
          if (border === null) delete borders[key];
          else if (border) borders[key] = border;
        }

        const margins = { ...cellMar };
        const tcMar = kid(tcPr, "tcMar");
        for (const side of ["top", "right", "bottom", "left", "start", "end"] as const) {
          const w = twip(num(kid(tcMar, side), "w"));
          if (w !== null) margins[side === "start" ? "left" : side === "end" ? "right" : side] = w;
        }
        const vAlign = val(tcPr, "vAlign");
        row.cells.push({
          span,
          vMerge,
          width: (attr(kid(tcPr, "tcW"), "type") ?? "dxa") === "dxa" ? twip(num(kid(tcPr, "tcW"), "w")) || null : null,
          shading,
          borders,
          vAlign: vAlign === "center" ? "center" : vAlign === "bottom" ? "bottom" : "top",
          margins,
          blocks: this.blocks({ rels: ctx.rels, tablePara, tableRun }, tc),
        });
        col += span;
      });
      rows.push(row);
    });

    return {
      kind: "table",
      grid: grid.length ? grid : [450],
      width,
      fixed,
      align: jc === "center" ? "center" : jc === "right" || jc === "end" ? "right" : "left",
      indent,
      rows,
    };
  }

  // ------------------------------------------------------------- blocos

  blocks(ctx: PartContext, container: Element): Block[] {
    const out: Block[] = [];
    for (const c of kids(container)) {
      if (c.localName === "p") out.push(...this.paragraph(ctx, c));
      else if (c.localName === "tbl") out.push(this.table(ctx, c));
      else if (c.localName === "sdt") out.push(...this.blocks(ctx, kid(c, "sdtContent") ?? c));
      else if (c.localName === "customXml" || c.localName === "ins") out.push(...this.blocks(ctx, c));
    }
    return out;
  }

  async part(name: string): Promise<{ root: Element; ctx: PartContext } | null> {
    const file = this.zip.file(name);
    if (!file) return null;
    const doc = parseXml(await file.async("string"));
    return { root: doc.documentElement, ctx: { rels: await readRels(this.zip, name), tablePara: [], tableRun: [] } };
  }
}

const VML_COLORS: Record<string, string> = {
  black: "#000000", white: "#FFFFFF", silver: "#C0C0C0", gray: "#808080", grey: "#808080", red: "#FF0000",
  maroon: "#800000", yellow: "#FFFF00", olive: "#808000", lime: "#00FF00", green: "#008000", aqua: "#00FFFF",
  teal: "#008080", blue: "#0000FF", navy: "#000080", fuchsia: "#FF00FF", purple: "#800080",
};

/** Cor do VML: "#rrggbb", "#rgb" ou nome, às vezes com um índice ("#d8d8d8 [2732]"). */
function vmlColor(value: string | null): string | null {
  if (!value) return null;
  const v = value.trim().split(/\s+/)[0].toLowerCase();
  if (VML_COLORS[v]) return VML_COLORS[v];
  const long = /^#([0-9a-f]{6})$/.exec(v);
  if (long) return `#${long[1].toUpperCase()}`;
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toUpperCase();
  return null;
}

function pushText(out: Inline[], text: string, props: RunProps, link: string | undefined) {
  if (!text) return;
  // Há geradores que gravam a tabulação como caractere dentro do texto; o
  // Word a trata como tabulação de verdade.
  if (text.includes("\t")) {
    text.split("\t").forEach((piece, i) => {
      if (i > 0) out.push({ kind: "tab", props });
      pushText(out, piece, props, link);
    });
    return;
  }
  const last = out[out.length - 1];
  // Trechos seguidos com o mesmo estilo viram um só: menos elementos para medir.
  if (last && last.kind === "text" && last.link === link && sameProps(last.props, props)) {
    last.text += text;
    return;
  }
  out.push({ kind: "text", text, props, link });
}

const sameProps = (a: RunProps, b: RunProps) =>
  a.font === b.font && a.size === b.size && a.bold === b.bold && a.italic === b.italic &&
  a.underline === b.underline && a.strike === b.strike && a.doubleStrike === b.doubleStrike &&
  a.color === b.color && a.highlight === b.highlight && a.shading === b.shading &&
  a.vertAlign === b.vertAlign && a.caps === b.caps && a.smallCaps === b.smallCaps &&
  a.spacing === b.spacing && a.position === b.position;

function sectionProps(el: Element | null, previous: SectionProps | null): Omit<SectionProps, "headers" | "footers"> & {
  headerRefs: Record<string, string>;
  footerRefs: Record<string, string>;
} {
  const pgSz = kid(el, "pgSz");
  const pgMar = kid(el, "pgMar");
  const cols = kid(el, "cols");
  const w = twip(num(pgSz, "w")) ?? previous?.pageWidth ?? 595.3;
  const h = twip(num(pgSz, "h")) ?? previous?.pageHeight ?? 841.9;
  const m = (n: string, d: number) => twip(num(pgMar, n)) ?? d;
  const pm = previous?.margins;
  const headerRefs: Record<string, string> = {};
  const footerRefs: Record<string, string> = {};
  for (const ref of kids(el, "headerReference")) headerRefs[attr(ref, "type") ?? "default"] = attr(ref, "id") ?? "";
  for (const ref of kids(el, "footerReference")) footerRefs[attr(ref, "type") ?? "default"] = attr(ref, "id") ?? "";
  const colWidths = kids(cols, "col").map((c) => twip(num(c, "w")) ?? 0);
  const type = val(el, "type");
  return {
    pageWidth: w,
    pageHeight: h,
    margins: {
      top: Math.abs(m("top", pm?.top ?? 72)),
      right: m("right", pm?.right ?? 72),
      bottom: Math.abs(m("bottom", pm?.bottom ?? 72)),
      left: m("left", pm?.left ?? 72),
      header: m("header", pm?.header ?? 36),
      footer: m("footer", pm?.footer ?? 36),
      gutter: m("gutter", 0),
    },
    columns: {
      count: Math.max(1, num(cols, "num") ?? 1),
      space: twip(num(cols, "space")) ?? 36,
      separator: attr(cols, "sep") === "1" || attr(cols, "sep") === "true",
      widths: colWidths.length && attr(cols, "equalWidth") === "0" ? colWidths : null,
    },
    type: type === "continuous" ? "continuous" : type === "evenPage" ? "evenPage" : type === "oddPage" ? "oddPage" : type === "nextColumn" ? "nextColumn" : "nextPage",
    titlePage: onOff(el, "titlePg") === true,
    pageNumberStart: num(kid(el, "pgNumType"), "start"),
    pageNumberFormat: attr(kid(el, "pgNumType"), "fmt") ?? null,
    headerRefs,
    footerRefs,
  };
}

/** Lê um .docx inteiro. */
export async function readDocx(data: ArrayBuffer): Promise<DocModel> {
  const JSZip = (await import("jszip")).default;
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    throw new Error("Este arquivo não é um documento Word (.docx) válido.");
  }
  const mainName = "word/document.xml";
  if (!zip.file(mainName)) throw new Error("Este arquivo não é um documento Word (.docx) válido.");

  const xmlOf = async (name: string) => {
    const f = zip.file(name);
    return f ? parseXml(await f.async("string")) : null;
  };
  const docRels = await readRels(zip, mainName);
  const partOfType = (suffix: string) => [...docRels.values()].find((r) => r.type.endsWith(suffix))?.target;
  const theme = readTheme(await xmlOf(partOfType("/theme") ?? "word/theme/theme1.xml"));
  const styles = new StyleSheet(await xmlOf(partOfType("/styles") ?? "word/styles.xml"), theme);
  const numbering = new Numbering(await xmlOf(partOfType("/numbering") ?? "word/numbering.xml"), theme);
  const settings = await xmlOf(partOfType("/settings") ?? "word/settings.xml");
  const settingsRoot = settings?.documentElement ?? null;
  const evenAndOddHeaders = onOff(settingsRoot, "evenAndOddHeaders") === true;
  const defaultTab = (num(kid(settingsRoot, "defaultTabStop"), "val") ?? 720) / 20 || 36;
  const compatSetting = kids(kid(settingsRoot, "compat"), "compatSetting").find((c) => attr(c, "name") === "compatibilityMode");
  const compatMode = num(compatSetting, "val") ?? 12;

  const reader = new Reader(zip, styles, numbering);
  await reader.preloadMedia();
  const main = await reader.part(mainName);
  if (!main) throw new Error("Este arquivo não é um documento Word (.docx) válido.");
  const body = kid(main.root, "body");

  // Corpo, partido nas seções: o `sectPr` dentro do parágrafo fecha a seção.
  const rawSections: { el: Element | null; blocks: Block[] }[] = [];
  let current: Block[] = [];
  const walk = (container: Element) => {
    for (const c of kids(container)) {
      if (c.localName === "p") {
        current.push(...reader.paragraph(main.ctx, c));
        const sect = path(c, "pPr", "sectPr");
        if (sect) {
          rawSections.push({ el: sect, blocks: current });
          current = [];
        }
      } else if (c.localName === "tbl") current.push(reader.table(main.ctx, c));
      else if (c.localName === "sdt") walk(kid(c, "sdtContent") ?? c);
      else if (c.localName === "customXml") walk(c);
      else if (c.localName === "sectPr") {
        rawSections.push({ el: c, blocks: current });
        current = [];
      }
    }
  };
  walk(body!);
  if (current.length) {
    if (rawSections.length) rawSections[rawSections.length - 1].blocks.push(...current);
    else rawSections.push({ el: null, blocks: current });
  }
  // O documento do Word sempre termina num parágrafo: quando o arquivo acaba
  // numa tabela, o Word acrescenta um vazio ao abrir, e ele ocupa uma linha
  // (às vezes, a única da última página).
  const empty = parseXml(`<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>`).documentElement;
  const normal = reader.paragraph(main.ctx, empty)[0];
  const lastSection = rawSections[rawSections.length - 1];
  if (lastSection && lastSection.blocks[lastSection.blocks.length - 1]?.kind === "table") lastSection.blocks.push(normal);

  // Cabeçalhos e rodapés: cada seção herda os da anterior que não declarar.
  const partCache = new Map<string, Block[]>();
  const readHeaderFooter = async (rId: string): Promise<Block[] | undefined> => {
    const rel = docRels.get(rId);
    if (!rel) return undefined;
    if (partCache.has(rel.target)) return partCache.get(rel.target);
    const part = await reader.part(rel.target);
    const blocks = part ? reader.blocks(part.ctx, part.root) : [];
    partCache.set(rel.target, blocks);
    return blocks;
  };

  const sections: Section[] = [];
  let previous: SectionProps | null = null;
  for (let r = 0; r < rawSections.length; r++) {
    const raw = rawSections[r];
    // O parágrafo vazio que só carrega a quebra de seção contínua não ocupa
    // linha no Word (medido: o título da seção seguinte vem logo abaixo).
    const nextType = r + 1 < rawSections.length ? val(rawSections[r + 1].el, "type") : null;
    const last = raw.blocks[raw.blocks.length - 1];
    if (nextType === "continuous" && last?.kind === "p" && !last.marker && last.inlines.length === 0) raw.blocks.pop();
    const sp = sectionProps(raw.el, previous);
    const headers: SectionProps["headers"] = { ...(previous?.headers ?? {}) };
    const footers: SectionProps["footers"] = { ...(previous?.footers ?? {}) };
    for (const [type, rId] of Object.entries(sp.headerRefs)) {
      const blocks = await readHeaderFooter(rId);
      if (blocks) headers[type as keyof SectionProps["headers"]] = blocks;
    }
    for (const [type, rId] of Object.entries(sp.footerRefs)) {
      const blocks = await readHeaderFooter(rId);
      if (blocks) footers[type as keyof SectionProps["footers"]] = blocks;
    }
    const { headerRefs: _h, footerRefs: _f, ...rest } = sp;
    void _h;
    void _f;
    const props: SectionProps = { ...rest, headers, footers };
    sections.push({ props, blocks: raw.blocks });
    previous = props;
  }

  // Notas de rodapé.
  const footnotes = new Map<string, Block[]>();
  const fnPart = partOfType("/footnotes");
  if (fnPart) {
    const part = await reader.part(fnPart);
    for (const fn of kids(part?.root, "footnote")) {
      const type = attr(fn, "type");
      if (type === "separator" || type === "continuationSeparator" || type === "continuationNotice") continue;
      const id = attr(fn, "id");
      if (id !== null && part) footnotes.set(id, reader.blocks(part.ctx, fn));
    }
  }

  // Notas de fim.
  const endnotes = new Map<string, Block[]>();
  const enPart = partOfType("/endnotes");
  if (enPart) {
    const part = await reader.part(enPart);
    for (const en of kids(part?.root, "endnote")) {
      const type = attr(en, "type");
      if (type === "separator" || type === "continuationSeparator" || type === "continuationNotice") continue;
      const id = attr(en, "id");
      if (id !== null && part) endnotes.set(`e${id}`, reader.blocks(part.ctx, en));
    }
  }

  return { sections, footnotes, endnotes, evenAndOddHeaders, defaultTab, compatMode, normalRun: normal.props.markProps };
}

/**
 * Formato pedido na instrução do campo: `PAGE \* roman` escreve "iv",
 * `\* ROMAN` "IV", `\* alphabetic` "d". MERGEFORMAT e afins não mudam o número.
 */
export function fieldFormat(instr: string): string | undefined {
  for (const m of instr.matchAll(/\\\*\s*([A-Za-z]+)/g)) {
    const sw = m[1];
    if (sw === "roman") return "lowerRoman";
    if (sw === "ROMAN" || sw === "Roman") return "upperRoman";
    if (sw === "alphabetic") return "lowerLetter";
    if (sw === "ALPHABETIC" || sw === "Alphabetic") return "upperLetter";
    if (/^arabic$/i.test(sw)) return "decimal";
  }
  return undefined;
}
