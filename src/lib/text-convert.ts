/**
 * Motor das conversões de texto e dados (TXT, Markdown, HTML, CSV, JSON, YAML).
 *
 * Estava dentro do componente e por isso nunca tinha sido testado. Extraído
 * para cá, é função pura e o teste cobre cada aresta — que foi como os defeitos
 * de fidelidade descritos nos comentários abaixo apareceram.
 */

import { Lexer, Marked, type Token, type Tokens } from "marked";

export type TextFmt = "txt" | "md" | "html" | "csv" | "json" | "yaml";

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/**
 * Analisa CSV conforme a RFC 4180.
 *
 * A versão anterior quebrava o texto por linha ANTES de olhar as aspas, então
 * um campo com quebra de linha dentro (endereço, observação, descrição) era
 * partido em duas linhas e desalinhava a tabela inteira. Aqui o varredor anda
 * caractere a caractere e só encerra a linha quando está fora das aspas.
 */
/**
 * Separador do CSV: vírgula, ponto e vírgula ou tabulação.
 *
 * O Excel em português grava CSV com ponto e vírgula (a vírgula é a decimal),
 * e o que se cola de uma planilha vem separado por tabulação; lidos como
 * vírgula, os dois viravam uma coluna só. Vence o separador que aparece fora
 * das aspas no cabeçalho e no mesmo número nas linhas seguintes.
 */
export function detectDelimiter(text: string): string {
  const candidates = [",", ";", "\t"];
  const lines: number[][] = [];
  let cur = [0, 0, 0];
  let inQuotes = false;
  for (let i = 0; i < text.length && lines.length < 20; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') i++;
        else inQuotes = false;
      }
      continue;
    }
    // Aspas abrem só no começo do campo, como em parseCsv.
    const prev = text[i - 1];
    if (c === '"' && (i === 0 || prev === "\n" || prev === "\r" || candidates.includes(prev))) inQuotes = true;
    else if (c === "\n") {
      lines.push(cur);
      cur = [0, 0, 0];
    } else {
      const k = candidates.indexOf(c);
      if (k >= 0) cur[k]++;
    }
  }
  if (cur.some((n) => n > 0)) lines.push(cur);
  let best = ",";
  let bestScore = 0;
  candidates.forEach((d, k) => {
    const head = lines[0]?.[k] ?? 0;
    if (!head) return;
    const same = lines.filter((l) => l[k] === head).length / lines.length;
    const score = same * 1000 + head;
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  });
  return best;
}

export function parseCsv(text: string, delimiter?: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQuotes = false;

  // O BOM que o Excel escreve viraria parte do primeiro cabeçalho.
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const sep = delimiter ?? detectDelimiter(src);

  // Aspas só abrem um campo no começo dele: em `5" de tela` são texto, como
  // no Excel (antes abriam uma citação e engoliam o resto do arquivo).
  let fieldStart = true;
  const endField = () => { row.push(cur); cur = ""; fieldStart = true; };
  const endRow = () => { endField(); rows.push(row); row = []; };

  for (let i = 0; i < src.length; i++) {
    const c = src[i];

    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else {
        cur += c;
      }
      continue;
    }

    if (c === '"' && fieldStart) { inQuotes = true; fieldStart = false; continue; }
    if (c === sep) { endField(); continue; }
    if (c === "\r") { if (src[i + 1] === "\n") i++; endRow(); continue; }
    if (c === "\n") { endRow(); continue; }
    cur += c;
    fieldStart = false;
  }

  // A última linha só conta se havia algo nela.
  if (cur !== "" || row.length) endRow();

  // Linhas totalmente vazias não representam registro nenhum.
  return rows.filter((r) => r.some((cell) => cell !== ""));
}

/**
 * Registros a partir do CSV, um por linha, com o cabeçalho como chave.
 *
 * Nada some no caminho: cabeçalho repetido ganha número ("valor", "valor 2")
 * em vez de um sobrescrever o outro, e célula além do cabeçalho ganha uma
 * coluna própria ("coluna 4") em vez de ser descartada.
 */
export function csvToRecords(text: string): Record<string, string>[] {
  const rows = parseCsv(text);
  const raw = rows.shift() ?? [];
  const width = Math.max(raw.length, ...rows.map((r) => r.length));
  const seen = new Map<string, number>();
  const headers = Array.from({ length: width }, (_, i) => {
    const base = raw[i]?.trim() ? raw[i] : `coluna ${i + 1}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base} ${n}`;
  });
  return rows.map((row) =>
    Object.fromEntries(headers.map((h, i) => [h, row[i] ?? ""])),
  );
}

