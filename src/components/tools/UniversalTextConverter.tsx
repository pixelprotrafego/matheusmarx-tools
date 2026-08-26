import { useState } from "react";
import { toast } from "sonner";
import Dropzone from "./shared/Dropzone";
import FileBadge from "./shared/FileBadge";
import ConvertButton from "./shared/ConvertButton";
import ErrorState from "./shared/ErrorState";
import ProgressState from "./shared/ProgressState";
import { downloadBlob, replaceExt } from "@/lib/download";
import { FileText } from "lucide-react";

export type TextFmt = "txt" | "md" | "html" | "csv" | "json" | "yaml";

interface Props {
  inputFmt: TextFmt;
  outputFmt: TextFmt;
  inputAccept: string;
}

function csvToJson(text: string): any[] {
  const rows = text.split(/\r?\n/).filter(Boolean).map((r) => {
    // simple CSV parser supporting quoted fields
    const out: string[] = [];
    let cur = ""; let inQ = false;
    for (let i = 0; i < r.length; i++) {
      const c = r[i];
      if (c === '"') { if (inQ && r[i + 1] === '"') { cur += '"'; i++; } else { inQ = !inQ; } }
      else if (c === "," && !inQ) { out.push(cur); cur = ""; }
      else cur += c;
    }
    out.push(cur);
    return out;
  });
  const headers = rows.shift() ?? [];
  return rows.map((row) => Object.fromEntries(headers.map((h, i) => [h, row[i] ?? ""])));
}

function jsonToCsv(data: any): string {
  const arr = Array.isArray(data) ? data : [data];
  if (!arr.length) return "";
  const headers = Array.from(new Set(arr.flatMap((o) => Object.keys(o))));
  const esc = (v: any) => {
    const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(","), ...arr.map((o) => headers.map((h) => esc(o[h])).join(","))].join("\n");
}

async function sanitize(html: string): Promise<string> {
  const DOMPurify = (await import("dompurify")).default;
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "input"],
    FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus", "onblur", "formaction"],
  });
}

function mdToHtml(md: string): string {
  // very small subset; for richer use, real lib is heavy. Adequate for round-trip.
  let html = md
    .replace(/^### (.*)$/gm, "<h3>$1</h3>")
    .replace(/^## (.*)$/gm, "<h2>$1</h2>")
    .replace(/^# (.*)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/!\[(.*?)\]\((.*?)\)/g, '<img alt="$1" src="$2"/>')
    .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2">$1</a>');
  html = html
    .split(/\n{2,}/)
    .map((p) => (/^<h\d|<ul|<ol|<pre/.test(p.trim()) ? p : `<p>${p.replace(/\n/g, "<br/>")}</p>`))
    .join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`;
}

async function htmlToText(html: string): Promise<string> {
  const clean = await sanitize(html);
  const doc = new DOMParser().parseFromString(clean, "text/html");
  return doc.body.innerText;
}

async function htmlToMd(html: string): Promise<string> {
  html = await sanitize(html);
  // minimal: strip tags but keep headings/links/bold
  let s = html
    .replace(/<h1[^>]*>(.*?)<\/h1>/gi, "# $1\n")
    .replace(/<h2[^>]*>(.*?)<\/h2>/gi, "## $1\n")
    .replace(/<h3[^>]*>(.*?)<\/h3>/gi, "### $1\n")
    .replace(/<strong[^>]*>(.*?)<\/strong>/gi, "**$1**")
    .replace(/<em[^>]*>(.*?)<\/em>/gi, "*$1*")
    .replace(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi, "[$2]($1)")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "");
  return s.replace(/\n{3,}/g, "\n\n").trim();
}

async function convertText(text: string, from: TextFmt, to: TextFmt): Promise<string> {
  // normalize to internal representation
  if (from === to) return text;

  // dataformats
  const isData = (f: TextFmt) => f === "json" || f === "yaml" || f === "csv";
  if (isData(from) && isData(to)) {
    const yaml = await import("js-yaml");
    const data =
      from === "json" ? JSON.parse(text) :
      from === "yaml" ? yaml.load(text) :
      csvToJson(text);
    if (to === "json") return JSON.stringify(data, null, 2);
    if (to === "yaml") return yaml.dump(data);
    return jsonToCsv(data);
  }

  // text/doc family
  if (from === "md" && to === "html") return await sanitize(mdToHtml(text));
  if (from === "md" && to === "txt") return text.replace(/[#*`>\-]/g, "").trim();
  if (from === "html" && to === "md") return await htmlToMd(text);
  if (from === "html" && to === "txt") return await htmlToText(text);
  if (from === "txt" && to === "md") return text;
  if (from === "txt" && to === "html") return `<!doctype html><pre>${text.replace(/</g, "&lt;")}</pre>`;

  // fallback: data <-> text (csv -> md table etc.)
  if (from === "csv" && to === "md") {
    const rows = csvToJson(text);
    if (!rows.length) return text;
    const headers = Object.keys(rows[0]);
    const sep = headers.map(() => "---").join(" | ");
    return [`| ${headers.join(" | ")} |`, `| ${sep} |`, ...rows.map((r) => `| ${headers.map((h) => r[h]).join(" | ")} |`)].join("\n");
  }
  if (from === "json" && to === "txt") return text;

  throw new Error(`Conversão ${from} → ${to} não suportada`);
}

const MIME: Record<TextFmt, string> = {
  txt: "text/plain", md: "text/markdown", html: "text/html",
  csv: "text/csv", json: "application/json", yaml: "application/x-yaml",
};

const UniversalTextConverter = ({ inputFmt, outputFmt, inputAccept }: Props) => {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const convert = async () => {
    if (!file) return;
    setLoading(true); setError(null);
    try {
      const text = await file.text();
      const out = await convertText(text, inputFmt, outputFmt);
      const blob = new Blob([out], { type: MIME[outputFmt] });
      downloadBlob(blob, replaceExt(file.name, outputFmt));
      toast.success("Conversão concluída!");
      setFile(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro";
      setError(msg);
      toast.error("Falha", { description: msg });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {!file ? (
        <Dropzone onFiles={(fs) => setFile(fs[0])} accept={inputAccept} title={`Arraste arquivo .${inputFmt}`} hint={`Saída: .${outputFmt}`} />
      ) : (
        <FileBadge file={file} icon={<FileText className="w-4 h-4 text-primary" />} onRemove={() => setFile(null)} />
      )}
      {loading && <ProgressState status="Convertendo..." />}
      {error && !loading && <ErrorState message={error} onRetry={convert} />}
      {file && !loading && !error && <ConvertButton onClick={convert} label={`Converter para ${outputFmt.toUpperCase()}`} />}
    </div>
  );
};

export default UniversalTextConverter;