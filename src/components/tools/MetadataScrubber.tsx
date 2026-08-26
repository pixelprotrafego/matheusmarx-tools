import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ShieldOff, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import Dropzone from "./shared/Dropzone";
import {
  scanMetadata,
  scrubMetadata,
  type MetaScanResult,
} from "@/lib/metadata-scrubber";
import { downloadBlob, replaceExt } from "@/lib/download";

const MetadataScrubber = () => {
  const [file, setFile] = useState<File | null>(null);
  const [scan, setScan] = useState<MetaScanResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [heicFormat, setHeicFormat] = useState<"jpg" | "png">("jpg");

  const onFiles = async (files: File[]) => {
    const f = files[0];
    if (!f) return;
    setFile(f);
    setDone(false);
    setScan(null);
    try {
      const result = await scanMetadata(f);
      if (result.kind === "unknown") {
        toast.error("Formato não suportado", {
          description: "Use JPG, PNG, WEBP, HEIC ou PDF.",
        });
        return;
      }
      setScan(result);
    } catch (e) {
      toast.error("Falha ao ler metadados", {
        description: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const clean = async () => {
    if (!file || !scan) return;
    setBusy(true);
    try {
      const blob = await scrubMetadata(file, scan.kind, heicFormat);
      const ext =
        scan.kind === "jpg" ? "jpg" :
        scan.kind === "png" ? "png" :
        scan.kind === "webp" ? "webp" :
        scan.kind === "heic" ? heicFormat : "pdf";
      downloadBlob(blob, replaceExt(file.name, ext).replace(/(\.[^.]+)$/, "-limpo$1"));
      setDone(true);
      toast.success("Metadados removidos");
    } catch (e) {
      toast.error("Falha ao limpar", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setFile(null);
    setScan(null);
    setDone(false);
  };

  const sensitiveCount = scan?.fields.filter((f) => f.sensitive).length ?? 0;

  return (
    <div className="space-y-4">
      <Alert>
        <ShieldOff className="h-4 w-4" />
        <AlertDescription>
          Remove EXIF, GPS, autor, software e XMP de imagens (JPG/PNG/WEBP/HEIC) e metadados de PDF.
          HEIC é convertido para JPG ou PNG limpo (escolha abaixo).
          O arquivo nunca sai do seu navegador.
        </AlertDescription>
      </Alert>

      {!file && (
        <Dropzone
          onFiles={onFiles}
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif,application/pdf"
          title="Solte uma imagem ou PDF aqui"
          hint="JPG, PNG, WEBP, HEIC ou PDF — 1 arquivo por vez"
        />
      )}

      {file && scan && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-sm">
              <span className="font-medium">{file.name}</span>{" "}
              <span className="text-muted-foreground">
                ({(file.size / 1024).toFixed(1)} KB · {scan.kind.toUpperCase()})
              </span>
            </div>
            <Button variant="ghost" size="sm" onClick={reset}>Trocar arquivo</Button>
          </div>

          {scan.fields.length === 0 ? (
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertDescription>
                Este arquivo já está limpo — nenhum metadado relevante detectado.
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium">Metadados detectados ({scan.fields.length})</h3>
                {sensitiveCount > 0 && (
                  <Badge variant="destructive" className="gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    {sensitiveCount} sensível{sensitiveCount > 1 ? "is" : ""}
                  </Badge>
                )}
              </div>
              <div className="rounded-md border border-border max-h-72 overflow-auto">
                <table className="w-full text-sm">
                  <tbody>
                    {scan.fields.map((f, idx) => (
                      <tr key={idx} className="border-b border-border last:border-0">
                        <td className={`px-3 py-2 font-mono text-xs whitespace-nowrap ${f.sensitive ? "text-destructive" : "text-muted-foreground"}`}>
                          {f.key}
                        </td>
                        <td className="px-3 py-2 break-all">{f.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {scan.fields.length > 0 && (
            <div className="space-y-3">
              {scan.kind === "heic" && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm text-muted-foreground">Formato de saída:</span>
                  <Button
                    type="button"
                    size="sm"
                    variant={heicFormat === "jpg" ? "default" : "outline"}
                    onClick={() => setHeicFormat("jpg")}
                  >
                    JPG
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={heicFormat === "png" ? "default" : "outline"}
                    onClick={() => setHeicFormat("png")}
                  >
                    PNG
                  </Button>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
              <Button onClick={clean} disabled={busy} className="gap-2">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldOff className="w-4 h-4" />}
                {busy ? "Limpando..." : "Limpar metadados e baixar"}
              </Button>
              {done && (
                <span className="text-sm text-muted-foreground self-center inline-flex items-center gap-1">
                  <CheckCircle2 className="w-4 h-4 text-primary" /> Arquivo limpo baixado.
                </span>
              )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default MetadataScrubber;