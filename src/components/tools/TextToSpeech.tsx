import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Volume2, Download } from "lucide-react";
import { toast } from "sonner";
import { consume, formatReset } from "@/lib/rate-limit";
import { downloadBlob } from "@/lib/download";
import { synthesize, type ApiError } from "@/lib/voice-api";
import { useVoiceStatus, VoiceUnavailable } from "./shared/VoiceAvailability";

const VOICES = ["austin","leo","dan","mia","zoe","jess","tara","leah"];
const FORMATS = [
  { v: "wav", l: "WAV" },
  { v: "mp3", l: "MP3" },
  { v: "flac", l: "FLAC" },
  { v: "opus", l: "OPUS" },
];
const MAX = 4000;

const TextToSpeech = () => {
  const [text, setText] = useState("");
  const [voice, setVoice] = useState("austin");
  const [format, setFormat] = useState("wav");
  const [loading, setLoading] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const voz = useVoiceStatus();

  const generate = async () => {
    const t = text.trim();
    if (!t) { toast.error("Digite um texto"); return; }
    if (t.length > MAX) { toast.error(`Máximo ${MAX} caracteres`); return; }
    const rl = consume("tts", { hourly: 10, daily: 30 });
    if (!rl.ok) {
      toast.error("Limite atingido", { description: `Tente em ${formatReset(rl.resetInMs)}.` });
      return;
    }
    setLoading(true);
    try {
      const blob = await synthesize({ text: t, voice, format });
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      setAudioBlob(blob);
      setAudioUrl(URL.createObjectURL(blob));
      toast.success("Áudio gerado!");
    } catch (err) {
      const e = err as ApiError;
      if (e.code === "model_terms_required") {
        toast.error("Geração de voz indisponível no momento", { description: "Tente novamente em instantes." });
      } else if (e.code === "rate_limited") {
        toast.error("Limite atingido", { description: `Tente novamente em ${formatReset(e.resetInMs ?? 0)}.` });
      } else {
        toast.error("Erro", { description: e.message || "desconhecido" });
      }
    } finally {
      setLoading(false);
    }
  };

  const download = () => {
    if (!audioBlob) return;
    downloadBlob(audioBlob, `tts-${voice}.${format}`);
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="space-y-1">
        <Label className="text-xs">Texto (inglês) — use marcadores como [cheerful], [whispering] para emoção</Label>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          placeholder="Welcome to our text-to-speech. [cheerful] This is an example."
          maxLength={MAX}
        />
        <div className="text-xs text-muted-foreground text-right">{text.length}/{MAX}</div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Voz</Label>
          <Select value={voice} onValueChange={setVoice}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {VOICES.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Formato</Label>
          <Select value={format} onValueChange={setFormat}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {FORMATS.map((f) => <SelectItem key={f.v} value={f.v}>{f.l}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {voz && "reason" in voz ? (
        <VoiceUnavailable reason={voz.reason} />
      ) : (
        <Button onClick={generate} disabled={loading || !text.trim() || !voz} className="w-full md:w-auto gap-2">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Volume2 className="w-4 h-4" />}
          {loading ? "Gerando..." : "Gerar áudio"}
        </Button>
      )}

      {audioUrl && (
        <div className="space-y-3 animate-fade-in">
          <audio controls src={audioUrl} className="w-full" />
          <Button size="sm" variant="outline" onClick={download} className="gap-1.5">
            <Download className="w-3.5 h-3.5" /> Baixar .{format}
          </Button>
        </div>
      )}
    </div>
  );
};

export default TextToSpeech;