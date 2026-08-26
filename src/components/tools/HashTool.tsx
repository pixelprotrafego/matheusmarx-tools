import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Check, X, Copy } from "lucide-react";

const MAX_LEN = 50 * 1024 * 1024;

const ALGOS = ["SHA-1", "SHA-256", "SHA-384", "SHA-512"] as const;

async function digestHex(algo: string, text: string): Promise<string> {
  const buf = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest(algo, buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Comparação constant-time (sem early-return) — boa prática mesmo client-side.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

const HashTool = () => {
  // Aba Calcular
  const [text, setText] = useState("");
  const [algo, setAlgo] = useState("SHA-256");
  const [out, setOut] = useState("");

  // Aba Verificar
  const [vText, setVText] = useState("");
  const [vAlgo, setVAlgo] = useState("SHA-256");
  const [vExpected, setVExpected] = useState("");
  const [vResult, setVResult] = useState<{ ok: boolean; actual: string } | null>(null);

  const go = async () => {
    if (text.length > MAX_LEN) {
      toast.error("Texto muito grande (máx. 50 MB)");
      return;
    }
    setOut(await digestHex(algo, text));
  };

  const verify = async () => {
    if (vText.length > MAX_LEN) {
      toast.error("Texto muito grande (máx. 50 MB)");
      return;
    }
    const expected = vExpected.trim().toLowerCase();
    if (!expected) {
      toast.error("Informe o hash esperado");
      return;
    }
    const actual = await digestHex(vAlgo, vText);
    setVResult({ ok: safeEqual(actual, expected), actual });
  };

  const copy = async () => {
    await navigator.clipboard.writeText(out);
    toast.success("Hash copiado");
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        SHA é unidirecional — não há como recuperar o texto a partir do hash. Use{" "}
        <span className="text-foreground font-medium">Verificar</span> para confirmar
        se um texto corresponde a um hash conhecido.
      </p>

      <Tabs defaultValue="calc" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="calc">Calcular</TabsTrigger>
          <TabsTrigger value="verify">Verificar</TabsTrigger>
        </TabsList>

        <TabsContent value="calc" className="space-y-3 mt-4">
          <Label>Texto</Label>
          <Textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} />
          <Select value={algo} onValueChange={setAlgo}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ALGOS.map((a) => (
                <SelectItem key={a} value={a}>
                  {a}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={go}>Calcular</Button>
          {out && (
            <div className="space-y-2">
              <pre className="text-xs break-all p-3 bg-secondary/40 rounded">{out}</pre>
              <Button variant="outline" size="sm" onClick={copy}>
                <Copy className="w-3.5 h-3.5 mr-1.5" /> Copiar
              </Button>
            </div>
          )}
        </TabsContent>

        <TabsContent value="verify" className="space-y-3 mt-4">
          <Label>Texto original</Label>
          <Textarea rows={5} value={vText} onChange={(e) => setVText(e.target.value)} />
          <Label>Hash esperado</Label>
          <Input
            placeholder="cole aqui o hash a verificar"
            value={vExpected}
            onChange={(e) => setVExpected(e.target.value)}
            className="font-mono text-xs"
          />
          <Select value={vAlgo} onValueChange={setVAlgo}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ALGOS.map((a) => (
                <SelectItem key={a} value={a}>
                  {a}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={verify}>Verificar</Button>
          {vResult && (
            <div
              className={`rounded-lg border p-3 space-y-2 ${
                vResult.ok
                  ? "border-primary/40 bg-primary/10"
                  : "border-destructive/40 bg-destructive/10"
              }`}
            >
              <div className="flex items-center gap-2 text-sm font-medium">
                {vResult.ok ? (
                  <>
                    <Check className="w-4 h-4 text-primary" />
                    <span className="text-primary">Hash confere</span>
                  </>
                ) : (
                  <>
                    <X className="w-4 h-4 text-destructive" />
                    <span className="text-destructive">Hash não confere</span>
                  </>
                )}
              </div>
              <div className="text-xs text-muted-foreground">Hash calculado:</div>
              <pre className="text-xs break-all p-2 bg-background/40 rounded">
                {vResult.actual}
              </pre>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};
export default HashTool;