/**
 * Motor das conversões de texto e dados (TXT, Markdown, HTML, CSV, JSON, YAML).
 *
 * Estava dentro do componente e por isso nunca tinha sido testado. Extraído
 * para cá, é função pura e o teste cobre cada aresta — que foi como os defeitos
 * de fidelidade descritos nos comentários abaixo apareceram.
 */

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
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQuotes = false;

  // O BOM que o Excel escreve viraria parte do primeiro cabeçalho.
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const endField = () => { row.push(cur); cur = ""; };
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

    if (c === '"') { inQuotes = true; continue; }
    if (c === ",") { endField(); continue; }
    if (c === "\r") { if (src[i + 1] === "\n") i++; endRow(); continue; }
    if (c === "\n") { endRow(); continue; }
    cur += c;
  }

  // A última linha só conta se havia algo nela.
  if (cur !== "" || row.length) endRow();

  // Linhas totalmente vazias não representam registro nenhum.
  return rows.filter((r) => r.some((cell) => cell !== ""));
}

export function csvToRecords(text: string): Record<string, string>[] {
  const rows = parseCsv(text);
  const headers = rows.shift() ?? [];
  return rows.map((row) =>
    Object.fromEntries(headers.map((h, i) => [h, row[i] ?? ""])),
  );
}

const escapeCsvField = (value: unknown): string => {
  const s = value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function recordsToCsv(data: unknown): string {
  const arr = (Array.isArray(data) ? data : [data]) as Record<string, unknown>[];
  if (!arr.length) return "";
  const headers = Array.from(new Set(arr.flatMap((o) => Object.keys(o ?? {}))));
  return [
    headers.map(escapeCsvField).join(","),
    ...arr.map((o) => headers.map((h) => escapeCsvField(o?.[h])).join(",")),
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
  return `<!doctype html><html><head><meta charset="utf-8"></head><body><pre>${escapeHtml(text)}</pre></body></html>`;
}

async function sanitizeHtml(html: string): Promise<string> {
  const DOMPurify = (await import("dompurify")).default;
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "input"],
    FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus", "onblur", "formaction"],
  });
}

/**
 * HTML -> texto puro.
 *
 * A versão anterior usava `innerText`, que depende de layout e devolve vazio
 * num documento que nunca foi renderizado. Aqui a separação de blocos é feita
 * na marra, o que também torna o resultado igual em qualquer navegador.
 */