const escapeCsvField = (value: unknown): string => {
  const s = value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * CSV a partir de dados (JSON/YAML): uma linha por objeto, uma coluna por
 * chave. Uma lista de valores soltos (`[1, 2, 3]`) vira uma coluna "valor";
 * antes saía só linhas em branco.
 */
export function recordsToCsv(data: unknown): string {
  const arr = Array.isArray(data) ? data : [data];
  if (!arr.length) return "";
  const rows: Record<string, unknown>[] = arr.every(isRecord) ? arr : arr.map((v) => (isRecord(v) ? v : { valor: v }));
  const headers = Array.from(new Set(rows.flatMap((o) => Object.keys(o))));
  return [
    headers.map(escapeCsvField).join(","),
    ...rows.map((o) => headers.map((h) => escapeCsvField(o[h])).join(",")),
  ].join("\n");
}

/**
 * Tabela Markdown a partir de um CSV.
 *
 * As barras verticais dentro das células precisam de escape, senão uma célula
 * com "a|b" cria colunas fantasmas e desmonta a tabela ao ser renderizada.
 */
export function csvToMarkdownTable(text: string): string {
  const rows = parseCsv(text);
  if (!rows.length) return text;

  const escapeCell = (cell: string) => cell.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
  const [headers, ...body] = rows;
  const width = headers.length;
  const line = (cells: string[]) =>
    `| ${Array.from({ length: width }, (_, i) => escapeCell(cells[i] ?? "")).join(" | ")} |`;

  return [
    line(headers),
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...body.map(line),
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Texto simples e HTML
// ---------------------------------------------------------------------------

/** Escapa o que não pode ser texto solto dentro de HTML. */
export const escapeHtml = (text: string): string =>
  text
    // O & precisa vir primeiro, senão os escapes seguintes seriam escapados de novo.
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export function textToHtml(text: string): string {
  // pre-wrap: espaços e quebras exatamente como no texto, mas a linha longa
  // quebra na janela em vez de exigir rolagem lateral.
  return `<!doctype html><html><head><meta charset="utf-8"></head><body><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${escapeHtml(text)}</pre></body></html>`;
}

async function sanitizeHtml(html: string): Promise<string> {
  const DOMPurify = (await import("dompurify")).default;
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "input"],
    FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus", "onblur", "formaction"],
  });
}

/** Blocos separados por uma linha em branco, e os separados por uma quebra. */
const PARAGRAPH_BLOCKS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "ul", "ol", "dl", "table", "hr", "figure"]);
const LINE_BLOCKS = new Set([
  "div", "li", "tr", "dt", "dd", "section", "article", "header", "footer", "main", "nav", "aside",
  "address", "figcaption", "caption", "details", "summary", "fieldset", "legend",
]);
const INVISIBLE = new Set(["head", "style", "script", "template", "noscript", "title", "svg", "math"]);

/**
 * HTML -> texto puro, como a página mostra.
 *
 * `innerText` faria isso, mas depende de layout e devolve vazio num documento
 * que nunca foi exibido. A versão anterior usava `textContent`, que trazia a
 * formatação do código-fonte (recuos e quebras do HTML apareciam no texto),
 * juntava as células da tabela numa palavra só ("NomeIdade") e separava
 * parágrafos com uma quebra simples. Aqui o espaço é recolhido como o
 * navegador faz (menos em <pre>), parágrafo fica separado por linha em branco,
 * célula por tabulação e item de lista ganha o marcador ou o número.
 */
