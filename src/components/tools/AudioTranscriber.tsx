import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Mic, Copy, Download, FileText, Square, Pause, Play, Upload, RotateCcw } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import Dropzone from "./shared/Dropzone";
import { X } from "lucide-react";
import { getSupabase } from "@/integrations/supabase/client";
import { consume, formatReset } from "@/lib/rate-limit";
import { downloadBlob } from "@/lib/download";

interface Segment { id: number; start: number; end: number; text: string }
interface Result { text: string; language?: string; duration?: number; segments?: Segment[] }

const MAX_MB = 25;
const MAX_RECORD_SECONDS = 10 * 60; // 10 minutos

const LANGS = [
  { v: "auto", l: "Detectar idioma" },
  { v: "pt", l: "Português" },
  { v: "en", l: "Inglês" },
  { v: "es", l: "Espanhol" },
  { v: "fr", l: "Francês" },
  { v: "de", l: "Alemão" },
  { v: "it", l: "Italiano" },
  { v: "ja", l: "Japonês" },
];

function fmtTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s - h * 3600 - m * 60;
  const pad = (n: number, w = 2) => n.toString().padStart(w, "0");
  const ms = Math.floor((sec - Math.floor(sec)) * 1000);
  return `${pad(h)}:${pad(m)}:${pad(Math.floor(sec))},${pad(ms, 3)}`;
}

function toSrt(segments: Segment[]): string {
  return segments
    .map((s, i) => `${i + 1}\n${fmtTime(s.start)} --> ${fmtTime(s.end)}\n${s.text.trim()}\n`)
    .join("\n");
}

function pickMime(): { mime: string; ext: string } {
  const candidates: Array<{ mime: string; ext: string }> = [
    { mime: "audio/webm;codecs=opus", ext: "webm" },
    { mime: "audio/webm", ext: "webm" },
    { mime: "audio/mp4", ext: "m4a" },
    { mime: "audio/ogg;codecs=opus", ext: "ogg" },
  ];
  const MR = (window as unknown as { MediaRecorder?: typeof MediaRecorder }).MediaRecorder;
  if (MR && typeof MR.isTypeSupported === "function") {
    for (const c of candidates) if (MR.isTypeSupported(c.mime)) return c;
  }
  return { mime: "", ext: "webm" };
}

function fmtMMSS(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
}

