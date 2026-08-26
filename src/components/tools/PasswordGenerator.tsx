import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Copy, RefreshCw, Check } from "lucide-react";
import { toast } from "sonner";

const LOWER = "abcdefghijkmnpqrstuvwxyz";
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGITS = "23456789";
const SYMBOLS = "!@#$%&*?+-_=";

function generate(length: number, lower: boolean, upper: boolean, digits: boolean, symbols: boolean) {
  let pool = "";
  if (lower) pool += LOWER;
  if (upper) pool += UPPER;
  if (digits) pool += DIGITS;
  if (symbols) pool += SYMBOLS;
  if (!pool) pool = LOWER;
  const len = Math.min(128, Math.max(6, length));
  const arr = new Uint32Array(len);
  crypto.getRandomValues(arr);
  let out = "";
  for (let i = 0; i < len; i++) out += pool[arr[i] % pool.length];
  return out;
}

function strength(pw: string): { label: string; color: string; pct: number } {
  let score = 0;
  if (pw.length >= 12) score++;
  if (pw.length >= 20) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  const map = [
    { label: "Fraca", color: "bg-destructive", pct: 20 },
    { label: "Razoável", color: "bg-orange-500", pct: 40 },
    { label: "Boa", color: "bg-yellow-500", pct: 60 },
    { label: "Forte", color: "bg-green-500", pct: 80 },
    { label: "Muito forte", color: "bg-primary", pct: 100 },
  ];
  return map[Math.min(score, 4)];
}

const PasswordGenerator = () => {
  const [length, setLength] = useState(16);
  const [lower, setLower] = useState(true);
  const [upper, setUpper] = useState(true);
  const [digits, setDigits] = useState(true);
  const [symbols, setSymbols] = useState(true);
  const [pw, setPw] = useState(() => generate(16, true, true, true, true));
  const [copied, setCopied] = useState(false);

  const regen = () => {
    if (!lower && !upper && !digits && !symbols) {
      setLower(true);
      toast.message("Selecione ao menos um tipo de caractere — minúsculas reativadas.");
      setPw(generate(length, true, upper, digits, symbols));
      return;
    }
    setPw(generate(length, lower, upper, digits, symbols));
  };
  const copy = async () => {
    await navigator.clipboard.writeText(pw);
    setCopied(true);
    toast.success("Senha copiada");
    setTimeout(() => setCopied(false), 1500);
  };

  const s = strength(pw);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label className="text-xs">Senha gerada</Label>
        <div className="flex gap-2">
          <Input value={pw} readOnly className="font-mono" />
          <Button variant="outline" size="icon" onClick={copy} aria-label="Copiar">
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          </Button>
          <Button variant="outline" size="icon" onClick={regen} aria-label="Gerar nova">
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-secondary rounded overflow-hidden">
            <div className={`h-full ${s.color} transition-all`} style={{ width: `${s.pct}%` }} />
          </div>
          <span className="text-xs text-muted-foreground w-24 text-right">{s.label}</span>
        </div>
      </div>

      <div className="space-y-3 pt-2">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Tamanho</Label>
            <span className="text-xs text-muted-foreground">{length} caracteres</span>
          </div>
          <Slider
            value={[length]}
            min={6}
            max={64}
            step={1}
            onValueChange={(v) => setLength(v[0])}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <label className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 cursor-pointer">
            <span className="text-sm">Minúsculas</span>
            <Switch checked={lower} onCheckedChange={setLower} />
          </label>
          <label className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 cursor-pointer">
            <span className="text-sm">Maiúsculas</span>
            <Switch checked={upper} onCheckedChange={setUpper} />
          </label>
          <label className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 cursor-pointer">
            <span className="text-sm">Números</span>
            <Switch checked={digits} onCheckedChange={setDigits} />
          </label>
          <label className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 cursor-pointer">
            <span className="text-sm">Símbolos</span>
            <Switch checked={symbols} onCheckedChange={setSymbols} />
          </label>
        </div>

        <Button onClick={regen} className="w-full sm:w-auto gap-2">
          <RefreshCw className="w-4 h-4" /> Gerar nova senha
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Senhas geradas localmente usando crypto.getRandomValues — nada é enviado para servidor.
      </p>
    </div>
  );
};

export default PasswordGenerator;