export async function htmlToPlainText(html: string): Promise<string> {
  const clean = await sanitizeHtml(html);
  const doc = new DOMParser().parseFromString(clean, "text/html");

  let out = "";
  let pending = 0; // quebras de linha devidas antes do próximo conteúdo
  let depth = 0; // listas abertas, para o recuo dos itens aninhados

  const flush = () => {
    if (pending && out) out = out.replace(/[ \n]+$/, "") + "\n".repeat(pending);
    pending = 0;
  };
  const emit = (s: string) => {
    flush();
    out += s;
  };
  const walk = (node: Node, pre: boolean) => {
    if (node.nodeType === Node.TEXT_NODE) {
      let s = (node as Text).data;
      if (!pre) {
        s = s.replace(/[ \t\n\r\f]+/g, " ");
        if (pending || !out || /[ \n\t]$/.test(out)) s = s.replace(/^ /, "");
        if (!s) return;
      }
      emit(s);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (INVISIBLE.has(tag) || el.hasAttribute("hidden") || /display\s*:\s*none/i.test(el.getAttribute("style") ?? "")) return;
    if (tag === "br") {
      emit("\n");
      return;
    }
    const gap = PARAGRAPH_BLOCKS.has(tag) ? 2 : LINE_BLOCKS.has(tag) ? 1 : 0;
    // Item dentro de lista vem em linha própria; a lista inteira, em parágrafo.
    const nested = (tag === "ul" || tag === "ol") && depth > 0;
    if (gap) pending = Math.max(pending, nested ? 1 : gap);
    if (tag === "li") {
      const list = el.parentElement;
      const indent = "  ".repeat(Math.max(0, depth - 1));
      if (list?.tagName.toLowerCase() === "ol") {
        const start = Number(list.getAttribute("start") ?? "1") || 1;
        const index = Array.from(list.children).filter((c) => c.tagName.toLowerCase() === "li").indexOf(el);
        emit(`${indent}${start + index}. `);
      } else emit(`${indent}• `);
    }
    if ((tag === "td" || tag === "th") && el.previousElementSibling) emit("\t");
    if (tag === "ul" || tag === "ol") depth++;
    el.childNodes.forEach((child) => walk(child, pre || tag === "pre" || tag === "textarea"));
    if (tag === "ul" || tag === "ol") depth--;
    if (gap) pending = Math.max(pending, nested ? 1 : gap);
  };
  walk(doc.body, false);

  return out
    .replace(/\u00a0/g, " ") // espaço inseparável vira espaço comum no texto puro
    .replace(/ +$/gm, "") // (a tabulação fica: é a célula vazia no fim da linha)
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+|\s+$/g, "");
}

/**
 * HTML -> Markdown usando o `turndown`.
 *
 * O projeto já dependia do turndown (o Notepad exporta Markdown com ele), mas
 * esta conversão usava expressões regulares próprias que perdiam listas,
 * tabelas, blocos de código e qualquer aninhamento.
 *
 * O turndown sozinho não conhece tabela nem tachado (são do GFM): a tabela
 * virava uma linha de texto por célula. As duas regras abaixo cobrem isso, e
 * CSS e script deixam de aparecer como texto.
 */