const AudioTranscriber = () => {
  const [file, setFile] = useState<File | null>(null);
  const [lang, setLang] = useState("auto");
  const [withTimestamps, setWithTimestamps] = useState(true);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [mode, setMode] = useState<"upload" | "record">("upload");

  // Recording state
  const [recState, setRecState] = useState<"idle" | "recording" | "paused" | "ready">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const warnedRef = useRef(false);

  const cleanupStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
  };

  useEffect(() => () => {
    cleanupStream();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const startTimer = () => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = window.setInterval(() => {
      setElapsed((s) => {
        const next = s + 1;
        if (next >= MAX_RECORD_SECONDS) {
          stopRecording();
        } else if (next >= MAX_RECORD_SECONDS - 30 && !warnedRef.current) {
          warnedRef.current = true;
          toast.warning("Faltam 30s para o limite de gravação (10 min).");
        }
        return next;
      });
    }, 1000);
  };

  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error("Seu navegador não suporta gravação por microfone.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
      streamRef.current = stream;
      const { mime, ext } = pickMime();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        const type = rec.mimeType || mime || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        const fname = `gravacao-${Date.now()}.${ext}`;
        const f = new File([blob], fname, { type, lastModified: Date.now() });
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setPreviewUrl(URL.createObjectURL(blob));
        setFile(f);
        setResult(null);
        setRecState("ready");
        cleanupStream();
      };
      recorderRef.current = rec;
      warnedRef.current = false;
      setElapsed(0);
      setFile(null);
      setResult(null);
      rec.start(1000);
      setRecState("recording");
      startTimer();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Permissão de microfone negada";
      toast.error("Não foi possível gravar", { description: msg });
      cleanupStream();
    }
  };

  const pauseRecording = () => {
    const r = recorderRef.current;
    if (!r || r.state !== "recording") return;
    r.pause();
    if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
    setRecState("paused");
  };

  const resumeRecording = () => {
    const r = recorderRef.current;
    if (!r || r.state !== "paused") return;
    r.resume();
    startTimer();
    setRecState("recording");
  };

  const stopRecording = () => {
    const r = recorderRef.current;
    if (!r) return;
    if (r.state !== "inactive") r.stop();
    if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
  };

  const resetRecording = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setFile(null);
    setResult(null);
    setElapsed(0);
    setRecState("idle");
  };

  const onFiles = (fs: File[]) => {
    const f = fs[0];
    if (!f) return;
    if (f.size > MAX_MB * 1024 * 1024) {
      toast.error(`Arquivo excede ${MAX_MB} MB (limite da API).`);
      return;
    }
    setFile(f);
    setResult(null);
  };

  const transcribe = async () => {
    if (!file) return;
    const rl = consume("audio-transcribe", { hourly: 10, daily: 30 });
    if (!rl.ok) {
      toast.error("Limite atingido", {
        description: `Tente novamente em ${formatReset(rl.resetInMs)}.`,
      });
      return;
    }
    setLoading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("language", lang);
      form.append("response_format", withTimestamps ? "verbose_json" : "json");

      const { data, error } = await getSupabase().functions.invoke("transcribe-audio", {
        body: form,
      });
      if (error) throw error;
      const d = data as { error?: string; code?: string; resetInMs?: number };
      if (d?.error) {
        if (d.code === "rate_limited") {
          toast.error("Limite atingido", { description: `Tente novamente em ${formatReset(d.resetInMs ?? 0)}.` });
          return;
        }
        throw new Error(d.error);
      }
      setResult(data as Result);
      toast.success("Transcrição concluída!");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Falha ao transcrever";
      toast.error("Erro na transcrição", { description: msg });
    } finally {
      setLoading(false);
    }
  };

  const copyAll = async () => {
    if (!result) return;
    await navigator.clipboard.writeText(result.text);
    toast.success("Texto copiado!");
  };

  const downloadTxt = () => {
    if (!result) return;
    const base = file?.name.replace(/\.[^.]+$/, "") ?? "transcricao";
    downloadBlob(new Blob([result.text], { type: "text/plain" }), `${base}.txt`);
  };

  const downloadSrt = () => {
    if (!result?.segments?.length) return;
    const base = file?.name.replace(/\.[^.]+$/, "") ?? "transcricao";
    downloadBlob(new Blob([toSrt(result.segments)], { type: "application/x-subrip" }), `${base}.srt`);
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <Tabs
        value={mode}
        onValueChange={(v) => {
          if (recState === "recording" || recState === "paused") {
            toast.error("Pare a gravação antes de trocar de modo.");
            return;
          }
          setMode(v as "upload" | "record");
          setFile(null);
          setResult(null);
          resetRecording();
        }}
      >
        <TabsList className="grid w-full grid-cols-2 sm:w-auto sm:inline-flex">
          <TabsTrigger value="upload" className="gap-1.5"><Upload className="w-3.5 h-3.5" /> Enviar arquivo</TabsTrigger>
          <TabsTrigger value="record" className="gap-1.5"><Mic className="w-3.5 h-3.5" /> Gravar agora</TabsTrigger>
        </TabsList>

        <TabsContent value="upload" className="mt-4 space-y-3">
          {!file ? (
            <Dropzone
              onFiles={onFiles}
              accept="audio/*,.mp3,.m4a,.wav,.ogg,.opus,.webm,.flac"
              title="Solte um arquivo de áudio"
              hint={`MP3, M4A, WAV, OGG, OPUS, WEBM, FLAC — até ${MAX_MB} MB`}
              sizeKind="audio"
            />
          ) : (
            <div className="flex items-center gap-2 rounded-md border border-border bg-secondary/40 px-3 py-2">
              <span className="flex-1 truncate text-sm">{file.name}</span>
              <span className="text-xs text-muted-foreground shrink-0">
                {(file.size / (1024 * 1024)).toFixed(1)} MB
              </span>
              <Button variant="ghost" size="icon" onClick={() => { setFile(null); setResult(null); }} aria-label="Remover">
                <X className="w-4 h-4" />
              </Button>
            </div>
          )}
        </TabsContent>

        <TabsContent value="record" className="mt-4 space-y-3">
          <div className="rounded-lg border border-border bg-secondary/40 p-6 flex flex-col items-center gap-4">
            <div className="flex items-center gap-3">
              <div
                className={`w-3 h-3 rounded-full ${
                  recState === "recording" ? "bg-destructive animate-pulse" :
                  recState === "paused" ? "bg-yellow-500" :
                  recState === "ready" ? "bg-primary" : "bg-muted-foreground/40"
                }`}
                aria-hidden
              />
              <span className="font-mono text-2xl tabular-nums">{fmtMMSS(elapsed)}</span>
              <span className="text-xs text-muted-foreground">/ {fmtMMSS(MAX_RECORD_SECONDS)}</span>
            </div>

            <div className="flex flex-wrap gap-2 justify-center">
              {recState === "idle" && (
                <Button onClick={startRecording} className="gap-2">
                  <Mic className="w-4 h-4" /> Iniciar gravação
                </Button>
              )}
              {recState === "recording" && (
                <>
                  <Button variant="outline" onClick={pauseRecording} className="gap-2">
                    <Pause className="w-4 h-4" /> Pausar
                  </Button>
                  <Button variant="destructive" onClick={stopRecording} className="gap-2">
                    <Square className="w-4 h-4" /> Parar
                  </Button>
                </>
              )}
              {recState === "paused" && (
                <>
                  <Button onClick={resumeRecording} className="gap-2">
                    <Play className="w-4 h-4" /> Retomar
                  </Button>
                  <Button variant="destructive" onClick={stopRecording} className="gap-2">
                    <Square className="w-4 h-4" /> Parar
                  </Button>
                </>
              )}
              {recState === "ready" && (
                <Button variant="outline" onClick={resetRecording} className="gap-2">
                  <RotateCcw className="w-4 h-4" /> Regravar
                </Button>
              )}
            </div>

            {recState === "ready" && previewUrl && (
              <div className="w-full space-y-2">
                <audio src={previewUrl} controls className="w-full" />
                {file && (
                  <div className="text-xs text-muted-foreground text-center">
                    {file.name} — {(file.size / (1024 * 1024)).toFixed(2)} MB
                  </div>
                )}
              </div>
            )}

            {recState === "idle" && (
              <p className="text-xs text-muted-foreground text-center max-w-md">
                Permita o acesso ao microfone. A gravação fica apenas no seu navegador até você clicar em Transcrever.
              </p>
            )}
          </div>
        </TabsContent>
      </Tabs>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Idioma</Label>
          <Select value={lang} onValueChange={setLang}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {LANGS.map((l) => <SelectItem key={l.v} value={l.v}>{l.l}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end gap-3 pb-1">
          <div className="flex items-center gap-2">
            <Switch id="ts" checked={withTimestamps} onCheckedChange={setWithTimestamps} />
            <Label htmlFor="ts" className="text-sm cursor-pointer">Incluir timestamps</Label>
          </div>
        </div>
      </div>

      <Button onClick={transcribe} disabled={!file || loading} className="w-full md:w-auto gap-2">
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mic className="w-4 h-4" />}
        {loading ? "Transcrevendo..." : "Transcrever áudio"}
      </Button>

      {result && (
        <div className="space-y-3 animate-fade-in">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="text-xs text-muted-foreground">
              {result.language && <span className="mr-3">Idioma: <b>{result.language}</b></span>}
              {result.duration && <span>Duração: <b>{result.duration.toFixed(1)}s</b></span>}
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={copyAll} className="gap-1.5">
                <Copy className="w-3.5 h-3.5" /> Copiar
              </Button>
              <Button size="sm" variant="outline" onClick={downloadTxt} className="gap-1.5">
                <FileText className="w-3.5 h-3.5" /> .txt
              </Button>
              {result.segments?.length ? (
                <Button size="sm" variant="outline" onClick={downloadSrt} className="gap-1.5">
                  <Download className="w-3.5 h-3.5" /> .srt
                </Button>
              ) : null}
            </div>
          </div>
          <Textarea value={result.text} readOnly rows={10} className="font-mono text-sm" />
          {result.segments?.length ? (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                Ver segmentos com tempo ({result.segments.length})
              </summary>
              <div className="mt-2 max-h-72 overflow-y-auto space-y-1 border border-border rounded-md p-3 bg-secondary/20">
                {result.segments.map((s) => (
                  <div key={s.id} className="text-xs">
                    <span className="text-primary font-mono mr-2">[{s.start.toFixed(1)}s]</span>
                    {s.text}
                  </div>
                ))}
              </div>
            </details>
          ) : null}
        </div>
      )}
    </div>
  );
};

export default AudioTranscriber;