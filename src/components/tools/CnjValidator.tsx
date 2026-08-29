import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, Copy } from "lucide-react";
import { toast } from "sonner";
import { formatarCnj, validarCnj } from "@/lib/advocacia/cnj";
import AvisoJuridico from "./shared/AvisoJuridico";

/** Aplica a máscara enquanto se digita, sem atrapalhar quem cola o número. */
const mascarar = (valor: string) => {
  const d = valor.replace(/\D/g, "").slice(0, 20);
  if (d.length <= 7) return d;
  if (d.length <= 9) return `${d.slice(0, 7)}-${d.slice(7)}`;
  if (d.length <= 13) return `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9)}`;
  if (d.length <= 14) return `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}.${d.slice(13)}`;
  if (d.length <= 16) return `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}.${d.slice(13, 14)}.${d.slice(14)}`;
  return formatarCnj(d);
};

const Campo = ({ rotulo, valor }: { rotulo: string; valor: string }) => (
  <div className="rounded-lg bg-secondary/40 p-3">
    <p className="text-xs text-muted-foreground">{rotulo}</p>
    <p className="font-mono text-sm text-foreground">{valor}</p>
  </div>
);

const CnjValidator = () => {
  const [entrada, setEntrada] = useState("");
  const resultado = useMemo(() => (entrada.replace(/\D/g, "") ? validarCnj(entrada) : null), [entrada]);

  const copiar = async (texto: string) => {
    await navigator.clipboard.writeText(texto);
    toast.success("Copiado.");
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="numero-processo">Número do processo</Label>
        <Input
          id="numero-processo"
          value={entrada}
          onChange={(e) => setEntrada(mascarar(e.target.value))}
          placeholder="0000000-00.0000.0.00.0000"
          className="font-mono text-lg"
          inputMode="numeric"
          autoComplete="off"
        />
        <p className="text-xs text-muted-foreground">
          Pode colar com ou sem pontuação — 20 dígitos no total.
        </p>
      </div>

      {resultado && !resultado.valido && (
        <div className="flex items-start gap-3 rounded-lg bg-destructive/10 p-4 text-destructive">
          <XCircle className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="space-y-1">
            <p className="text-sm font-medium">{resultado.erro}</p>
            {resultado.digitoEsperado && (
              <p className="text-xs">
                Para os demais campos digitados, o dígito verificador seria{" "}
                <span className="font-mono font-semibold">{resultado.digitoEsperado}</span>.
              </p>
            )}
          </div>
        </div>
      )}

      {resultado?.valido && resultado.campos && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-lg bg-emerald-500/10 p-4 text-emerald-500">
            <CheckCircle2 className="h-5 w-5 shrink-0" />
            <p className="text-sm font-medium">Número válido — o dígito verificador confere.</p>
          </div>

          <div className="rounded-lg border border-border p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs text-muted-foreground">Tramita em</p>
                <p className="font-heading text-lg text-foreground">{resultado.tribunal?.nome}</p>
              </div>
              {resultado.tribunal?.uf && (
                <Badge variant="secondary" className="shrink-0 text-sm">
                  {resultado.tribunal.uf}
                </Badge>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{resultado.segmentoNome}</Badge>
              {/*
                Região com mais de um estado: mostrar só a sigla enganaria, então
                lista-se a abrangência inteira.
              */}
              {resultado.tribunal && resultado.tribunal.ufs.length > 1 && (
                <span className="text-xs text-muted-foreground">
                  Abrange: {resultado.tribunal.ufs.join(", ")}
                </span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Campo rotulo="Sequencial" valor={resultado.campos.sequencial} />
            <Campo rotulo="Dígito" valor={resultado.campos.digito} />
            <Campo rotulo="Ano" valor={resultado.campos.ano} />
            <Campo rotulo="Segmento" valor={resultado.campos.segmento} />
            <Campo rotulo="Tribunal" valor={resultado.campos.tribunal} />
            <Campo rotulo="Unidade de origem" valor={resultado.campos.origem} />
          </div>

          <Button variant="outline" size="sm" className="gap-2" onClick={() => copiar(resultado.formatado!)}>
            <Copy className="h-3.5 w-3.5" /> Copiar número formatado
          </Button>
        </div>
      )}

      <AvisoJuridico>
        A checagem é da <strong>estrutura</strong> do número, conforme a Resolução CNJ 65/2008: confirma que
        o dígito verificador fecha e traduz os códigos de segmento e tribunal. Não consulta tribunal nenhum,
        então não diz se o processo existe, em que vara está nem qual é o seu andamento — para isso, o portal
        do tribunal.
      </AvisoJuridico>
    </div>
  );
};

export default CnjValidator;
