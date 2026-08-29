import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, Wallet } from "lucide-react";
import {
  calcularRescisao,
  moeda,
  TABELA_INSS_PADRAO,
  TABELA_IRRF_PADRAO,
  TIPOS_RESCISAO,
  type TabelaInss,
  type TabelaIrrf,
  type TipoRescisao,
} from "@/lib/advocacia/rescisao";
import { chaveData } from "@/lib/advocacia/feriados";
import AvisoJuridico from "./shared/AvisoJuridico";

const numero = (valor: string) => Number(valor.replace(/\./g, "").replace(",", ".")) || 0;

const RescisaoCalculator = () => {
  const [salario, setSalario] = useState("3000");
  const [variaveis, setVariaveis] = useState("0");
  const [admissao, setAdmissao] = useState("2020-03-10");
  const [demissao, setDemissao] = useState(chaveData(new Date()));
  const [tipo, setTipo] = useState<TipoRescisao>("sem-justa-causa");
  const [aviso, setAviso] = useState<"indenizado" | "trabalhado" | "dispensado">("indenizado");
  const [feriasVencidas, setFeriasVencidas] = useState("0");
  const [saldoFgts, setSaldoFgts] = useState("0");
  const [dependentes, setDependentes] = useState("0");

  const [tabelaInss, setTabelaInss] = useState<TabelaInss>(TABELA_INSS_PADRAO);
  const [tabelaIrrf, setTabelaIrrf] = useState<TabelaIrrf>(TABELA_IRRF_PADRAO);

  const resultado = useMemo(
    () =>
      calcularRescisao(
        {
          salarioMensal: numero(salario),
          mediaVariaveis: numero(variaveis),
          admissao,
          demissao,
          tipo,
          avisoPrevio: aviso,
          feriasVencidas: Number(feriasVencidas) || 0,
          saldoFgts: numero(saldoFgts),
          dependentes: Number(dependentes) || 0,
        },
        tabelaInss,
        tabelaIrrf,
      ),
    [salario, variaveis, admissao, demissao, tipo, aviso, feriasVencidas, saldoFgts, dependentes, tabelaInss, tabelaIrrf],
  );

  const proventos = resultado.verbas?.filter((v) => v.grupo === "provento") ?? [];
  const descontos = resultado.verbas?.filter((v) => v.grupo === "desconto") ?? [];
  const fgts = resultado.verbas?.filter((v) => v.grupo === "fgts") ?? [];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="salario">Salário mensal (R$)</Label>
          <Input id="salario" value={salario} onChange={(e) => setSalario(e.target.value)} inputMode="decimal" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="variaveis">Média de variáveis (R$)</Label>
          <Input id="variaveis" value={variaveis} onChange={(e) => setVariaveis(e.target.value)} inputMode="decimal" />
          <p className="text-xs text-muted-foreground">Horas extras, comissões e adicionais habituais.</p>
        </div>
        <div className="space-y-2">
          <Label>Motivo</Label>
          <Select value={tipo} onValueChange={(v) => setTipo(v as TipoRescisao)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {TIPOS_RESCISAO.map((t) => (
                <SelectItem key={t.valor} value={t.valor}>{t.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{TIPOS_RESCISAO.find((t) => t.valor === tipo)?.base}</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="admissao">Admissão</Label>
          <Input id="admissao" type="date" value={admissao} onChange={(e) => setAdmissao(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="demissao">Rescisão</Label>
          <Input id="demissao" type="date" value={demissao} onChange={(e) => setDemissao(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Aviso prévio</Label>
          <Select value={aviso} onValueChange={(v) => setAviso(v as typeof aviso)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="indenizado">Indenizado</SelectItem>
              <SelectItem value="trabalhado">Trabalhado</SelectItem>
              <SelectItem value="dispensado">Dispensado / não se aplica</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="ferias-vencidas">Períodos de férias vencidas</Label>
          <Input id="ferias-vencidas" value={feriasVencidas} onChange={(e) => setFeriasVencidas(e.target.value.replace(/\D/g, "").slice(0, 2))} inputMode="numeric" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="saldo-fgts">Saldo do FGTS depositado (R$)</Label>
          <Input id="saldo-fgts" value={saldoFgts} onChange={(e) => setSaldoFgts(e.target.value)} inputMode="decimal" />
          <p className="text-xs text-muted-foreground">Base da multa. Consulte no app do FGTS.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="dependentes">Dependentes (IRRF)</Label>
          <Input id="dependentes" value={dependentes} onChange={(e) => setDependentes(e.target.value.replace(/\D/g, "").slice(0, 2))} inputMode="numeric" />
        </div>
      </div>

      {!resultado.ok ? (
        <div className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">{resultado.erro}</div>
      ) : (
        <>
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-5">
            <div className="flex items-start gap-3">
              <Wallet className="mt-1 h-5 w-5 shrink-0 text-primary" />
              <div className="w-full space-y-1">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Líquido da rescisão</p>
                <p className="font-heading text-3xl text-foreground">{moeda(resultado.liquido!)}</p>
                <p className="text-sm text-muted-foreground">
                  {moeda(resultado.totalProventos!)} em proventos − {moeda(resultado.totalDescontos!)} em descontos
                </p>
                <p className="text-sm text-emerald-500">
                  + {moeda(resultado.totalFgts!)} em FGTS, creditados na conta vinculada
                </p>
                {resultado.diasAviso! > 0 && (
                  <p className="pt-1 text-xs text-muted-foreground">
                    {resultado.anosCompletos} ano(s) completo(s) · aviso de {resultado.diasAviso} dias · contrato
                    projetado até {resultado.dataProjetada?.split("-").reverse().join("/")}
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            {[
              { titulo: "Proventos", itens: proventos, cor: "text-foreground" },
              { titulo: "Descontos", itens: descontos, cor: "text-destructive" },
              { titulo: "FGTS — não entra no líquido", itens: fgts, cor: "text-emerald-500" },
            ]
              .filter((secao) => secao.itens.length > 0)
              .map((secao) => (
                <div key={secao.titulo} className="rounded-lg border border-border">
                  <p className="border-b border-border px-4 py-2 text-xs uppercase tracking-wide text-muted-foreground">
                    {secao.titulo}
                  </p>
                  <div className="divide-y divide-border">
                    {secao.itens.map((v) => (
                      <div key={v.chave} className="flex items-center justify-between gap-4 px-4 py-2.5">
                        <div className="min-w-0">
                          <p className="text-sm text-foreground">{v.descricao}</p>
                          {v.detalhe && <p className="text-xs text-muted-foreground">{v.detalhe}</p>}
                        </div>
                        <span className={`shrink-0 font-mono text-sm ${secao.cor}`}>
                          {moeda(Math.abs(v.valor))}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
          </div>

          {resultado.avisos && resultado.avisos.length > 0 && (
            <ul className="space-y-1 text-xs text-muted-foreground">
              {resultado.avisos.map((a) => (
                <li key={a}>· {a}</li>
              ))}
            </ul>
          )}
        </>
      )}

      <Collapsible>
        <CollapsibleTrigger className="flex w-full items-center justify-between rounded-lg border border-border p-3 text-sm hover:bg-secondary/40">
          <span>
            Tabelas de INSS e IRRF
            <Badge variant="secondary" className="ml-2">
              {tabelaInss.vigencia} / {tabelaIrrf.vigencia}
            </Badge>
          </span>
          <ChevronDown className="h-4 w-4" />
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-4 pt-3">
          <p className="text-xs text-amber-500">
            Estes valores são de referência e <strong>envelhecem</strong>. Confira contra a fonte oficial e
            corrija abaixo antes de usar o resultado em qualquer coisa que valha dinheiro.
          </p>

          <div className="space-y-2">
            <Label>INSS — faixas (teto de cada faixa e alíquota)</Label>
            {tabelaInss.faixas.map((faixa, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  value={String(faixa.ate)}
                  inputMode="decimal"
                  onChange={(e) => {
                    const faixas = [...tabelaInss.faixas];
                    faixas[i] = { ...faixa, ate: numero(e.target.value) };
                    setTabelaInss({ ...tabelaInss, faixas, vigencia: "editada" });
                  }}
                />
                <Input
                  value={String(faixa.aliquota * 100)}
                  inputMode="decimal"
                  onChange={(e) => {
                    const faixas = [...tabelaInss.faixas];
                    faixas[i] = { ...faixa, aliquota: numero(e.target.value) / 100 };
                    setTabelaInss({ ...tabelaInss, faixas, vigencia: "editada" });
                  }}
                  className="w-24"
                />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <Label>IRRF — dedução por dependente</Label>
            <Input
              value={String(tabelaIrrf.porDependente)}
              inputMode="decimal"
              onChange={(e) =>
                setTabelaIrrf({ ...tabelaIrrf, porDependente: numero(e.target.value), vigencia: "editada" })
              }
              className="w-40"
            />
          </div>
        </CollapsibleContent>
      </Collapsible>

      <AvisoJuridico>
        O cálculo cobre as <strong>verbas rescisórias típicas</strong> da CLT. Não entram acordos coletivos,
        insalubridade, periculosidade, adicional noturno, pensão alimentícia, contribuição sindical, vale-transporte,
        plano de saúde nem outros descontos do seu contrato. Confira também as tabelas de INSS e IRRF acima —
        elas mudam por ato do governo e a ferramenta não tem como saber quando isso acontece.
      </AvisoJuridico>
    </div>
  );
};

export default RescisaoCalculator;
