import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import PdfToImage from "./PdfToImage";
import ImageToPdf from "./ImageToPdf";
import DocxToPdf from "./DocxToPdf";
import XlsxToPdf from "./XlsxToPdf";
import MarkdownToPdf from "./MarkdownToPdf";
import PdfToDocx from "./PdfToDocx";
import PdfToXlsx from "./PdfToXlsx";
import SvgToPdf from "./SvgToPdf";
import ImageToSvg from "./ImageToSvg";
import GifToMp4 from "./GifToMp4";
import UniversalImageConverter from "./UniversalImageConverter";
import UniversalTextConverter, { type TextFmt } from "./UniversalTextConverter";

type ConversionKey = string;

interface Conversion {
  label: string;
  isNew?: boolean;
  render: () => JSX.Element;
}

const ALL_FORMATS = [
  { value: "pdf", label: "PDF" },
  { value: "image", label: "Imagem (JPG/PNG)" },
  { value: "webp", label: "WEBP" },
  { value: "avif", label: "AVIF" },
  { value: "bmp", label: "BMP" },
  { value: "gif", label: "GIF" },
  { value: "ico", label: "ICO (Favicon)" },
  { value: "heic", label: "HEIC / HEIF" },
  { value: "jfif", label: "JFIF" },
  { value: "svg", label: "SVG" },
  { value: "docx", label: "DOCX (Word)" },
  { value: "xlsx", label: "XLSX (Excel)" },
  { value: "markdown", label: "Markdown" },
  { value: "html", label: "HTML" },
  { value: "txt", label: "TXT" },
  { value: "csv", label: "CSV" },
  { value: "json", label: "JSON" },
  { value: "yaml", label: "YAML" },
];

const IMAGE_ACCEPT: Record<string, string> = {
  image: "image/png,image/jpeg,.png,.jpg,.jpeg",
  webp: "image/webp,.webp",
  avif: "image/avif,.avif",
  bmp: "image/bmp,.bmp",
  gif: "image/gif,.gif",
  ico: "image/x-icon,.ico",
  heic: ".heic,.heif,image/heic,image/heif",
  jfif: ".jfif,image/jpeg",
  svg: "image/svg+xml,.svg",
};

const img = (inputExt: string, outputExt: string) => () => (
  <UniversalImageConverter
    inputAccept={IMAGE_ACCEPT[inputExt] ?? IMAGE_ACCEPT.image}
    inputLabel={inputExt.toUpperCase()}
    inputExt={inputExt}
    outputExt={outputExt === "image" ? "png" : outputExt}
  />
);

const txt = (i: TextFmt, o: TextFmt, accept: string) => () => (
  <UniversalTextConverter inputFmt={i} outputFmt={o} inputAccept={accept} />
);

const CONVERSIONS: Record<ConversionKey, Conversion> = {
  // PDF
  "pdf->image": { label: "PDF → Imagem (PNG/JPG)", render: () => <PdfToImage /> },
  "pdf->docx": { label: "PDF → DOCX (Word)", render: () => <PdfToDocx /> },
  "pdf->xlsx": { label: "PDF → XLSX (Excel)", render: () => <PdfToXlsx /> },

  // Image -> X
  "image->pdf": { label: "Imagem → PDF", render: () => <ImageToPdf /> },
  "image->jfif": { label: "Imagem → JFIF", render: img("image", "jfif") },
  "image->svg": { label: "Imagem → SVG", render: () => <ImageToSvg /> },
  "image->webp": { label: "Imagem → WEBP", isNew: true, render: img("image", "webp") },
  "image->avif": { label: "Imagem → AVIF", isNew: true, render: img("image", "avif") },
  "image->bmp": { label: "Imagem → BMP", isNew: true, render: img("image", "bmp") },
  "image->ico": { label: "Imagem → ICO (Favicon)", isNew: true, render: img("image", "ico") },
  "image->gif": { label: "Imagem → GIF", isNew: true, render: img("image", "gif") },

  // WEBP/AVIF/BMP/JFIF/HEIC/ICO/GIF inputs
  "webp->image": { label: "WEBP → PNG/JPG", isNew: true, render: img("webp", "png") },
  "webp->pdf": { label: "WEBP → PDF", isNew: true, render: img("webp", "jpg") },
  "avif->image": { label: "AVIF → PNG/JPG", isNew: true, render: img("avif", "png") },
  "avif->webp": { label: "AVIF → WEBP", isNew: true, render: img("avif", "webp") },
  "bmp->image": { label: "BMP → PNG/JPG", isNew: true, render: img("bmp", "png") },
  "bmp->pdf": { label: "BMP → PDF", isNew: true, render: img("bmp", "jpg") },
  "jfif->image": { label: "JFIF → JPEG/PNG", render: img("jfif", "png") },
  "heic->image": { label: "HEIC → JPG/PNG", isNew: true, render: img("heic", "jpg") },
  "heic->webp": { label: "HEIC → WEBP", isNew: true, render: img("heic", "webp") },
  "gif->image": { label: "GIF → PNG (1º frame)", isNew: true, render: img("gif", "png") },
  "gif->pdf": { label: "GIF → PDF", isNew: true, render: img("gif", "jpg") },
  "gif->mp4": { label: "GIF → MP4", isNew: true, render: () => <GifToMp4 /> },

  // SVG outputs
  "svg->image": { label: "SVG → PNG/JPG", render: img("svg", "png") },
  "svg->webp": { label: "SVG → WEBP", isNew: true, render: img("svg", "webp") },
  "svg->pdf": { label: "SVG → PDF", render: () => <SvgToPdf /> },

  // Docs
  "docx->pdf": { label: "DOCX → PDF", render: () => <DocxToPdf /> },
  "xlsx->pdf": { label: "XLSX → PDF", render: () => <XlsxToPdf /> },
  "markdown->pdf": { label: "Markdown → PDF", render: () => <MarkdownToPdf /> },

  // Text/Data family
  "markdown->html": { label: "Markdown → HTML", isNew: true, render: txt("md", "html", ".md,text/markdown") },
  "markdown->txt": { label: "Markdown → TXT", isNew: true, render: txt("md", "txt", ".md,text/markdown") },
  "html->markdown": { label: "HTML → Markdown", isNew: true, render: txt("html", "md", ".html,text/html") },
  "html->txt": { label: "HTML → TXT", isNew: true, render: txt("html", "txt", ".html,text/html") },
  "txt->markdown": { label: "TXT → Markdown", isNew: true, render: txt("txt", "md", ".txt,text/plain") },
  "txt->html": { label: "TXT → HTML", isNew: true, render: txt("txt", "html", ".txt,text/plain") },
  "csv->json": { label: "CSV → JSON", isNew: true, render: txt("csv", "json", ".csv,text/csv") },
  "csv->yaml": { label: "CSV → YAML", isNew: true, render: txt("csv", "yaml", ".csv,text/csv") },
  "csv->markdown": { label: "CSV → Markdown (tabela)", isNew: true, render: txt("csv", "md", ".csv,text/csv") },
  "json->csv": { label: "JSON → CSV", isNew: true, render: txt("json", "csv", ".json,application/json") },
  "json->yaml": { label: "JSON → YAML", isNew: true, render: txt("json", "yaml", ".json,application/json") },
  "yaml->json": { label: "YAML → JSON", isNew: true, render: txt("yaml", "json", ".yaml,.yml") },
  "yaml->csv": { label: "YAML → CSV", isNew: true, render: txt("yaml", "csv", ".yaml,.yml") },
};

