import { useMemo, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { EyeOff, Eye, Download, Loader2, FileLock2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import Dropzone from "./shared/Dropzone";
import {
  loadImageToCanvas,
  capacityBytes,
  embed,
  extract,
  type HiddenPayload,
} from "@/lib/steganography";
import { downloadBlob, bytesToBlob } from "@/lib/download";

const MAX_HIDDEN_FILE = 2 * 1024 * 1024; // 2 MB max para o payload de arquivo

const SteganographyTool = () => {
  // --- Esconder ---
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverCanvas, setCoverCanvas] = useState<HTMLCanvasElement | null>(null);
  const [mode, setMode] = useState<"text" | "file">("text");
  const [secretText, setSecretText] = useState("");
  const [secretFile, setSecretFile] = useState<File | null>(null);
  const [pwd1, setPwd1] = useState("");
  const [showPwd1, setShowPwd1] = useState(false);
  const [embedding, setEmbedding] = useState(false);

  // --- Revelar ---
  const [stegoFile, setStegoFile] = useState<File | null>(null);
  const [pwd2, setPwd2] = useState("");
  const [showPwd2, setShowPwd2] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [revealed, setRevealed] = useState<HiddenPayload | null>(null);

  const capacity = useMemo(
    () => (coverCanvas ? capacityBytes(coverCanvas) - 48 : 0),
    [coverCanvas],
  );

  const payloadSize = useMemo(() => {
    if (mode === "text") return new TextEncoder().encode(secretText).length + 1;
    if (!secretFile) return 0;
    return secretFile.size + 2 + new TextEncoder().encode(secretFile.name).length;
  }, [mode, secretText, secretFile]);

  // Estimativa de ciphertext = payloadSize + 16 (tag GCM)
  const usedBytes = payloadSize > 0 ? payloadSize + 16 : 0;
  const pct = capacity > 0 ? Math.min(100, Math.round((usedBytes / capacity) * 100)) : 0;

  const onCover = async (files: File[]) => {
    const f = files[0];
    if (!f) return;
    setCoverFile(f);
    try {
      const canvas = await loadImageToCanvas(f);
      setCoverCanvas(canvas);
    } catch (e) {
      toast.error("Imagem inválida", {
        description: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const onSecretFile = (files: File[]) => {
    const f = files[0];
    if (!f) return;
    if (f.size > MAX_HIDDEN_FILE) {
      toast.error("Arquivo muito grande", {
        description: `Limite de ${MAX_HIDDEN_FILE / 1024 / 1024} MB para o arquivo escondido.`,
      });
      return;
    }
    setSecretFile(f);
  };

  const doEmbed = async () => {
    if (!coverCanvas || !coverFile) return toast.error("Selecione uma imagem-capa");
    if (!pwd1) return toast.error("Defina uma senha");
    if (mode === "text" && !secretText.trim()) return toast.error("Digite a mensagem");
    if (mode === "file" && !secretFile) return toast.error("Selecione o arquivo a esconder");
    if (usedBytes > capacity) return toast.error("Dados excedem a capacidade da imagem");

    setEmbedding(true);
    try {
      let payload: HiddenPayload;
      if (mode === "text") {
        payload = { kind: "text", text: secretText };
      } else {
        const bytes = new Uint8Array(await secretFile!.arrayBuffer());
        payload = { kind: "file", fileName: secretFile!.name, fileBytes: bytes };
      }
      const blob = await embed(coverCanvas, payload, pwd1);
      const outName = coverFile.name.replace(/\.[^.]+$/, "") + "-secret.png";
      downloadBlob(blob, outName);
      toast.success("PNG com mensagem oculta baixado");
    } catch (e) {
      toast.error("Falha ao esconder", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setEmbedding(false);
    }
  };

  const onStego = (files: File[]) => {
    const f = files[0];
    if (!f) return;
    setStegoFile(f);
    setRevealed(null);
  };

  const doExtract = async () => {
    if (!stegoFile) return toast.error("Selecione o PNG com a mensagem");
    if (!pwd2) return toast.error("Digite a senha");
    setExtracting(true);
    try {
      const canvas = await loadImageToCanvas(stegoFile);
      const payload = await extract(canvas, pwd2);
      setRevealed(payload);
      toast.success("Mensagem revelada");
    } catch (e) {
      toast.error("Falha ao revelar", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setExtracting(false);
    }
  };

  const downloadRevealedFile = () => {
    if (!revealed || revealed.kind !== "file" || !revealed.fileBytes) return;
    downloadBlob(
      bytesToBlob(revealed.fileBytes, "application/octet-stream"),
      revealed.fileName ?? "revealed.bin",
    );
  };

  return (
    <div className="space-y-4">
      <Alert>
        <FileLock2 className="h-4 w-4" />
        <AlertDescription className="text-xs leading-relaxed">
          A mensagem é cifrada (AES-256-GCM) e embutida nos bits invisíveis de um PNG.
          Saída <strong>sempre em PNG</strong> — JPG re-comprime e destrói o segredo.
          Não envie por WhatsApp/Instagram (re-comprimem). Use e-mail, Telegram (como arquivo) ou Drive.
          Sem a senha, ninguém recupera — nem nós.
        </AlertDescription>
      </Alert>

      <Tabs defaultValue="hide">
        <TabsList className="grid grid-cols-2 w-full">
          <TabsTrigger value="hide" className="gap-2"><EyeOff className="w-4 h-4" /> Esconder</TabsTrigger>
          <TabsTrigger value="reveal" className="gap-2"><Eye className="w-4 h-4" /> Revelar</TabsTrigger>
        </TabsList>

        <TabsContent value="hide" className="space-y-3 pt-3">
          {!coverFile && (
            <Dropzone
              onFiles={onCover}
              accept="image/png,image/jpeg,image/webp"
              title="Solte a imagem-capa"
              hint="PNG, JPG ou WEBP — a saída será sempre PNG"
            />
          )}

          {coverFile && coverCanvas && (
            <>
              <div className="flex items-center justify-between text-sm">
                <span>
                  <span className="font-medium">{coverFile.name}</span>{" "}
                  <span className="text-muted-foreground">
                    ({coverCanvas.width}×{coverCanvas.height})
                  </span>
                </span>
                <Button variant="ghost" size="sm" onClick={() => { setCoverFile(null); setCoverCanvas(null); }}>
                  Trocar
                </Button>
              </div>

              <RadioGroup value={mode} onValueChange={(v) => setMode(v as "text" | "file")} className="flex gap-4">
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="text" id="m-text" />
                  <Label htmlFor="m-text" className="cursor-pointer">Mensagem de texto</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="file" id="m-file" />
                  <Label htmlFor="m-file" className="cursor-pointer">Arquivo (até 2 MB)</Label>
                </div>
              </RadioGroup>

              {mode === "text" ? (
                <div className="space-y-1">
                  <Label>Mensagem secreta</Label>
                  <Textarea
                    value={secretText}
                    onChange={(e) => setSecretText(e.target.value)}
                    rows={5}
                    placeholder="Digite aqui o que ficará escondido na imagem..."
                  />
                </div>
              ) : (
                <div className="space-y-2">
                  {!secretFile ? (
                    <Dropzone
                      onFiles={onSecretFile}
                      title="Arquivo a esconder"
                      hint="Qualquer tipo, até 2 MB"
                    />
                  ) : (
                    <div className="flex items-center justify-between text-sm rounded-md border border-border px-3 py-2">
                      <span>
                        <span className="font-medium">{secretFile.name}</span>{" "}
                        <span className="text-muted-foreground">({(secretFile.size / 1024).toFixed(1)} KB)</span>
                      </span>
                      <Button variant="ghost" size="sm" onClick={() => setSecretFile(null)}>Remover</Button>
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Capacidade usada</span>
                  <span>
                    {(usedBytes / 1024).toFixed(1)} KB / {(capacity / 1024).toFixed(1)} KB
                  </span>
                </div>
                <Progress value={pct} />
                {usedBytes > capacity && (
                  <p className="text-xs text-destructive flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" /> Excede a capacidade — use uma imagem maior ou reduza o conteúdo.
                  </p>
                )}
              </div>

              <div className="space-y-1">
                <Label>Senha</Label>
                <div className="flex gap-2">
                  <Input
                    type={showPwd1 ? "text" : "password"}
                    value={pwd1}
                    onChange={(e) => setPwd1(e.target.value)}
                    placeholder="Senha forte (a mesma será exigida para revelar)"
                  />
                  <Button type="button" variant="outline" size="icon" onClick={() => setShowPwd1((s) => !s)}>
                    {showPwd1 ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </Button>
                </div>
              </div>

              <Button onClick={doEmbed} disabled={embedding} className="gap-2">
                {embedding ? <Loader2 className="w-4 h-4 animate-spin" /> : <EyeOff className="w-4 h-4" />}
                {embedding ? "Escondendo..." : "Esconder e baixar PNG"}
              </Button>
            </>
          )}
        </TabsContent>

        <TabsContent value="reveal" className="space-y-3 pt-3">
          {!stegoFile && (
            <Dropzone
              onFiles={onStego}
              accept="image/png"
              title="Solte o PNG com mensagem oculta"
              hint="Apenas PNG"
            />
          )}

          {stegoFile && (
            <>
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{stegoFile.name}</span>
                <Button variant="ghost" size="sm" onClick={() => { setStegoFile(null); setRevealed(null); }}>Trocar</Button>
              </div>

              <div className="space-y-1">
                <Label>Senha</Label>
                <div className="flex gap-2">
                  <Input
                    type={showPwd2 ? "text" : "password"}
                    value={pwd2}
                    onChange={(e) => setPwd2(e.target.value)}
                    placeholder="Senha usada ao esconder"
                  />
                  <Button type="button" variant="outline" size="icon" onClick={() => setShowPwd2((s) => !s)}>
                    {showPwd2 ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </Button>
                </div>
              </div>

              <Button onClick={doExtract} disabled={extracting} className="gap-2">
                {extracting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
                {extracting ? "Revelando..." : "Revelar mensagem"}
              </Button>

              {revealed && (
                <div className="space-y-2 pt-2">
                  <Label>Resultado</Label>
                  {revealed.kind === "text" ? (
                    <Textarea value={revealed.text ?? ""} readOnly rows={6} />
                  ) : (
                    <div className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
                      <span>
                        <span className="font-medium">{revealed.fileName}</span>{" "}
                        <span className="text-muted-foreground">
                          ({((revealed.fileBytes?.length ?? 0) / 1024).toFixed(1)} KB)
                        </span>
                      </span>
                      <Button size="sm" variant="outline" onClick={downloadRevealedFile} className="gap-2">
                        <Download className="w-4 h-4" /> Baixar arquivo
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default SteganographyTool;