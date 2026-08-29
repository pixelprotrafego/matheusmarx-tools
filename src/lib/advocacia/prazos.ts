/**
 * Contagem de prazo processual.
 *
 * Três regras comandam tudo o que está aqui:
 *
 * - **Exclui-se o dia do começo e inclui-se o do vencimento** (CPC, art. 224;
 *   CPP, art. 798, §1º). O dia da intimação nunca conta.
 * - **A contagem começa no primeiro dia útil seguinte** ao da publicação
 *   (CPC, art. 224, §3º). Publicou na sexta, o dia 1 é a segunda.
 * - **O vencimento em dia sem expediente prorroga** para o dia útil seguinte
 *   (CPC, art. 224, §1º).
 *
 * O que muda entre os regimes é só o que se conta no meio: em dias úteis
 * (CPC, art. 219, e CLT, art. 775) sábados, domingos e feriados são pulados;
 * em dias corridos (CPP, art. 798, e prazos de direito material) eles contam,
 * e apenas o vencimento é prorrogado.
 *
 * A saída traz o caminho dia a dia de propósito. Uma calculadora de prazo que
 * devolve só a data final pede para ser conferida à mão de qualquer jeito;
 * mostrando cada dia pulado e o porquê, dá para auditar o resultado sem
 * refazer a conta.
 */

import {
  chaveData,
  dataDeChave,
  ehFimDeSemana,
  montarCalendario,
  noRecesso,
  somarDias,
  type Feriado,
  type OpcoesFeriados,
} from "./feriados";

export type RegimeContagem = "uteis" | "corridos";

export interface OpcoesPrazo extends OpcoesFeriados {
  regime: RegimeContagem;
  /** Quantidade de dias do prazo. */
  dias: number;
  /** Data da intimação ou publicação — o dia do começo, que se exclui. */
  publicacao: string;
  /** Aplicar a suspensão de 20/12 a 20/01 (CPC, art. 220; CLT, art. 775-A). */
  suspenderRecesso: boolean;
}

export type MotivoPulo = "fim-de-semana" | "feriado" | "recesso";

export interface DiaDaContagem {
  data: string;
  /** Número do dia dentro do prazo; `null` quando o dia não foi contado. */
  numero: number | null;
  motivo?: MotivoPulo;
  /** Nome do feriado, quando o dia foi pulado por isso. */
  feriado?: string;
}

export interface ResultadoPrazo {
  ok: boolean;
  erro?: string;
  /** Primeiro dia efetivamente contado. */
  inicio?: string;
  /** Data final do prazo. */
  vencimento?: string;
  /** Verdadeiro quando o vencimento caiu em dia sem expediente e foi adiado. */
  prorrogado?: boolean;
  /** Dia em que o prazo venceria antes da prorrogação. */
  vencimentoOriginal?: string;
  trilha?: DiaDaContagem[];
  /** Total de dias de calendário entre a publicação e o vencimento. */
  diasCorridosTotais?: number;
}

/** Limite de dias de calendário examinados, para um erro de entrada não travar a aba. */
const TETO_DE_VARREDURA = 4000;

interface Contexto {
  feriados: Map<string, Feriado>;
  suspenderRecesso: boolean;
}

/** O dia tem expediente forense? */
function motivoDeNaoContar(data: Date, ctx: Contexto): { motivo: MotivoPulo; feriado?: string } | null {
  if (ehFimDeSemana(data)) return { motivo: "fim-de-semana" };
  const feriado = ctx.feriados.get(chaveData(data));
  if (feriado) return { motivo: "feriado", feriado: feriado.nome };
  if (ctx.suspenderRecesso && noRecesso(data)) return { motivo: "recesso" };
  return null;
}

/** Avança até encontrar um dia com expediente, incluindo a própria data. */
function proximoDiaUtil(data: Date, ctx: Contexto): Date {
  let cursor = data;
  for (let i = 0; i < TETO_DE_VARREDURA; i++) {
    if (!motivoDeNaoContar(cursor, ctx)) return cursor;
    cursor = somarDias(cursor, 1);
  }
  return cursor;
}

