import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Copy, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { gerarCnj, SEGMENTOS, tribunaisDoSegmento } from "@/lib/advocacia/cnj";
import AvisoJuridico from "./shared/AvisoJuridico";

const anoAtual = new Date().getFullYear();

const CnjGenerator = () => {
  const [segmento, setSegmento] = useState("8");
  const [tribunal, setTribunal] = useState("26");
  const [ano, setAno] = useState(String(anoAtual));
  const [origem, setOrigem] = useState("0001");
  const [quantidade, setQuantidade] = useState("5");
  const [numeros, setNumeros] = useState<string[]>([]);

  const tribunais = useMemo(() => tribunaisDoSegmento(segmento), [segmento]);

  // Ao trocar de segmento, o código de tribunal anterior pode não existir mais
  // na nova lista — sem isto o formulário ficaria com uma combinação impossível.
  useEffect(() => {
    if (!tribunais.some((t) => t.codigo === tribunal)) {
      setTribunal(tribunais[0]?.codigo ?? "00");
    }
  }, [tribunais, tribunal]);

  const gerar = useCallback(() => {
    const quantos = Math.min(50, Math.max(1, Number(quantidade) || 1));
    const anoNumero = Math.min(2999, Math.max(1900, Number(ano) || anoAtual));
    setNumeros(
      Array.from({ length: quantos }, () =>
        gerarCnj({ ano: anoNumero, segmento, tribunal, origem }),
      ),
    );
  }, [quantidade, ano, segmento, tribunal, origem]);

  useEffect(() => {
    gerar();
    // Só na montagem: depois disso quem manda é o botão.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copiarTudo = async () => {
    await navigator.clipboard.writeText(numeros.join("\n"));
    toast.success(`${numeros.length} número(s) copiado(s).`);
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Segmento do Judiciário</Label>
          <Select value={segmento} onValueChange={setSegmento}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(SEGMENTOS).map(([codigo, nome]) => (
                <SelectItem key={codigo} value={codigo}>{codigo} — {nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Tribunal / região</Label>
          <Select value={tribunal} onValueChange={setTribunal}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {tribunais.map((t) => (
                <SelectItem key={t.codigo} value={t.codigo}>{t.codigo} — {t.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="ano-cnj">Ano do ajuizamento</Label>
          <Input id="ano-cnj" value={ano} onChange={(e) => setAno(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" />
        </div>

        <div className="space-y-2">
          <Label htmlFor="origem-cnj">Unidade de origem</Label>
          <Input
            id="origem-cnj"
            value={origem}
            onChange={(e) => setOrigem(e.target.value.replace(/\D/g, "").slice(0, 4))}
            inputMode="numeric"
            placeholder="0001"
          />
          <p className="text-xs text-muted-foreground">Código da vara, foro ou juizado — quatro dígitos.</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="qtd-cnj">Quantos números</Label>
          <Input
            id="qtd-cnj"
            value={quantidade}
            onChange={(e) => setQuantidade(e.target.value.replace(/\D/g, "").slice(0, 2))}
            inputMode="numeric"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={gerar} className="gap-2">
          <RefreshCw className="h-4 w-4" /> Gerar
        </Button>
        {numeros.length > 0 && (
          <Button variant="outline" onClick={copiarTudo} className="gap-2">
            <Copy className="h-4 w-4" /> Copiar todos
          </Button>
        )}
      </div>

      {numeros.length > 0 && (
        <div className="space-y-1 rounded-lg border border-border p-3">
          {numeros.map((n, i) => (
            <button
              key={`${n}-${i}`}
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(n);
                toast.success("Copiado.");
              }}
              className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left font-mono text-sm text-foreground transition-colors hover:bg-secondary/60"
            >
              {n}
              <Copy className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          ))}
        </div>
      )}

      <AvisoJuridico>
        Os números saem <strong>válidos na estrutura e fictícios no conteúdo</strong>: o dígito verificador
        fecha, mas não correspondem a processo algum. Servem para preencher modelo de petição, testar sistema
        e dar exemplo em aula. Não use como se fosse um processo real.
      </AvisoJuridico>
    </div>
  );
};

export default CnjGenerator;