export async function htmlToMarkdown(html: string): Promise<string> {
  const clean = await sanitizeHtml(html);
  const TurndownService = (await import("turndown")).default;
  const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-" });
  td.remove(["style", "script", "noscript", "template", "title"]);
  td.addRule("tachado", {
    filter: ["del", "s"],
    replacement: (content) => (content.trim() ? `~~${content}~~` : content),
  });
  td.addRule("tabela", {
    filter: "table",
    replacement: (_content, node) => {
      const rows = Array.from((node as HTMLTableElement).rows);
      if (!rows.length) return "";
      // Célula vira uma linha só (quebra vira <br>, que o GFM aceita), com a
      // barra vertical escapada; colspan repete células vazias para a grade
      // continuar alinhada.
      const cells = rows.map((tr) =>
        Array.from(tr.cells).flatMap((c) => {
          const text = td.turndown(c.innerHTML).trim().replace(/\n+/g, "<br>").replace(/\|/g, "\\|");
          return [text, ...Array(Math.max(0, c.colSpan - 1)).fill("")];
        }),
      );
      const width = Math.max(...cells.map((r) => r.length));
      const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? "").join(" | ")} |`;
      return `\n\n${[line(cells[0]), line(Array(width).fill("---")), ...cells.slice(1).map(line)].join("\n")}\n\n`;
    },
  });
  return td.turndown(clean).trim();
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

/** Endereço seguro para link e imagem: nada de `javascript:` e afins. */
function safeUrl(url: string, image = false): string | null {
  const u = url.trim();
  if (/^(https?:|mailto:|#|\/|\.{0,2}\/)/i.test(u) || !/^[a-z][a-z0-9+.-]*:/i.test(u)) return u;
  if (image && /^data:image\/(png|jpe?g|gif|webp|svg\+xml);/i.test(u)) return u;
  return null;
}

const markdown = new Marked({
  gfm: true,
  // Quebra de linha simples é espaço, como no CommonMark e no GitHub (antes
  // virava <br>, e um parágrafo quebrado no editor saía picado).
  breaks: false,
  renderer: {
    // HTML escrito no meio do Markdown aparece como texto, nunca é executado.
    html(token) {
      return escapeHtml(token.text);
    },
    link(token) {
      const text = this.parser.parseInline(token.tokens);
      const href = safeUrl(token.href);
      if (!href) return text;
      return `<a href="${escapeHtml(href)}"${token.title ? ` title="${escapeHtml(token.title)}"` : ""}>${text}</a>`;
    },
    image(token) {
      const src = safeUrl(token.href, true);
      if (!src) return escapeHtml(token.text);
      return `<img src="${escapeHtml(src)}" alt="${escapeHtml(token.text)}"${token.title ? ` title="${escapeHtml(token.title)}"` : ""}/>`;
    },
  },
});

/**
 * Markdown -> HTML, no padrão GFM (o do GitHub), pelo `marked`.
 *
 * O analisador anterior, feito à mão, achatava listas aninhadas, não conhecia
 * tachado, lista de tarefas, link por referência nem escape com barra, e
 * transformava toda quebra de linha em <br>.
 */
export function mdToHtml(md: string): string {
  const body = markdown.parse(md.replace(/\r\n/g, "\n"), { async: false }) as string;
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>${body}</body></html>`;
}

/**
 * Texto puro -> Markdown que, exibido, mostra exatamente o mesmo texto.
 *
 * Devolver o texto como estava fazia um "*" virar itálico, um "# " no começo
 * da linha virar título, "1. " virar lista e as quebras de linha simples
 * sumirem na exibição. Aqui só o que mudaria a exibição é escapado, e cada
 * quebra de linha vira quebra forçada (dois espaços no fim).
 */
export function textToMarkdown(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  return lines
    .map((line, i) => {
      if (!line.trim()) return "";
      let l = line.replace(/([\\`*_[\]<>|~])/g, "\\$1");
      // Construções que só valem no começo da linha.
      l = l.replace(/^(\s*)(#{1,6})(?=\s|$)/, "$1\\$2");
      l = l.replace(/^(\s*)([-+])(?=\s)/, "$1\\$2");
      l = l.replace(/^(\s*)(\d+)([.)])(?=\s)/, "$1$2\\$3");
      l = l.replace(/^(\s*)(=+|-+)\s*$/, (_m, sp: string, run: string) => `${sp}\\${run}`);
      // Recuo de 4 espaços seria bloco de código: espaços que não somem.
      l = l.replace(/^ +/, (sp) => "&nbsp;".repeat(sp.length));
      const next = lines[i + 1];
      return next !== undefined && next.trim() ? `${l}  ` : l;
    })
    .join("\n");
}

/**
 * Markdown -> texto puro.
 *
 * A versão anterior fazia `text.replace(/[#*\`>-]/g, "")`, que apagava esses
 * caracteres do documento inteiro: "e-mail" virava "email", "2024-01-15" virava
 * "20240115" e qualquer hífen legítimo sumia. A seguinte, com expressões
 * regulares, ainda deixava escapes (`\*`), entidades (`&amp;`), sublinhado
 * (`_ênfase_`), tachado e tabelas pela metade. Aqui o próprio analisador do
 * Markdown separa marcação de conteúdo: some só o que não aparece na tela.
 */
export function mdToPlainText(md: string): string {
  const blocks = (tokens: Token[], indent = ""): string[] => {
    const out: string[] = [];
    for (const t of tokens) {
      switch (t.type) {
        case "heading":
        case "paragraph":
          out.push(indent + inlineText(t.tokens ?? []).replace(/\n/g, `\n${indent}`));
          break;
        case "text":
          // Texto solto de item de lista apertada.
          out.push(indent + (t.tokens ? inlineText(t.tokens) : decodeEntities(t.text)));
          break;
        case "code":
          out.push(t.text.replace(/^/gm, indent));
          break;
        case "blockquote":
          out.push(...blocks(t.tokens ?? [], indent));
          break;
        case "list": {
          const start = typeof t.start === "number" ? t.start : 1;
          const items = (t.items as Tokens.ListItem[]).map((item, n) => {
            const mark = t.ordered ? `${start + n}. ` : item.task ? (item.checked ? "[x] " : "[ ] ") : "";
            const body = blocks(item.tokens.filter((x) => x.type !== "checkbox"), "").join(item.loose ? "\n\n" : "\n");
            // Sublistas e parágrafos seguintes do item ficam recuados sob ele.
            return indent + mark + body.replace(/\n(?=.)/g, `\n${indent}  `);
          });
          out.push(items.join(t.loose ? "\n\n" : "\n"));
          break;
        }
        case "table": {
          // Células separadas por tabulação: coladas numa planilha, caem cada
          // uma na sua coluna.
          const row = (cells: Tokens.TableCell[]) => indent + cells.map((c) => inlineText(c.tokens)).join("\t");
          out.push([row(t.header), ...t.rows.map(row)].join("\n"));
          break;
        }
        case "html":
          out.push(indent + decodeEntities(t.text.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, "")).trim());
          break;
        default:
          break; // linha horizontal, espaço, definições de link
      }
    }
    return out.filter((b) => b.trim() !== "");
  };
  return blocks(Lexer.lex(md.replace(/\r\n/g, "\n"), { gfm: true })).join("\n\n").trim();
}

/** Texto visível de uma linha de Markdown: a marcação some, o conteúdo fica. */
function inlineText(tokens: Token[]): string {
  return tokens
    .map((t) => {
      switch (t.type) {
        case "escape":
          return t.text;
        case "text":
          return "tokens" in t && t.tokens ? inlineText(t.tokens) : decodeEntities(t.text);
        case "strong":
        case "em":
        case "del":
        case "link":
          return inlineText(t.tokens ?? []);
        case "codespan":
          return t.text;
        case "image":
          return t.text;
        case "br":
          return "\n";
        case "html":
          return /^<br\s*\/?>$/i.test(t.text) ? "\n" : "";
        default:
          return "raw" in t ? String(t.raw) : "";
      }
    })
    .join("");
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** `&amp;`, `&#233;` e afins viram o caractere que mostram. */
function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] !== "#") return ENTITIES[e.toLowerCase()] ?? m;
    const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
  });
}

// ---------------------------------------------------------------------------
// Orquestrador
// ---------------------------------------------------------------------------

const isData = (f: TextFmt) => f === "json" || f === "yaml" || f === "csv";

export async function convertText(text: string, from: TextFmt, to: TextFmt): Promise<string> {
  if (from === to) return text;

  if (isData(from) && isData(to)) {
    const yaml = await import("js-yaml");
    // YAML 1.2 (o "core"): "2024-01-15" continua texto. No esquema padrão do
    // js-yaml virava data, e o JSON recebia "2024-01-15T00:00:00.000Z". As
    // chaves de mesclagem (<<) e as marcas explícitas (!!timestamp...) seguem.
    // (o `types` existe no js-yaml 4, só falta na tipagem do @types/js-yaml)
    const T = (yaml as unknown as { types: Record<"merge" | "timestamp" | "binary" | "omap" | "pairs" | "set", InstanceType<typeof yaml.Type>> }).types;
    const schema = yaml.CORE_SCHEMA.extend({ implicit: [T.merge], explicit: [T.timestamp, T.binary, T.omap, T.pairs, T.set] });
    const data =
      from === "json" ? JSON.parse(text) :
      from === "yaml" ? yaml.load(text, { schema }) :
      csvToRecords(text);

    if (to === "json") return JSON.stringify(data, null, 2);
    // Sem dobrar linhas longas: o texto sai como estava, uma linha por valor.
    if (to === "yaml") return yaml.dump(data, { lineWidth: -1 });
    return recordsToCsv(data);
  }

  if (from === "md" && to === "html") return mdToHtml(text);
  if (from === "md" && to === "txt") return mdToPlainText(text);
  if (from === "html" && to === "md") return htmlToMarkdown(text);
  if (from === "html" && to === "txt") return htmlToPlainText(text);
  if (from === "txt" && to === "md") return textToMarkdown(text);
  if (from === "txt" && to === "html") return textToHtml(text);
  if (from === "csv" && to === "md") return csvToMarkdownTable(text);
  if (from === "json" && to === "txt") return text;

  throw new Error(`Conversão ${from} → ${to} não suportada`);
}
