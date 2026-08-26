import { useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Upload,
  Download,
  Loader2,
  X,
  FileVideo,
  Combine,
  AlertTriangle,
  RotateCcw,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { toast } from "sonner";
import { getFFmpeg, resetFFmpeg } from "@/lib/ffmpeg";
import { BATCH_LIMITS, checkBatch } from "@/lib/validate-file";

const VideoJoiner = () => {
  const [files, setFiles] = useState<File[]>([]);
  const [joining, setJoining] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("");
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fastMode, setFastMode] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((list: FileList | File[]) => {
    const valid = Array.from(list).filter((f) => f.type.startsWith("video/"));
    if (valid.length === 0) {
      toast.error("Selecione arquivos de vídeo");
      return;
    }
    setFiles((prev) => [...prev, ...valid]);
    setResultUrl(null);
    setError(null);
  }, []);

  const removeAt = (idx: number) =>
    setFiles((prev) => prev.filter((_, i) => i !== idx));

  const move = (idx: number, dir: -1 | 1) => {
    setFiles((prev) => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  };

  const join = async () => {
    if (files.length < 2) {
      toast.error("Adicione ao menos 2 vídeos");
      return;
    }
    const batchErr = checkBatch(files.length, BATCH_LIMITS.videosPerJoin, "vídeos");
    if (batchErr) { toast.error(batchErr); return; }
    setJoining(true);
    setProgress(0);
    setError(null);
    setStatusText("Inicializando motor de vídeo...");

    try {
      const ffmpeg = await getFFmpeg((p) => setProgress(p));
      const { fetchFile } = await import("@ffmpeg/util");

      setStatusText("Carregando vídeos...");
      const names: string[] = [];
      // Preserva extensão original — forçar .mp4 corrompe TS/MKV/WEBM.
      const extOf = (n: string) => {
        const m = /\.([a-z0-9]+)$/i.exec(n);
        return m ? m[1].toLowerCase() : "mp4";
      };
      const allExts = files.map((f) => extOf(f.name));
      const sameContainer = allExts.every((e) => e === allExts[0]);
      let effectiveFast = fastMode;
      if (fastMode && !sameContainer) {
        toast.message("Containers diferentes detectados — usando modo seguro automaticamente.");
        effectiveFast = false;
      }
      for (let i = 0; i < files.length; i++) {
        const name = `in_${i}.${allExts[i]}`;
        await ffmpeg.writeFile(name, await fetchFile(files[i]));
        names.push(name);
      }

      let exitCode: number;

      if (effectiveFast) {
        setStatusText("Concatenando (modo rápido, sem re-encode)...");
        const list = names.map((n) => `file '${n}'`).join("\n");
        await ffmpeg.writeFile("list.txt", new TextEncoder().encode(list));
        const outName = `output.${allExts[0]}`;
        exitCode = await ffmpeg.exec([
          "-f", "concat",
          "-safe", "0",
          "-i", "list.txt",
          "-c", "copy",
          outName,
        ]);
        if (exitCode === 0) {
          (window as any).__joinerOut = outName;
        }
        try { await ffmpeg.deleteFile("list.txt"); } catch {}
      } else {
        setStatusText("Concatenando e re-encodando (modo seguro)...");
        const args: string[] = [];
        names.forEach((n) => {
          args.push("-i", n);
        });
        // normalize to 1920x1080 max, keep aspect, pad if needed; SAR=1
        const filter = files
          .map(
            (_, i) =>
              `[${i}:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v${i}];[${i}:a]aresample=async=1:first_pts=0[a${i}]`
          )
          .join(";");
        const concatInputs = files
          .map((_, i) => `[v${i}][a${i}]`)
          .join("");
        const fullFilter = `${filter};${concatInputs}concat=n=${files.length}:v=1:a=1[v][a]`;
        args.push(
          "-filter_complex", fullFilter,
          "-map", "[v]",
          "-map", "[a]",
          "-c:v", "libx264",
          "-preset", "veryfast",
          "-crf", "23",
          "-c:a", "aac",
          "-b:a", "192k",
          "output.mp4"
        );
        exitCode = await ffmpeg.exec(args);
        (window as any).__joinerOut = "output.mp4";
      }

      if (exitCode !== 0) {
        throw new Error(
          effectiveFast
            ? "Os vídeos não são compatíveis para o modo rápido. Desligue o modo rápido e tente o modo seguro."
            : `FFmpeg retornou código ${exitCode}`
        );
      }

      const outName: string = (window as any).__joinerOut || "output.mp4";
      let data: any;
      try {
        data = await ffmpeg.readFile(outName);
      } catch {
        throw new Error("Arquivo de saída não foi gerado.");
      }
      const ext = outName.split(".").pop() || "mp4";
      const mimeMap: Record<string, string> = { mp4: "video/mp4", mkv: "video/x-matroska", webm: "video/webm", mov: "video/quicktime", ts: "video/mp2t" };
      const blob = new Blob([data], { type: mimeMap[ext] || "video/mp4" });
      if (blob.size < 100) throw new Error("O arquivo gerado está vazio.");
      setResultUrl(URL.createObjectURL(blob));
      (window as any).__joinerExt = ext;
      toast.success("Vídeos unidos com sucesso!");

      for (const n of names) {
        try { await ffmpeg.deleteFile(n); } catch {}
      }
      try { await ffmpeg.deleteFile(outName); } catch {}
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      console.error("Error joining videos:", err);
      setError(msg);
      toast.error("Falha ao unir vídeos", { description: msg });
      resetFFmpeg();
    } finally {
      setJoining(false);
      setStatusText("");
    }
  };

  const download = () => {
    if (!resultUrl) return;
    const ext = (window as any).__joinerExt || "mp4";
    const link = document.createElement("a");
    link.href = resultUrl;
    link.download = `videos-unidos.${ext}`;
    link.click();
  };

  const reset = () => {
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    setFiles([]);
    setResultUrl(null);
    setProgress(0);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="space-y-6">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          addFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${
          dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
        }`}
      >
        <Upload className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
        <p className="text-foreground font-heading mb-1">
          Arraste 2 ou mais vídeos
        </p>
        <p className="text-sm text-muted-foreground">
          A ordem da lista é a ordem da junção
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          multiple
          onChange={(e) => e.target.files && addFiles(e.target.files)}
          className="hidden"
        />
      </div>

      {files.length > 0 && (
        <div className="space-y-2">
          {files.map((f, i) => (
            <div
              key={`${f.name}-${i}`}
              className="flex items-center gap-3 bg-secondary/40 rounded-lg p-3"
            >
              <span className="text-xs text-muted-foreground w-6 text-center">
                {i + 1}
              </span>
              <FileVideo className="w-4 h-4 text-primary shrink-0" />
              <span className="text-sm text-foreground truncate flex-1">
                {f.name}
              </span>
              <span className="text-xs text-muted-foreground shrink-0">
                {(f.size / (1024 * 1024)).toFixed(1)} MB
              </span>
              <div className="flex gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  aria-label={`Mover ${f.name} para cima`}
                >
                  <ArrowUp className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => move(i, 1)}
                  disabled={i === files.length - 1}
                  aria-label={`Mover ${f.name} para baixo`}
                >
                  <ArrowDown className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => removeAt(i)}
                  aria-label={`Remover ${f.name}`}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ))}

          <div className="flex items-center justify-between bg-secondary/30 rounded-lg p-3 mt-4">
            <div className="space-y-0.5">
              <Label htmlFor="fast-mode" className="text-sm font-medium">
                Modo rápido (sem re-encode)
              </Label>
              <p className="text-xs text-muted-foreground">
                Muito mais veloz, mas exige codecs e resoluções idênticos
              </p>
            </div>
            <Switch
              id="fast-mode"
              checked={fastMode}
              onCheckedChange={setFastMode}
              disabled={joining}
            />
          </div>

          <div className="flex justify-between items-center pt-2">
            <Button variant="outline" size="sm" onClick={reset} disabled={joining}>
              Limpar tudo
            </Button>
            <Button
              onClick={join}
              disabled={joining || files.length < 2}
              className="gap-2"
            >
              {joining ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Combine className="w-4 h-4" />
              )}
              Unir Vídeos
            </Button>
          </div>
        </div>
      )}

      {joining && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-primary" />
            <span className="text-sm text-muted-foreground">
              {statusText || "Processando..."}
            </span>
          </div>
          <Progress value={progress} />
        </div>
      )}

      {error && !joining && (
        <div className="flex items-center gap-3 bg-destructive/10 text-destructive rounded-lg p-4">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <p className="text-sm flex-1">{error}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={join}
            className="gap-1 shrink-0"
          >
            <RotateCcw className="w-3 h-3" /> Tentar novamente
          </Button>
        </div>
      )}

      {resultUrl && (
        <div className="bg-secondary/50 rounded-lg p-6 text-center space-y-4">
          <Combine className="w-12 h-12 mx-auto text-primary" />
          <p className="text-foreground font-heading">Vídeos unidos com sucesso!</p>
          <video
            src={resultUrl}
            controls
            className="w-full rounded-lg max-h-[400px] bg-black mx-auto"
          />
          <Button onClick={download} className="gap-2">
            <Download className="w-4 h-4" />
            Baixar Vídeo Final
          </Button>
        </div>
      )}
    </div>
  );
};

export default VideoJoiner;