const AVAILABLE_OUTPUTS: Record<string, string[]> = {
  pdf: ["image", "docx", "xlsx"],
  image: ["pdf", "webp", "avif", "bmp", "ico", "gif", "jfif", "svg"],
  webp: ["image", "pdf"],
  avif: ["image", "webp"],
  bmp: ["image", "pdf"],
  gif: ["image", "pdf", "mp4"],
  heic: ["image", "webp"],
  jfif: ["image"],
  svg: ["image", "webp", "pdf"],
  docx: ["pdf"],
  xlsx: ["pdf"],
  markdown: ["pdf", "html", "txt"],
  html: ["markdown", "txt"],
  txt: ["markdown", "html"],
  csv: ["json", "yaml", "markdown"],
  json: ["csv", "yaml"],
  yaml: ["json", "csv"],
};

const FileConverter = () => {
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");

  const conversionKey = `${from}->${to}`;
  const conversion = CONVERSIONS[conversionKey];
  const availableOutputs = from ? (AVAILABLE_OUTPUTS[from] || []) : [];
  const toFormats = ALL_FORMATS.filter((f) => availableOutputs.includes(f.value));

  const handleFromChange = (val: string) => {
    setFrom(val);
    setTo("");
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label className="text-muted-foreground">Formato de entrada</Label>
          <Select value={from} onValueChange={handleFromChange}>
            <SelectTrigger>
              <SelectValue placeholder="Selecione o tipo de arquivo" />
            </SelectTrigger>
            <SelectContent>
              {ALL_FORMATS.map((f) => (
                <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label className="text-muted-foreground">Converter para</Label>
          <Select value={to} onValueChange={setTo} disabled={!from}>
            <SelectTrigger>
              <SelectValue placeholder={from ? "Selecione o formato de saída" : "Escolha a entrada primeiro"} />
            </SelectTrigger>
            <SelectContent>
              {toFormats.map((f) => {
                const key = `${from}->${f.value}`;
                const conv = CONVERSIONS[key];
                return (
                  <SelectItem key={f.value} value={f.value}>
                    <span className="flex items-center gap-2">
                      {f.label}
                      {conv?.isNew && <Badge variant="secondary" className="text-xs px-1.5 py-0">Novo</Badge>}
                    </span>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
      </div>

      {conversion && (
        <div className="animate-fade-in">
          <div className="flex items-center gap-2 mb-4">
            <div className="line-gold flex-1" />
            <span className="text-sm text-muted-foreground font-medium">
              {conversion.label}
              {conversion.isNew && <Badge variant="secondary" className="ml-2 text-xs px-1.5 py-0">Novo</Badge>}
            </span>
            <div className="line-gold flex-1" />
          </div>
          {conversion.render()}
        </div>
      )}

      {from && to && !conversion && (
        <p className="text-center text-muted-foreground py-8">
          Combinação não suportada ainda.
        </p>
      )}

      {!from && (
        <p className="text-center text-muted-foreground py-8">
          Selecione o formato de entrada para começar.
        </p>
      )}
    </div>
  );
};

export default FileConverter;