export function calcularPrazo(opcoes: OpcoesPrazo): ResultadoPrazo {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(opcoes.publicacao)) {
    return { ok: false, erro: "Informe a data da publicação ou intimação." };
  }
  if (!Number.isInteger(opcoes.dias) || opcoes.dias < 1) {
    return { ok: false, erro: "O prazo precisa ser de pelo menos 1 dia." };
  }
  if (opcoes.dias > 2000) {
    return { ok: false, erro: "Prazo acima de 2000 dias — confira o valor digitado." };
  }

  const publicacao = dataDeChave(opcoes.publicacao);
  if (Number.isNaN(publicacao.getTime())) {
    return { ok: false, erro: "Data inválida." };
  }

  // O calendário cobre com folga o intervalo que a contagem pode alcançar.
  const anoInicial = publicacao.getFullYear();
  const anoFinal = anoInicial + Math.ceil(opcoes.dias / 200) + 2;
  const ctx: Contexto = {
    feriados: montarCalendario(anoInicial - 1, anoFinal, opcoes),
    suspenderRecesso: opcoes.suspenderRecesso,
  };

  const trilha: DiaDaContagem[] = [];

  // Exclui-se o dia do começo: a contagem parte do dia seguinte ao da
  // publicação, e daí caminha até o primeiro dia com expediente.
  let cursor = somarDias(publicacao, 1);
  while (true) {
    const pulo = motivoDeNaoContar(cursor, ctx);
    if (!pulo) break;
    trilha.push({ data: chaveData(cursor), numero: null, motivo: pulo.motivo, feriado: pulo.feriado });
    cursor = somarDias(cursor, 1);
    if (trilha.length > TETO_DE_VARREDURA) {
      return { ok: false, erro: "Não foi possível achar um dia útil para iniciar a contagem." };
    }
  }

  const inicio = chaveData(cursor);
  let contados = 0;
  let ultimoContado = cursor;

  while (contados < opcoes.dias) {
    const pulo = motivoDeNaoContar(cursor, ctx);

    if (opcoes.regime === "uteis" && pulo) {
      trilha.push({ data: chaveData(cursor), numero: null, motivo: pulo.motivo, feriado: pulo.feriado });
    } else if (opcoes.regime === "corridos" && pulo?.motivo === "recesso") {
      // Em dias corridos, fim de semana e feriado contam; só a suspensão do
      // recesso, quando ligada, tira o dia da conta.
      trilha.push({ data: chaveData(cursor), numero: null, motivo: "recesso" });
    } else {
      contados++;
      ultimoContado = cursor;
      trilha.push({ data: chaveData(cursor), numero: contados });
    }

    if (contados < opcoes.dias) cursor = somarDias(cursor, 1);
    if (trilha.length > TETO_DE_VARREDURA) {
      return { ok: false, erro: "Contagem longa demais — revise o prazo informado." };
    }
  }

  // Prorrogação: o vencimento nunca cai em dia sem expediente. No regime de
  // dias úteis isso já é verdade por construção; em dias corridos, não.
  const vencimentoOriginal = chaveData(ultimoContado);
  const vencimentoFinal = proximoDiaUtil(ultimoContado, ctx);
  const prorrogado = chaveData(vencimentoFinal) !== vencimentoOriginal;

  if (prorrogado) {
    let extra = somarDias(ultimoContado, 1);
    while (chaveData(extra) <= chaveData(vencimentoFinal)) {
      const pulo = motivoDeNaoContar(extra, ctx);
      trilha.push({
        data: chaveData(extra),
        numero: null,
        motivo: pulo?.motivo,
        feriado: pulo?.feriado,
      });
      extra = somarDias(extra, 1);
    }
  }

  const diasCorridosTotais = Math.round(
    (vencimentoFinal.getTime() - publicacao.getTime()) / (1000 * 60 * 60 * 24),
  );

  return {
    ok: true,
    inicio,
    vencimento: chaveData(vencimentoFinal),
    prorrogado,
    vencimentoOriginal: prorrogado ? vencimentoOriginal : undefined,
    trilha,
    diasCorridosTotais,
  };
}

/** Formata `AAAA-MM-DD` como `dd/mm/aaaa`, com o dia da semana. */
export function formatarLongo(chave: string): string {
  const data = dataDeChave(chave);
  const semana = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
  return `${String(data.getDate()).padStart(2, "0")}/${String(data.getMonth() + 1).padStart(2, "0")}/${data.getFullYear()} (${semana[data.getDay()]})`;
}
