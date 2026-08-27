/**
 * Catálogo de formatos da conversão de arquivos.
 *
 * Fica separado do componente porque três coisas diferentes precisam da mesma
 * verdade: a detecção do formato quando o usuário solta um arquivo, a grade
 * navegável agrupada por origem, e a lista de destinos válidos de cada origem.
 */

export type FormatKey =
  | "pdf"
  | "docx"
  | "xlsx"
  | "image"
  | "webp"
  | "avif"
  | "bmp"
  | "gif"
  | "heic"
  | "jfif"
  | "ico"
  | "svg"
  | "markdown"
  | "html"
  | "txt"
  | "csv"
  | "json"
  | "yaml"
  | "mp4";

export type GroupKey = "documentos" | "imagens" | "dados";

export interface FormatMeta {
  key: FormatKey;
  /** Nome completo, usado em títulos. */
  label: string;
  /** Nome curto, usado nos botões de destino. */
  short: string;
  /** Extensões aceitas, sempre com ponto e em minúsculas. */
  extensions: string[];
  /** Tipos MIME usados como segunda pista quando a extensão não diz nada. */
  mimes?: string[];
  group: GroupKey;
}

export const GROUPS: { key: GroupKey; label: string; description: string }[] = [
  { key: "documentos", label: "Documentos", description: "Word, PDF e Excel" },
  { key: "imagens", label: "Imagens", description: "JPG, PNG, WEBP, AVIF, HEIC, SVG e mais" },
  { key: "dados", label: "Texto & Dados", description: "Markdown, HTML, CSV, JSON e YAML" },
];

export const FORMATS: FormatMeta[] = [
  {
    key: "docx",
    label: "Word (DOCX)",
    short: "Word",
    extensions: [".docx"],
    mimes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    group: "documentos",
  },
  {
    key: "pdf",
    label: "PDF",
    short: "PDF",
    extensions: [".pdf"],
    mimes: ["application/pdf"],
    group: "documentos",
  },
  {
    key: "xlsx",
    label: "Excel (XLSX)",
    short: "Excel",
    extensions: [".xlsx", ".xls"],
    mimes: [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
    ],
    group: "documentos",
  },
  {
    key: "image",
    label: "Imagem (JPG / PNG)",
    short: "JPG/PNG",
    extensions: [".jpg", ".jpeg", ".png"],
    mimes: ["image/jpeg", "image/png"],
    group: "imagens",
  },
  { key: "webp", label: "WEBP", short: "WEBP", extensions: [".webp"], mimes: ["image/webp"], group: "imagens" },
  { key: "avif", label: "AVIF", short: "AVIF", extensions: [".avif"], mimes: ["image/avif"], group: "imagens" },
  { key: "bmp", label: "BMP", short: "BMP", extensions: [".bmp"], mimes: ["image/bmp"], group: "imagens" },
  { key: "gif", label: "GIF", short: "GIF", extensions: [".gif"], mimes: ["image/gif"], group: "imagens" },
  {
    key: "heic",
    label: "HEIC / HEIF",
    short: "HEIC",
    extensions: [".heic", ".heif"],
    mimes: ["image/heic", "image/heif"],
    group: "imagens",
  },
  { key: "jfif", label: "JFIF", short: "JFIF", extensions: [".jfif"], group: "imagens" },
  {
    key: "ico",
    label: "ICO (Favicon)",
    short: "ICO",
    extensions: [".ico"],
    mimes: ["image/x-icon", "image/vnd.microsoft.icon"],
    group: "imagens",
  },
  { key: "svg", label: "SVG", short: "SVG", extensions: [".svg"], mimes: ["image/svg+xml"], group: "imagens" },
  {
    key: "markdown",
    label: "Markdown",
    short: "Markdown",
    extensions: [".md", ".markdown"],
    mimes: ["text/markdown"],
    group: "dados",
  },
  { key: "html", label: "HTML", short: "HTML", extensions: [".html", ".htm"], mimes: ["text/html"], group: "dados" },
  { key: "txt", label: "Texto (TXT)", short: "TXT", extensions: [".txt"], mimes: ["text/plain"], group: "dados" },
  { key: "csv", label: "CSV", short: "CSV", extensions: [".csv"], mimes: ["text/csv"], group: "dados" },
  { key: "json", label: "JSON", short: "JSON", extensions: [".json"], mimes: ["application/json"], group: "dados" },
  { key: "yaml", label: "YAML", short: "YAML", extensions: [".yaml", ".yml"], group: "dados" },
  // Só existe como destino (GIF -> MP4); nunca é detectado como entrada.
  { key: "mp4", label: "MP4", short: "MP4", extensions: [], group: "imagens" },
];

const BY_KEY = new Map(FORMATS.map((f) => [f.key, f]));