export async function htmlToPlainText(html: string): Promise<string> {
  const clean = await sanitizeHtml(html);
  const doc = new DOMParser().parseFromString(clean, "text/html");

  doc.querySelectorAll("br").forEach((br) => br.replaceWith(doc.createTextNode("\n")));
  doc.querySelectorAll("p, div, li, tr, h1, h2, h3, h4, h5, h6, blockquote, pre").forEach((el) => {
    el.appendChild(doc.createTextNode("\n"));
  });

  return (doc.body.textContent ?? "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * HTML -> Markdown usando o `turndown`.
 *
 * O projeto já dependia do turndown (o Notepad exporta Markdown com ele), mas
 * esta conversão usava expressões regulares próprias que perdiam listas,
 * tabelas, blocos de código e qualquer aninhamento.
 */
export async function htmlToMarkdown(html: string): Promise<string> {
  const clean = await sanitizeHtml(html);
  const TurndownService = (await import("turndown")).default;
  const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-" });
  return td.turndown(clean).trim();
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

const inlineMd = (text: string): string => {
  // Os trechos de código são retirados antes das outras regras: dentro deles
  // um asterisco é um asterisco, não uma marcação de itálico.
  const code: string[] = [];
  let out = text.replace(/`([^`]+)`/g, (_, c: string) => {
    code.push(c);
    return `\uE000${code.length - 1}\uE000`;
  });

  out = escapeHtml(out)
    .replace(/!\[(.*?)\]\((.*?)\)/g, '<img alt="$1" src="$2"/>')
    .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/__(.+?)__/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+?)\*/g, "$1<em>$2</em>")
    .replace(/(^|[^_])_([^_]+?)_/g, "$1<em>$2</em>");

  return out.replace(/\uE000(\d+)\uE000/g, (_, i: string) => `<code>${escapeHtml(code[Number(i)])}</code>`);
};

/**
 * Markdown -> HTML.
 *
 * A versão anterior só entendia títulos, negrito, itálico, código curto e
 * links: listas viravam parágrafo com hífen, blocos de código perdiam a
 * formatação e tabelas saíam como texto solto. Este analisador percorre o
 * documento por blocos e cobre também listas, citações, linha horizontal,
 * blocos cercados e tabelas no estilo GFM.
 */
export function mdToHtml(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let i = 0;

  const isTableSeparator = (line: string) => /^\s*\|?[\s:-]*-[\s:|-]*\|?\s*$/.test(line) && line.includes("-");

  while (i < lines.length) {
    const line = lines[i];

    // Bloco de código cercado
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i++]);
      i++; // consome a cerca final
      const lang = fence[1] ? ` class="language-${fence[1]}"` : "";
      html.push(`<pre><code${lang}>${escapeHtml(body.join("\n"))}</code></pre>`);
      continue;
    }

    if (!line.trim()) { i++; continue; }

    // Linha horizontal
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { html.push("<hr/>"); i++; continue; }

    // Título
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      html.push(`<h${level}>${inlineMd(heading[2].trim())}</h${level}>`);
      i++;
      continue;
    }

    // Tabela GFM: linha de cabeçalho seguida da linha de separação
    if (line.includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const cells = (row: string) =>
        row.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, "|").trim());
      const head = cells(line);
      i += 2;
      const body: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) body.push(cells(lines[i++]));

      html.push(
        "<table><thead><tr>" +
          head.map((c) => `<th>${inlineMd(c)}</th>`).join("") +
          "</tr></thead><tbody>" +
          body.map((r) => `<tr>${head.map((_, c) => `<td>${inlineMd(r[c] ?? "")}</td>`).join("")}</tr>`).join("") +
          "</tbody></table>",
      );
      continue;
    }

    // Citação
    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ""));
      html.push(`<blockquote>${mdToHtml(body.join("\n"))}</blockquote>`);
      continue;
    }

    // Listas
    const bullet = /^\s*[-*+]\s+(.*)$/;
    const ordered = /^\s*\d+[.)]\s+(.*)$/;
    if (bullet.test(line) || ordered.test(line)) {
      const isOrdered = ordered.test(line);
      const pattern = isOrdered ? ordered : bullet;
      const items: string[] = [];
      while (i < lines.length && pattern.test(lines[i])) {
        items.push(lines[i].match(pattern)![1]);
        i++;
      }
      const tag = isOrdered ? "ol" : "ul";
      html.push(`<${tag}>${items.map((it) => `<li>${inlineMd(it)}</li>`).join("")}</${tag}>`);
      continue;
    }

    // Parágrafo: junta até a próxima linha em branco
    const paragraph: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|\s*>)/.test(lines[i])) {
      paragraph.push(lines[i++]);
    }
    html.push(`<p>${inlineMd(paragraph.join("\n")).replace(/\n/g, "<br/>")}</p>`);
  }

  return `<!doctype html><html><head><meta charset="utf-8"></head><body>${html.join("\n")}</body></html>`;
}

/**
 * Markdown -> texto puro.
 *
 * A versão anterior fazia `text.replace(/[#*\`>-]/g, "")`, que apagava esses
 * caracteres do documento inteiro: "e-mail" virava "email", "2024-01-15" virava
 * "20240115" e qualquer hífen legítimo sumia. Aqui só a marcação é removida,
 * e sempre ancorada na posição em que ela realmente tem significado.
 */
export function mdToPlainText(md: string): string {
  return md
    .replace(/\r\n/g, "\n")
    // blocos de código: mantém o conteúdo, tira as cercas
    .replace(/^```.*$/gm, "")
    // títulos, citações e marcadores de lista, sempre no início da linha
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*(\d+)[.)]\s+/gm, "$1. ")
    // linha horizontal
    .replace(/^\s*([-*_])(\s*\1){2,}\s*$/gm, "")
    // imagens e links viram o texto visível
    .replace(/!\[(.*?)\]\(.*?\)/g, "$1")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    // ênfase e código curto: só os pares, nunca caracteres soltos
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/(^|[^*])\*([^*]+?)\*/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------------------------------------------------------------------------
// Orquestrador
// ---------------------------------------------------------------------------

const isData = (f: TextFmt) => f === "json" || f === "yaml" || f === "csv";

export async function convertText(text: string, from: TextFmt, to: TextFmt): Promise<string> {
  if (from === to) return text;

  if (isData(from) && isData(to)) {
    const yaml = await import("js-yaml");
    const data =
      from === "json" ? JSON.parse(text) :
      from === "yaml" ? yaml.load(text) :
      csvToRecords(text);

    if (to === "json") return JSON.stringify(data, null, 2);
    if (to === "yaml") return yaml.dump(data);
    return recordsToCsv(data);
  }

  if (from === "md" && to === "html") return mdToHtml(text);
  if (from === "md" && to === "txt") return mdToPlainText(text);
  if (from === "html" && to === "md") return htmlToMarkdown(text);
  if (from === "html" && to === "txt") return htmlToPlainText(text);
  if (from === "txt" && to === "md") return text;
  if (from === "txt" && to === "html") return textToHtml(text);
  if (from === "csv" && to === "md") return csvToMarkdownTable(text);
  if (from === "json" && to === "txt") return text;

  throw new Error(`Conversão ${from} → ${to} não suportada`);
}
