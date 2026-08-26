import { useState, useCallback, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import { Upload, Download, Loader2, X, FileVideo, Scissors, AlertTriangle, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { getFFmpeg, resetFFmpeg } from "@/lib/ffmpeg";

const formatTime = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
};

const Mp4Cutter = () => {
  const [file, setFile] = useState<File | null>(null);
  const [cutting, setCutting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("");
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [duration, setDuration] = useState(0);
  const [range, setRange] = useState<[number, number]>([0, 0]);
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const handleFile = useCallback((selectedFile: File) => {
    setFile(selectedFile);
    setResultUrl(null);
    setError(null);
    const url = URL.createObjectURL(selectedFile);
    setVideoSrc(url);
  }, []);

  const onVideoLoaded = () => {
    if (videoRef.current) {
      const dur = videoRef.current.duration;
      setDuration(dur);
      setRange([0, dur]);
    }
  };

  const cutVideo = async () => {
    if (!file) return;
    setCutting(true);
    setProgress(0);
    setError(null);
    setStatusText("Inicializando motor de vídeo...");

    try {
      const ffmpeg = await getFFmpeg((p) => setProgress(p));

      setStatusText("Processando corte...");
      const { fetchFile } = await import("@ffmpeg/util");
      await ffmpeg.writeFile("input.mp4", await fetchFile(file));

      const startSecs = range[0].toFixed(2);
      const durSecs = (range[1] - range[0]).toFixed(2);
      const exitCode = await ffmpeg.exec([
        "-i", "input.mp4",
        "-ss", startSecs,
        "-t", durSecs,
        "-map", "0",
        "-reset_timestamps", "1",
        "output.mp4",
      ]);

      if (exitCode !== 0) {
        throw new Error(`FFmpeg retornou código ${exitCode}`);
      }

      let data: any;
      try {
        data = await ffmpeg.readFile("output.mp4");
      } catch {
        throw new Error("Arquivo de saída não foi gerado.");
      }

      const blob = new Blob([data], { type: "video/mp4" });
      if (blob.size < 100) {
        throw new Error("O arquivo gerado está vazio.");
      }

      setResultUrl(URL.createObjectURL(blob));
      toast.success("Vídeo cortado com sucesso!");

      // Cleanup virtual FS
      try { await ffmpeg.deleteFile("input.mp4"); } catch {}
      try { await ffmpeg.deleteFile("output.mp4"); } catch {}
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      console.error("Error cutting video:", err);
      setError(msg);
      toast.error("Falha ao cortar vídeo", { description: msg });
      resetFFmpeg();
    } finally {
      setCutting(false);
      setStatusText("");
    }
  };

  const downloadResult = () => {
    if (!resultUrl || !file) return;
    const link = document.createElement("a");
    link.href = resultUrl;
    link.download = file.name.replace(/\.[^.]+$/, "") + "-cortado.mp4";
    link.click();
  };

  const reset = () => {
    if (videoSrc) URL.revokeObjectURL(videoSrc);
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    setFile(null);
    setVideoSrc(null);
    setResultUrl(null);
    setDuration(0);
    setRange([0, 0]);
    setProgress(0);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f?.type.startsWith("video/")) handleFile(f);
  }, [handleFile]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  };

  useEffect(() => {
    if (videoRef.current && duration > 0) {
      videoRef.current.currentTime = range[0];
    }
  }, [range[0]]);

  return (
    <div className="space-y-6">
      {!file ? (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors cursor-pointer ${
            dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
          }`}
          onClick={() => inputRef.current?.click()}
        >
          <Upload className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
          <p className="text-lg font-heading text-foreground mb-2">Arraste seu vídeo aqui</p>
          <p className="text-sm text-muted-foreground">MP4, MOV, AVI, MKV ou WebM</p>
          <input ref={inputRef} type="file" accept="video/*" onChange={handleFileChange} className="hidden" />
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <FileVideo className="w-5 h-5 text-primary" />
              <span className="text-foreground font-medium truncate max-w-xs">{file.name}</span>
              <span className="text-xs text-muted-foreground">
                ({(file.size / (1024 * 1024)).toFixed(1)} MB)
              </span>
            </div>
            <Button variant="ghost" size="icon" onClick={reset} aria-label="Remover vídeo">
              <X className="w-4 h-4" />
            </Button>
          </div>

          {videoSrc && (
            <video
              ref={videoRef}
              src={videoSrc}
              onLoadedMetadata={onVideoLoaded}
              controls
              className="w-full rounded-lg max-h-[400px] bg-black"
            />
          )}

          {duration > 0 && (
            <div className="space-y-4 bg-secondary/50 rounded-lg p-6">
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>Início: <strong className="text-foreground">{formatTime(range[0])}</strong></span>
                <span>Fim: <strong className="text-foreground">{formatTime(range[1])}</strong></span>
              </div>
              <Slider
                min={0}
                max={duration}
                step={0.1}
                value={range}
                onValueChange={(v) => setRange(v as [number, number])}
                minStepsBetweenThumbs={1}
              />
              <p className="text-xs text-center text-muted-foreground">
                Duração selecionada: {formatTime(range[1] - range[0])}
              </p>

              <div className="flex justify-center">
                <Button onClick={cutVideo} disabled={cutting || range[1] - range[0] < 0.5} className="gap-2">
                  {cutting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Scissors className="w-4 h-4" />}
                  Cortar Vídeo
                </Button>
              </div>

              {cutting && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-primary" />
                    <span className="text-sm text-muted-foreground">{statusText || "Processando..."}</span>
                  </div>
                  <Progress value={progress} />
                </div>
              )}

              {error && (
                <div className="flex items-center gap-3 bg-destructive/10 text-destructive rounded-lg p-4">
                  <AlertTriangle className="w-5 h-5 shrink-0" />
                  <p className="text-sm flex-1">{error}</p>
                  <Button variant="outline" size="sm" onClick={cutVideo} className="gap-1 shrink-0">
                    <RotateCcw className="w-3 h-3" /> Tentar novamente
                  </Button>
                </div>
              )}
            </div>
          )}

          {resultUrl && (
            <div className="bg-secondary/50 rounded-lg p-6 text-center space-y-4">
              <Scissors className="w-12 h-12 mx-auto text-primary" />
              <p className="text-foreground font-heading">Vídeo cortado com sucesso!</p>
              <video src={resultUrl} controls className="w-full rounded-lg max-h-[400px] bg-black mx-auto" />
              <Button onClick={downloadResult} className="gap-2">
                <Download className="w-4 h-4" />
                Baixar Vídeo Cortado
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Mp4Cutter;
