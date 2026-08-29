/**
 * Feriados que interrompem a contagem de prazo processual.
 *
 * O que está aqui é só o que dá para afirmar de fonte nacional: os feriados
 * civis fixos, os móveis calculados a partir da Páscoa e os feriados forenses
 * de alcance nacional. **Feriado estadual, municipal e suspensão de expediente
 * por portaria de tribunal não estão** — variam por comarca, mudam todo ano e
 * embutir uma tabela que envelhece sozinha seria pior do que não ter: quem usa
 * confiaria num número errado. Esses entram como datas personalizadas.
 *
 * Todas as datas circulam como texto `AAAA-MM-DD`. É de propósito: `Date` em
 * JavaScript carrega fuso horário, e comparar dois `Date` de dias diferentes
 * escorrega uma casa conforme o horário de verão e o fuso da máquina — que é o
 * erro clássico de calculadora de prazo.
 */

/** Chave `AAAA-MM-DD` a partir dos componentes locais de uma data. */
export const chaveData = (data: Date): string =>
  `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}-${String(data.getDate()).padStart(2, "0")}`;

/** Constrói uma data local à meia-noite, sem passar por fuso. */
export const dataDeChave = (chave: string): Date => {
  const [ano, mes, dia] = chave.split("-").map(Number);
  return new Date(ano, mes - 1, dia);
};

export const somarDias = (data: Date, dias: number): Date => {
  const saida = new Date(data.getFullYear(), data.getMonth(), data.getDate());
  saida.setDate(saida.getDate() + dias);
  return saida;
};

export const ehFimDeSemana = (data: Date): boolean => {
  const dia = data.getDay();
  return dia === 0 || dia === 6;
};

/**
 * Domingo de Páscoa, pelo algoritmo de Meeus/Jones/Butcher (calendário
 * gregoriano). Dele saem o Carnaval, a Sexta-feira Santa e o Corpus Christi.
 */
export function domingoDePascoa(ano: number): Date {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(ano, mes - 1, dia);
}

export interface Feriado {
  data: string;
  nome: string;
  tipo: "nacional" | "forense" | "movel" | "personalizado";
}

/** Ano em que o Dia da Consciência Negra virou feriado nacional (Lei 14.759). */
const ANO_CONSCIENCIA_NEGRA = 2024;

/** Feriados civis de alcance nacional, fixos e móveis. */
export function feriadosNacionais(ano: number): Feriado[] {
  const fixos: [string, string][] = [
    [`${ano}-01-01`, "Confraternização Universal"],
    [`${ano}-04-21`, "Tiradentes"],
    [`${ano}-05-01`, "Dia do Trabalho"],
    [`${ano}-09-07`, "Independência"],
    [`${ano}-10-12`, "Nossa Senhora Aparecida"],
    [`${ano}-11-02`, "Finados"],
    [`${ano}-11-15`, "Proclamação da República"],
    [`${ano}-12-25`, "Natal"],
  ];

  if (ano >= ANO_CONSCIENCIA_NEGRA) {
    fixos.push([`${ano}-11-20`, "Dia Nacional de Zumbi e da Consciência Negra"]);
  }

  const pascoa = domingoDePascoa(ano);
  const moveis: Feriado[] = [
    { data: chaveData(somarDias(pascoa, -2)), nome: "Sexta-feira Santa", tipo: "nacional" },
  ];

  return [
    ...fixos.map(([data, nome]): Feriado => ({ data, nome, tipo: "nacional" })),
    ...moveis,
  ].sort((a, b) => a.data.localeCompare(b.data));
}

/**
 * Dias sem expediente forense por costume consolidado, ligados à Páscoa.
 *
 * Carnaval e Corpus Christi não são feriados civis por lei federal — são ponto
 * facultativo. Mas os tribunais não funcionam, e para efeito de prazo é o
 * expediente que importa, não a etiqueta do dia. Ficam num grupo próprio para
 * quem preferir não considerá-los poder desligar.
 */
export function diasSemExpedienteMoveis(ano: number): Feriado[] {
  const pascoa = domingoDePascoa(ano);
  return [
    { data: chaveData(somarDias(pascoa, -48)), nome: "Carnaval (segunda)", tipo: "movel" },
    { data: chaveData(somarDias(pascoa, -47)), nome: "Carnaval (terça)", tipo: "movel" },
    { data: chaveData(somarDias(pascoa, 60)), nome: "Corpus Christi", tipo: "movel" },
  ];
}

/**
 * Feriados forenses de alcance nacional (Lei 5.010/1966, art. 62, e praxe
 * seguida pelos tribunais).
 */
export function feriadosForenses(ano: number): Feriado[] {
  return [
    { data: `${ano}-08-11`, nome: "Dia do Advogado / criação dos cursos jurídicos", tipo: "forense" },
    { data: `${ano}-11-01`, nome: "Dia de Todos os Santos", tipo: "forense" },
    { data: `${ano}-12-08`, nome: "Dia da Justiça", tipo: "forense" },
  ];
}

export interface OpcoesFeriados {
  incluirForenses: boolean;
  incluirCarnavalCorpusChristi: boolean;
  /** Datas `AAAA-MM-DD` acrescentadas por quem usa. */
  personalizados: { data: string; nome: string }[];
}

/** Reúne todos os feriados aplicáveis a um intervalo de anos. */
export function montarCalendario(
  anoInicial: number,
  anoFinal: number,
  opcoes: OpcoesFeriados,
): Map<string, Feriado> {
  const mapa = new Map<string, Feriado>();
  const registrar = (f: Feriado) => {
    if (!mapa.has(f.data)) mapa.set(f.data, f);
  };

  for (let ano = anoInicial; ano <= anoFinal; ano++) {
    feriadosNacionais(ano).forEach(registrar);
    if (opcoes.incluirCarnavalCorpusChristi) diasSemExpedienteMoveis(ano).forEach(registrar);
    if (opcoes.incluirForenses) feriadosForenses(ano).forEach(registrar);
  }

  // Os personalizados entram por último mas têm precedência: se quem usa
  // cadastrou um nome para uma data que já existia, o dele é que aparece.
  for (const p of opcoes.personalizados) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(p.data)) {
      mapa.set(p.data, { data: p.data, nome: p.nome || "Feriado local", tipo: "personalizado" });
    }
  }

  return mapa;
}

/**
 * A data cai no recesso forense de 20 de dezembro a 20 de janeiro?
 *
 * O recesso suspende o curso dos prazos processuais no cível (CPC, art. 220) e
 * no trabalhista (CLT, art. 775-A). Não se aplica ao processo penal.
 */
export function noRecesso(data: Date): boolean {
  const mes = data.getMonth() + 1;
  const dia = data.getDate();
  return (mes === 12 && dia >= 20) || (mes === 1 && dia <= 20);
}
