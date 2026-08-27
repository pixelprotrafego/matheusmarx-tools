import type { ConversionKey } from "@/lib/convert-formats";
import { DroppedFileContext } from "../shared/dropped-file";
import PdfToImage from "../PdfToImage";
import ImageToPdf from "../ImageToPdf";
import DocxToPdf from "../DocxToPdf";
import XlsxToPdf from "../XlsxToPdf";
import MarkdownToPdf from "../MarkdownToPdf";
import PdfToDocx from "../PdfToDocx";
import PdfToXlsx from "../PdfToXlsx";
import SvgToPdf from "../SvgToPdf";
import ImageToSvg from "../ImageToSvg";
import GifToMp4 from "../GifToMp4";
import UniversalImageConverter from "../UniversalImageConverter";
import UniversalTextConverter, { type TextFmt } from "../UniversalTextConverter";

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

/**
 * Uma tela para cada aresta do grafo de conversões.
 *
 * O tipo é `Record<ConversionKey, ...>`, e `ConversionKey` sai do próprio
 * CONVERSION_GRAPH: adicionar uma conversão ao catálogo sem criar a tela aqui
 * quebra a compilação, em vez de virar um item de menu que não abre nada.
 */
const CONVERSIONS: Record<ConversionKey, () => JSX.Element> = {
  "pdf->image": () => <PdfToImage />,
  "pdf->docx": () => <PdfToDocx />,
  "pdf->xlsx": () => <PdfToXlsx />,

  "image->pdf": () => <ImageToPdf />,
  "image->jfif": img("image", "jfif"),
  "image->svg": () => <ImageToSvg />,
  "image->webp": img("image", "webp"),
  "image->avif": img("image", "avif"),
  "image->bmp": img("image", "bmp"),
  "image->ico": img("image", "ico"),
  "image->gif": img("image", "gif"),

  "webp->image": img("webp", "png"),
  "webp->pdf": img("webp", "jpg"),
  "avif->image": img("avif", "png"),
  "avif->webp": img("avif", "webp"),
  "bmp->image": img("bmp", "png"),
  "bmp->pdf": img("bmp", "jpg"),
  "jfif->image": img("jfif", "png"),
  "heic->image": img("heic", "jpg"),
  "heic->webp": img("heic", "webp"),
  "gif->image": img("gif", "png"),
  "gif->pdf": img("gif", "jpg"),
  "gif->mp4": () => <GifToMp4 />,

  "svg->image": img("svg", "png"),
  "svg->webp": img("svg", "webp"),
  "svg->pdf": () => <SvgToPdf />,

  "docx->pdf": () => <DocxToPdf />,
  "xlsx->pdf": () => <XlsxToPdf />,
  "markdown->pdf": () => <MarkdownToPdf />,

  "markdown->html": txt("md", "html", ".md,text/markdown"),
  "markdown->txt": txt("md", "txt", ".md,text/markdown"),
  "html->markdown": txt("html", "md", ".html,text/html"),
  "html->txt": txt("html", "txt", ".html,text/html"),
  "txt->markdown": txt("txt", "md", ".txt,text/plain"),
  "txt->html": txt("txt", "html", ".txt,text/plain"),
  "csv->json": txt("csv", "json", ".csv,text/csv"),
  "csv->yaml": txt("csv", "yaml", ".csv,text/csv"),
  "csv->markdown": txt("csv", "md", ".csv,text/csv"),
  "json->csv": txt("json", "csv", ".json,application/json"),
  "json->yaml": txt("json", "yaml", ".json,application/json"),
  "yaml->json": txt("yaml", "json", ".yaml,.yml"),
  "yaml->csv": txt("yaml", "csv", ".yaml,.yml"),
};

interface Props {
  conversion: ConversionKey;
  /** Arquivo vindo da tela de escolha; o conversor o adota e não pede de novo. */
  file: File | null;
}

const ConverterStage = ({ conversion, file }: Props) => {
  const render = CONVERSIONS[conversion];
  if (!render) return null;

  return (
    <DroppedFileContext.Provider value={file}>
      {render()}
    </DroppedFileContext.Provider>
  );
};

export default ConverterStage;
