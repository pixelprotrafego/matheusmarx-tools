import { useState, useCallback, useRef } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Label } from "@/components/ui/label";
import { Upload, Download, Loader2, X, FileVideo, FileAudio, AlertTriangle, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { runFFmpeg } from "@/lib/ffmpeg-runner";
import { MEDIA_INPUT_FORMATS, getOutputs, getFFmpegArgs, getMimeType, isAudio } from "@/lib/media-presets";

const MediaConverter = () => {
  const [inputFormat, setInputFormat] = useState("");
  const [outputFormat, setOutputFormat] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("");
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [bitrate, setBitrate] = useState<number>(192);
  const inputRef = useRef<HTMLInputElement>(null);

  const outputOptions = inputFormat ? getOutputs(inputFormat) : [];
  const selectedInput = MEDIA_INPUT_FORMATS.find(f => f.value === inputFormat);
  const isAudioOutput = isAudio(outputFormat);

  const handleInputChange = (val: string) => {
    setInputFormat(val);
    setOutputFormat("");
    reset();
  };

  const handleFile = useCallback((selectedFile: File) => {
    setFile(selectedFile);
    setResultUrl(null);
    setError(null);
  }, []);

  const convert = async () => {
    if (!file || !inputFormat || !outputFormat) return;
    setLoading(true);
    setProgress(0);
    setError(null);
    setStatusText("Inicializando motor de mídia...");

    const inputFile = `input.${inputFormat}`;
    const outputFile = `output.${outputFormat}`;

    try {
      const args = getFFmpegArgs(inputFormat, outputFormat, { audioBitrate: bitrate });
      const raw = await runFFmpeg({
        inputs: [{ name: inputFile, data: file }],
        args,
        output: outputFile,
        onProgress: setProgress,
        onStatus: setStatusText,
      });
      const blob = new Blob([await raw.arrayBuffer()], { type: getMimeType(outputFormat) });
      setResultUrl(URL.createObjectURL(blob));
      toast.success("Conversão concluída!");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      setError(msg);
      toast.error("Falha na conversão", { description: msg });
    } finally {
      setLoading(false);
      setStatusText("");
    }
  };

  const downloadResult = () => {
    if (!resultUrl || !file) return;
    const link = document.createElement("a");
    link.href = resultUrl;
    link.download = file.name.replace(/\.[^.]+$/, "") + `.${outputFormat}`;
    link.click();
  };

  const reset = () => {
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    setFile(null);
    setResultUrl(null);
    setProgress(0);
    setError(null);
    setStatusText("");
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label className="text-muted-foreground">Formato de entrada</Label>
          <Select value={inputFormat} onValueChange={handleInputChange}>
            <SelectTrigger>
              <SelectValue placeholder="Selecione o formato" />
            </SelectTrigger>
            <SelectContent>
              {MEDIA_INPUT_FORMATS.map((f) => (
                <SelectItem key={f.value} value={f.value}>
                  <span className="flex items-center gap-2">
                    {f.icon === "video" ? <FileVideo className="w-3 h-3" /> : <FileAudio className="w-3 h-3" />}
                    {f.label}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label className="text-muted-foreground">Converter para</Label>
          <Select value={outputFormat} onValueChange={setOutputFormat} disabled={!inputFormat}>
            <SelectTrigger>
              <SelectValue placeholder={inputFormat ? "Selecione a saída" : "Escolha a entrada primeiro"} />
            </SelectTrigger>
            <SelectContent>
              {outputOptions.map((ext) => (
                <SelectItem key={ext} value={ext}>{ext.toUpperCase()}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isAudioOutput && inputFormat && (
        <div className="flex items-center gap-3 text-sm">
          <Label className="text-muted-foreground">Bitrate</Label>
          <Select value={String(bitrate)} onValueChange={(v) => setBitrate(Number(v))}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[96, 128, 192, 256, 320].map((b) => (
                <SelectItem key={b} value={String(b)}>{b} kbps</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {inputFormat && outputFormat && (
        <div className="animate-fade-in space-y-6">
          <div className="flex items-center gap-2">
            <div className="line-gold flex-1" />
            <span className="text-sm text-muted-foreground font-medium">
              {inputFormat.toUpperCase()} → {outputFormat.toUpperCase()}
            </span>
            <div className="line-gold flex-1" />
          </div>

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
              <p className="text-lg font-heading text-foreground mb-2">Arraste seu arquivo aqui</p>
              <p className="text-sm text-muted-foreground">{selectedInput?.label || inputFormat.toUpperCase()}</p>
              <input
                ref={inputRef}
                type="file"
                accept={selectedInput?.accept || "*"}
                onChange={handleFileChange}
                className="hidden"
              />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {isAudioOutput ? <FileAudio className="w-5 h-5 text-primary" /> : <FileVideo className="w-5 h-5 text-primary" />}
                  <span className="text-foreground font-medium truncate max-w-xs">{file.name}</span>
                  <span className="text-xs text-muted-foreground">({(file.size / (1024 * 1024)).toFixed(1)} MB)</span>
                </div>
                <Button variant="ghost" size="icon" onClick={reset} aria-label="Remover arquivo">
                  <X className="w-4 h-4" />
                </Button>
              </div>

              {!loading && !resultUrl && !error && (
                <div className="flex justify-center">
                  <Button onClick={convert} className="gap-2">
                    <Loader2 className="w-4 h-4 hidden" />
                    Converter
                  </Button>
                </div>
              )}

              {loading && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-primary" />
                    <span className="text-sm text-muted-foreground">{statusText || "Processando..."}</span>
                  </div>
                  <Progress value={progress} />
                </div>
              )}

              {error && !loading && (
                <div className="flex items-center gap-3 bg-destructive/10 text-destructive rounded-lg p-4">
                  <AlertTriangle className="w-5 h-5 shrink-0" />
                  <p className="text-sm flex-1">{error}</p>
                  <Button variant="outline" size="sm" onClick={convert} className="gap-1 shrink-0">
                    <RotateCcw className="w-3 h-3" /> Tentar novamente
                  </Button>
                </div>
              )}

              {resultUrl && (
                <div className="bg-secondary/50 rounded-lg p-6 text-center space-y-4">
                  {isAudioOutput ? (
                    <FileAudio className="w-12 h-12 mx-auto text-primary" />
                  ) : (
                    <FileVideo className="w-12 h-12 mx-auto text-primary" />
                  )}
                  <p className="text-foreground font-heading">Conversão concluída!</p>
                  {isAudioOutput && <audio controls src={resultUrl} className="mx-auto w-full max-w-md" />}
                  {!isAudioOutput && <video controls src={resultUrl} className="w-full rounded-lg max-h-[400px] bg-black" />}
                  <Button onClick={downloadResult} className="gap-2">
                    <Download className="w-4 h-4" />
                    Baixar {outputFormat.toUpperCase()}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {!inputFormat && (
        <p className="text-center text-muted-foreground py-8">
          Selecione os formatos de entrada e saída para começar.
        </p>
      )}
    </div>
  );
};

export default MediaConverter;
