import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { CalendarDays, ChevronDown, Plus, Trash2 } from "lucide-react";
import { calcularPrazo, formatarLongo, type RegimeContagem } from "@/lib/advocacia/prazos";
import { chaveData } from "@/lib/advocacia/feriados";
import AvisoJuridico from "./shared/AvisoJuridico";

/** Feriados locais ficam no navegador: são de quem usa, não do site. */
const ARMAZEM = "mmtools.prazos.feriados";

interface FeriadoLocal {
  data: string;
  nome: string;
}

const carregarFeriados = (): FeriadoLocal[] => {
  try {
    const bruto = localStorage.getItem(ARMAZEM);
    const lista = bruto ? JSON.parse(bruto) : [];
    return Array.isArray(lista) ? lista.filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f?.data)) : [];
  } catch {
    return [];
  }
};

const REGIMES: { valor: RegimeContagem; nome: string; base: string }[] = [
  { valor: "uteis", nome: "Dias úteis", base: "CPC, art. 219 · CLT, art. 775" },
  { valor: "corridos", nome: "Dias corridos", base: "CPP, art. 798 · prazos de direito material" },
];

const PrazoProcessual = () => {
  const [publicacao, setPublicacao] = useState(chaveData(new Date()));
  const [dias, setDias] = useState("15");
  const [regime, setRegime] = useState<RegimeContagem>("uteis");
  const [suspenderRecesso, setSuspenderRecesso] = useState(true);
  const [incluirForenses, setIncluirForenses] = useState(true);
  const [incluirMoveis, setIncluirMoveis] = useState(true);
  const [feriados, setFeriados] = useState<FeriadoLocal[]>([]);
  const [novaData, setNovaData] = useState("");
  const [novoNome, setNovoNome] = useState("");

  useEffect(() => setFeriados(carregarFeriados()), []);

  const salvar = (lista: FeriadoLocal[]) => {
    setFeriados(lista);
    try {
      localStorage.setItem(ARMAZEM, JSON.stringify(lista));
    } catch {
      /* navegador sem armazenamento: a lista vale só nesta sessão */
    }
  };

  const resultado = useMemo(
    () =>
      calcularPrazo({
        regime,
        dias: Number(dias) || 0,
        publicacao,
        suspenderRecesso,
        incluirForenses,
        incluirCarnavalCorpusChristi: incluirMoveis,
        personalizados: feriados,
      }),
    [regime, dias, publicacao, suspenderRecesso, incluirForenses, incluirMoveis, feriados],
  );

  const pulados = resultado.trilha?.filter((d) => d.numero === null) ?? [];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="publicacao">Publicação / intimação</Label>
          <Input id="publicacao" type="date" value={publicacao} onChange={(e) => setPublicacao(e.target.value)} />
          <p className="text-xs text-muted-foreground">Este dia não conta (CPC, art. 224).</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="dias">Prazo</Label>
          <Input
            id="dias"
            value={dias}
            onChange={(e) => setDias(e.target.value.replace(/\D/g, "").slice(0, 4))}
            inputMode="numeric"
          />
        </div>

        <div className="space-y-2">
          <Label>Contagem</Label>
          <Select value={regime} onValueChange={(v) => setRegime(v as RegimeContagem)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {REGIMES.map((r) => (
                <SelectItem key={r.valor} value={r.valor}>{r.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{REGIMES.find((r) => r.valor === regime)?.base}</p>
        </div>
      </div>

      {resultado.ok ? (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-5">
          <div className="flex items-start gap-3">
            <CalendarDays className="mt-1 h-5 w-5 shrink-0 text-primary" />
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Vencimento</p>
              <p className="font-heading text-2xl text-foreground">{formatarLongo(resultado.vencimento!)}</p>
              <p className="text-sm text-muted-foreground">
                Contagem iniciada em {formatarLongo(resultado.inicio!)} · {resultado.diasCorridosTotais} dias
                de calendário desde a publicação
              </p>
              {resultado.prorrogado && (
                <p className="text-sm text-amber-500">
                  Venceria em {formatarLongo(resultado.vencimentoOriginal!)}, sem expediente — prorrogado
                  (CPC, art. 224, §1º).
                </p>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">{resultado.erro}</div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
          <span className="text-sm">
            Recesso 20/12–20/01
            <span className="block text-xs text-muted-foreground">CPC, art. 220 · CLT, art. 775-A</span>
          </span>
          <Switch checked={suspenderRecesso} onCheckedChange={setSuspenderRecesso} />
        </label>

        <label className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
          <span className="text-sm">
            Feriados forenses
            <span className="block text-xs text-muted-foreground">11/08, 01/11 e 08/12</span>
          </span>
          <Switch checked={incluirForenses} onCheckedChange={setIncluirForenses} />
        </label>

        <label className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
          <span className="text-sm">
            Carnaval e Corpus Christi
            <span className="block text-xs text-muted-foreground">Sem expediente forense</span>
          </span>
          <Switch checked={incluirMoveis} onCheckedChange={setIncluirMoveis} />
        </label>
      </div>

      <Collapsible>
        <CollapsibleTrigger className="flex w-full items-center justify-between rounded-lg border border-border p-3 text-sm hover:bg-secondary/40">
          <span>
            Feriados locais
            {feriados.length > 0 && (
              <Badge variant="secondary" className="ml-2">{feriados.length}</Badge>
            )}
          </span>
          <ChevronDown className="h-4 w-4" />
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-3 pt-3">
          <p className="text-xs text-muted-foreground">
            Feriado estadual, municipal e suspensão de expediente por portaria variam por comarca e mudam
            todo ano — por isso não vêm prontos. O que você cadastrar aqui fica salvo neste navegador.
          </p>
          <div className="flex flex-wrap gap-2">
            <Input type="date" value={novaData} onChange={(e) => setNovaData(e.target.value)} className="w-auto" />
            <Input
              placeholder="Nome (ex.: aniversário da cidade)"
              value={novoNome}
              onChange={(e) => setNovoNome(e.target.value)}
              className="min-w-[16rem] flex-1"
            />
            <Button
              variant="outline"
              className="gap-2"
              disabled={!/^\d{4}-\d{2}-\d{2}$/.test(novaData)}
              onClick={() => {
                salvar([...feriados.filter((f) => f.data !== novaData), { data: novaData, nome: novoNome }]
                  .sort((a, b) => a.data.localeCompare(b.data)));
                setNovaData("");
                setNovoNome("");
              }}
            >
              <Plus className="h-4 w-4" /> Adicionar
            </Button>
          </div>
          {feriados.map((f) => (
            <div key={f.data} className="flex items-center justify-between rounded bg-secondary/40 px-3 py-2 text-sm">
              <span>
                <span className="font-mono">{f.data.split("-").reverse().join("/")}</span>
                <span className="ml-2 text-muted-foreground">{f.nome || "Feriado local"}</span>
              </span>
              <Button variant="ghost" size="icon" onClick={() => salvar(feriados.filter((x) => x.data !== f.data))}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </CollapsibleContent>
      </Collapsible>

      {resultado.ok && pulados.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger className="flex w-full items-center justify-between rounded-lg border border-border p-3 text-sm hover:bg-secondary/40">
            <span>
              Dias que não contaram
              <Badge variant="secondary" className="ml-2">{pulados.length}</Badge>
            </span>
            <ChevronDown className="h-4 w-4" />
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3">
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {pulados.map((d) => (
                <div key={d.data} className="flex items-center justify-between rounded bg-secondary/30 px-3 py-1.5 text-sm">
                  <span className="font-mono text-xs">{formatarLongo(d.data)}</span>
                  <span className="text-xs text-muted-foreground">
                    {d.motivo === "fim-de-semana" && "fim de semana"}
                    {d.motivo === "recesso" && "recesso forense"}
                    {d.motivo === "feriado" && (d.feriado ?? "feriado")}
                  </span>
                </div>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      <AvisoJuridico>
        A conta usa os feriados nacionais, os móveis e os forenses de alcance nacional. <strong>Feriado
        estadual, municipal e suspensão de expediente do seu tribunal não estão incluídos</strong> — cadastre-os
        acima. Confira sempre o calendário oficial do tribunal antes de confiar na data: prazo é matéria de
        preclusão.
      </AvisoJuridico>
    </div>
  );
};

export default PrazoProcessual;