export const formatMeta = (key: FormatKey): FormatMeta | undefined => BY_KEY.get(key);

/**
 * Destinos disponíveis para cada formato de origem.
 *
 * É a fonte única da verdade: a grade da tela e o registro de componentes do
 * `FileConverter` derivam daqui. O `as const` existe para o TypeScript conseguir
 * montar o tipo `ConversionKey` abaixo — assim, adicionar uma conversão aqui sem
 * criar a tela correspondente vira erro de compilação, e não um item morto.
 */
export const CONVERSION_GRAPH = {
  pdf: ["image", "docx", "xlsx"],
  docx: ["pdf"],
  xlsx: ["pdf"],
  image: ["pdf", "webp", "avif", "bmp", "ico", "gif", "jfif", "svg"],
  webp: ["image", "pdf"],
  avif: ["image", "webp"],
  bmp: ["image", "pdf"],
  gif: ["image", "pdf", "mp4"],
  heic: ["image", "webp"],
  jfif: ["image"],
  svg: ["image", "webp", "pdf"],
  markdown: ["pdf", "html", "txt"],
  html: ["markdown", "txt"],
  txt: ["markdown", "html"],
  csv: ["json", "yaml", "markdown"],
  json: ["csv", "yaml"],
  yaml: ["json", "csv"],
} as const satisfies Partial<Record<FormatKey, readonly FormatKey[]>>;

type Graph = typeof CONVERSION_GRAPH;

/** Todas as conversões existentes, no formato "origem->destino". */
export type ConversionKey = {
  [K in keyof Graph]: `${K & string}->${Graph[K][number] & string}`;
}[keyof Graph];

/**
 * Conversões que ganham o selo "Novo".
 *
 * Mora aqui, e não junto dos componentes, porque a tela de escolha precisa
 * desse dado e ela é carregada na página inicial — puxar o registro de
 * conversores só para saber quais são novos traria jsPDF e pdf.js junto.
 */
export const NEW_CONVERSIONS: ReadonlySet<ConversionKey> = new Set<ConversionKey>([
  "image->webp",
  "image->avif",
  "image->bmp",
  "image->ico",
  "image->gif",
  "webp->image",
  "webp->pdf",
  "avif->image",
  "avif->webp",
  "bmp->image",
  "bmp->pdf",
  "heic->image",
  "heic->webp",
  "gif->image",
  "gif->pdf",
  "gif->mp4",
  "svg->webp",
  "markdown->html",
  "markdown->txt",
  "html->markdown",
  "html->txt",
  "txt->markdown",
  "txt->html",
  "csv->json",
  "csv->yaml",
  "csv->markdown",
  "json->csv",
  "json->yaml",
  "yaml->json",
  "yaml->csv",
]);

/** Monta a chave "origem->destino" usada pelo registro de conversores. */
export const conversionKey = (from: FormatKey, to: FormatKey): ConversionKey =>
  `${from}->${to}` as ConversionKey;

const graphTargets = (key: FormatKey): readonly FormatKey[] =>
  (CONVERSION_GRAPH as Partial<Record<FormatKey, readonly FormatKey[]>>)[key] ?? [];

/** Formatos que podem ser usados como entrada, na ordem em que aparecem na grade. */
export const SOURCE_FORMATS: FormatKey[] = FORMATS
  .filter((f) => graphTargets(f.key).length > 0)
  .map((f) => f.key);

/** Extensões aceitas pelo seletor de arquivo, prontas para o atributo `accept`. */
export const ACCEPTED_EXTENSIONS: string = FORMATS
  .flatMap((f) => f.extensions)
  .join(",");

const normalizeExtension = (fileName: string): string => {
  const dot = fileName.lastIndexOf(".");
  return dot === -1 ? "" : fileName.slice(dot).toLowerCase();
};

/**
 * Descobre o formato de origem de um arquivo solto pelo usuário.
 *
 * A extensão manda, porque é o que o usuário enxerga e o que os navegadores
 * relatam de forma consistente. O tipo MIME entra só como desempate — no
 * Windows ele vem vazio para várias extensões, e para HEIC costuma vir errado.
 */
export function detectFormat(fileName: string, mimeType = ""): FormatKey | null {
  const ext = normalizeExtension(fileName);

  if (ext) {
    const byExt = FORMATS.find((f) => f.extensions.includes(ext));
    if (byExt) return byExt.key;
  }

  const mime = mimeType.toLowerCase().trim();
  if (mime) {
    const byMime = FORMATS.find((f) => f.mimes?.includes(mime));
    if (byMime) return byMime.key;
  }

  return null;
}

/** Destinos válidos para um arquivo já detectado. */
export function targetsFor(from: FormatKey | null): readonly FormatKey[] {
  if (!from) return [];
  return graphTargets(from);
}
