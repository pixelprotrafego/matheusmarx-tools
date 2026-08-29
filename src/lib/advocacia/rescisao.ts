/**
 * Verbas rescisórias do contrato de trabalho (CLT).
 *
 * O cálculo segue a estrutura do TRCT: apura as verbas, separa o que é FGTS
 * (que vai para a conta vinculada e não entra no líquido do acerto) e só então
 * desconta INSS e IRRF sobre as parcelas em que eles de fato incidem.
 *
 * Duas decisões estruturais valem registro:
 *
 * 1. **As tabelas de INSS e IRRF são dados de entrada, não constantes.** Elas
 *    mudam por ato do governo, e uma ferramenta que roda offline não tem como
 *    saber que envelheceu. Ficam com a vigência declarada e editáveis na tela,
 *    para quem usa conferir contra a fonte oficial antes de assinar embaixo.
 * 2. **Nem toda verba é base de imposto.** Aviso prévio indenizado e férias
 *    indenizadas com o terço não sofrem INSS nem IRRF — o primeiro por não ter
 *    natureza salarial, as segundas por serem indenizatórias (Súmula 386 do
 *    STJ). Tratar tudo como salário infla o desconto e é o erro mais comum
 *    numa planilha feita às pressas.
 */

import { chaveData, dataDeChave, somarDias } from "./feriados";

export type TipoRescisao =
  | "sem-justa-causa"
  | "pedido-demissao"
  | "justa-causa"
  | "acordo"
  | "termino-contrato";

export const TIPOS_RESCISAO: { valor: TipoRescisao; nome: string; base: string }[] = [
  { valor: "sem-justa-causa", nome: "Dispensa sem justa causa", base: "CLT, art. 477 e 487" },
  { valor: "pedido-demissao", nome: "Pedido de demissão", base: "CLT, art. 487, §2º" },
  { valor: "justa-causa", nome: "Dispensa por justa causa", base: "CLT, art. 482" },
  { valor: "acordo", nome: "Acordo entre as partes", base: "CLT, art. 484-A" },
  { valor: "termino-contrato", nome: "Término de contrato por prazo determinado", base: "CLT, art. 443" },
];

export interface FaixaInss {
  ate: number;
  aliquota: number;
}

export interface FaixaIrrf {
  ate: number;
  aliquota: number;
  deduzir: number;
}

export interface TabelaInss {
  vigencia: string;
  faixas: FaixaInss[];
}

export interface TabelaIrrf {
  vigencia: string;
  faixas: FaixaIrrf[];
  porDependente: number;
}

/**
 * Valores de referência. **Confira antes de usar**: são a última tabela que
 * pôde ser embutida com segurança, não necessariamente a vigente hoje. A tela
 * mostra a vigência em destaque e deixa editar cada faixa.
 */
export const TABELA_INSS_PADRAO: TabelaInss = {
  vigencia: "janeiro/2025",
  faixas: [
    { ate: 1518.0, aliquota: 0.075 },
    { ate: 2793.88, aliquota: 0.09 },
    { ate: 4190.83, aliquota: 0.12 },
    { ate: 8157.41, aliquota: 0.14 },
  ],
};

export const TABELA_IRRF_PADRAO: TabelaIrrf = {
  vigencia: "maio/2025",
  faixas: [
    { ate: 2428.8, aliquota: 0, deduzir: 0 },
    { ate: 2826.65, aliquota: 0.075, deduzir: 182.16 },
    { ate: 3751.05, aliquota: 0.15, deduzir: 394.16 },
    { ate: 4664.68, aliquota: 0.225, deduzir: 675.49 },
    { ate: Infinity, aliquota: 0.275, deduzir: 908.73 },
  ],
  porDependente: 189.59,
};

const arredondar = (valor: number) => Math.round((valor + Number.EPSILON) * 100) / 100;

/**
 * INSS progressivo: cada faixa incide apenas sobre a parte do salário que cai
 * dentro dela, e não a alíquota da faixa final sobre tudo.
 */
export function calcularInss(base: number, tabela: TabelaInss = TABELA_INSS_PADRAO): number {
  if (base <= 0) return 0;
  let anterior = 0;
  let total = 0;
  for (const faixa of tabela.faixas) {
    if (base > anterior) {
      const parcela = Math.min(base, faixa.ate) - anterior;
      total += parcela * faixa.aliquota;
    }
    anterior = faixa.ate;
  }
  // Acima do teto, a contribuição trava no valor da última faixa.
  return arredondar(total);
}

export function calcularIrrf(
  base: number,
  dependentes: number,
  inssDescontado: number,
  tabela: TabelaIrrf = TABELA_IRRF_PADRAO,
): number {
  const baseLiquida = base - inssDescontado - dependentes * tabela.porDependente;
  if (baseLiquida <= 0) return 0;
  const faixa = tabela.faixas.find((f) => baseLiquida <= f.ate) ?? tabela.faixas[tabela.faixas.length - 1];
  return arredondar(Math.max(0, baseLiquida * faixa.aliquota - faixa.deduzir));
}

export interface EntradaRescisao {
  salarioMensal: number;
  /** Média de horas extras, comissões e adicionais habituais. */
  mediaVariaveis: number;
  admissao: string;
  /** Último dia do contrato, antes da projeção do aviso indenizado. */
  demissao: string;
  tipo: TipoRescisao;
  avisoPrevio: "indenizado" | "trabalhado" | "dispensado";
  /** Períodos aquisitivos completos ainda não gozados. */
  feriasVencidas: number;
  /** Saldo já depositado na conta vinculada, base da multa. */
  saldoFgts: number;
  dependentes: number;
}

export interface Verba {
  chave: string;
  descricao: string;
  detalhe?: string;
  valor: number;
  grupo: "provento" | "desconto" | "fgts";
}

export interface ResultadoRescisao {
  ok: boolean;
  erro?: string;
  verbas?: Verba[];
  totalProventos?: number;
  totalDescontos?: number;
  liquido?: number;
  totalFgts?: number;
  /** Data até onde o contrato se projeta, contando o aviso indenizado. */
  dataProjetada?: string;
  diasAviso?: number;
  anosCompletos?: number;
  avisos?: string[];
}

/**
 * Conta os meses de um intervalo em que se trabalhou 15 dias ou mais.
 *
 * É a regra dos avos: "a fração igual ou superior a 15 dias de trabalho será
 * havida como mês integral" (Lei 4.090/1962, art. 1º, §1º, para o 13º; mesma
 * lógica no art. 146 da CLT para as férias proporcionais).
 */
export function contarAvos(inicio: Date, fim: Date): number {
  if (fim < inicio) return 0;
  let avos = 0;
  let ano = inicio.getFullYear();
  let mes = inicio.getMonth();

  while (ano < fim.getFullYear() || (ano === fim.getFullYear() && mes <= fim.getMonth())) {
    const primeiroDoMes = new Date(ano, mes, 1);
    const ultimoDoMes = new Date(ano, mes + 1, 0);
    const de = inicio > primeiroDoMes ? inicio : primeiroDoMes;
    const ate = fim < ultimoDoMes ? fim : ultimoDoMes;
    const dias = Math.floor((ate.getTime() - de.getTime()) / 86400000) + 1;
    if (dias >= 15) avos++;

    mes++;
    if (mes > 11) {
      mes = 0;
      ano++;
    }
  }

  return avos;
}

/** Aniversários completos do contrato entre duas datas. */
function anosCompletos(admissao: Date, ate: Date): number {
  let anos = ate.getFullYear() - admissao.getFullYear();
  const aniversario = new Date(ate.getFullYear(), admissao.getMonth(), admissao.getDate());
  if (ate < aniversario) anos--;
  return Math.max(0, anos);
}

/** Início do período aquisitivo de férias em curso. */
function inicioPeriodoAquisitivo(admissao: Date, ate: Date): Date {
  const anos = anosCompletos(admissao, ate);
  return new Date(admissao.getFullYear() + anos, admissao.getMonth(), admissao.getDate());
}

export function calcularRescisao(
  entrada: EntradaRescisao,
  tabelaInss: TabelaInss = TABELA_INSS_PADRAO,
  tabelaIrrf: TabelaIrrf = TABELA_IRRF_PADRAO,
): ResultadoRescisao {
  const { salarioMensal, mediaVariaveis, tipo } = entrada;

  if (!(salarioMensal > 0)) return { ok: false, erro: "Informe o salário mensal." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entrada.admissao)) return { ok: false, erro: "Informe a data de admissão." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entrada.demissao)) return { ok: false, erro: "Informe a data da rescisão." };

  const admissao = dataDeChave(entrada.admissao);
  const demissao = dataDeChave(entrada.demissao);
  if (demissao < admissao) return { ok: false, erro: "A rescisão não pode ser anterior à admissão." };

  const remuneracao = salarioMensal + Math.max(0, mediaVariaveis);
  const diaria = remuneracao / 30;
  const avisos: string[] = [];
  const verbas: Verba[] = [];

  // ---------------------------------------------------------------- aviso
  const anos = anosCompletos(admissao, demissao);
  const temDireitoAviso = tipo === "sem-justa-causa" || tipo === "acordo";
  // Lei 12.506/2011: 30 dias, mais 3 por ano completo, limitado a 90.
  const diasAvisoCheio = temDireitoAviso ? Math.min(90, 30 + 3 * anos) : 0;
  // No acordo do art. 484-A, o aviso indenizado é devido pela metade.
  const diasAviso = tipo === "acordo" ? Math.floor(diasAvisoCheio / 2) : diasAvisoCheio;

  const indenizado = entrada.avisoPrevio === "indenizado" && diasAviso > 0;
  // O aviso indenizado projeta o contrato para todos os efeitos legais
  // (CLT, art. 487, §1º): conta como tempo de serviço para 13º e férias.
  const dataProjetada = indenizado ? somarDias(demissao, diasAviso) : demissao;

  // -------------------------------------------------------- saldo de salário
  const diasNoMes = demissao.getDate();
  const diasTrabalhadosNoMes =
    admissao.getFullYear() === demissao.getFullYear() && admissao.getMonth() === demissao.getMonth()
      ? demissao.getDate() - admissao.getDate() + 1
      : diasNoMes;
  const saldoSalario = arredondar(diaria * diasTrabalhadosNoMes);
  verbas.push({
    chave: "saldo",
    descricao: "Saldo de salário",
    detalhe: `${diasTrabalhadosNoMes} dia(s) × ${moeda(diaria)}`,
    valor: saldoSalario,
    grupo: "provento",
  });

  // ------------------------------------------------------------ aviso prévio
  let avisoIndenizado = 0;
  if (indenizado) {
    avisoIndenizado = arredondar(diaria * diasAviso);
    verbas.push({
      chave: "aviso",
      descricao: "Aviso prévio indenizado",
      detalhe: `${diasAviso} dia(s) × ${moeda(diaria)}${tipo === "acordo" ? " (metade, art. 484-A)" : ""}`,
      valor: avisoIndenizado,
      grupo: "provento",
    });
  }

  // No pedido de demissão sem cumprimento, o empregador pode descontar o aviso
  // que deixou de ser prestado (CLT, art. 487, §2º).
  if (tipo === "pedido-demissao" && entrada.avisoPrevio === "indenizado") {
    const desconto = arredondar(diaria * 30);
    verbas.push({
      chave: "aviso-desconto",
      descricao: "Aviso prévio não cumprido",
      detalhe: "30 dias, art. 487, §2º",
      valor: -desconto,
      grupo: "desconto",
    });
  }

  // ------------------------------------------------------------- 13º salário
  const temDireito13 = tipo !== "justa-causa";
  let decimo = 0;
  if (temDireito13) {
    const inicioAno = new Date(dataProjetada.getFullYear(), 0, 1);
    const de = admissao > inicioAno ? admissao : inicioAno;
    const avos13 = Math.min(12, contarAvos(de, dataProjetada));
    decimo = arredondar((remuneracao / 12) * avos13);
    verbas.push({
      chave: "decimo",
      descricao: "13º salário proporcional",
      detalhe: `${avos13}/12 avos`,
      valor: decimo,
      grupo: "provento",
    });
  } else {
    avisos.push("Na justa causa não há 13º proporcional nem férias proporcionais (Súmula 171 do TST).");
  }

  // ------------------------------------------------------------------ férias
  if (entrada.feriasVencidas > 0) {
    const valor = arredondar(remuneracao * entrada.feriasVencidas);
    const terco = arredondar(valor / 3);
    verbas.push({
      chave: "ferias-vencidas",
      descricao: "Férias vencidas",
      detalhe: `${entrada.feriasVencidas} período(s)`,
      valor,
      grupo: "provento",
    });
    verbas.push({
      chave: "ferias-vencidas-terco",
      descricao: "1/3 sobre férias vencidas",
      valor: terco,
      grupo: "provento",
    });
  }

  if (tipo !== "justa-causa") {
    const inicioPeriodo = inicioPeriodoAquisitivo(admissao, dataProjetada);
    const avosFerias = Math.min(12, contarAvos(inicioPeriodo, dataProjetada));
    if (avosFerias > 0) {
      const valor = arredondar((remuneracao / 12) * avosFerias);
      const terco = arredondar(valor / 3);
      verbas.push({
        chave: "ferias-prop",
        descricao: "Férias proporcionais",
        detalhe: `${avosFerias}/12 avos`,
        valor,
        grupo: "provento",
      });
      verbas.push({
        chave: "ferias-prop-terco",
        descricao: "1/3 sobre férias proporcionais",
        valor: terco,
        grupo: "provento",
      });
    }
  }

  // -------------------------------------------------------------------- FGTS
  // 8% sobre as parcelas de natureza salarial da rescisão.
  const baseFgts = saldoSalario + avisoIndenizado + decimo;
  const fgtsRescisao = arredondar(baseFgts * 0.08);
  verbas.push({
    chave: "fgts-mes",
    descricao: "FGTS sobre as verbas rescisórias",
    detalhe: `8% sobre ${moeda(baseFgts)}`,
    valor: fgtsRescisao,
    grupo: "fgts",
  });

  const saldoTotalFgts = Math.max(0, entrada.saldoFgts) + fgtsRescisao;
  const percentualMulta = tipo === "sem-justa-causa" ? 0.4 : tipo === "acordo" ? 0.2 : 0;
  if (percentualMulta > 0) {
    verbas.push({
      chave: "fgts-multa",
      descricao: `Multa de ${percentualMulta * 100}% do FGTS`,
      detalhe: `sobre ${moeda(saldoTotalFgts)}`,
      valor: arredondar(saldoTotalFgts * percentualMulta),
      grupo: "fgts",
    });
  }

  if (tipo === "acordo") {
    avisos.push("No acordo do art. 484-A a movimentação da conta do FGTS é limitada a 80% do saldo.");
  }
  if (tipo === "pedido-demissao" || tipo === "justa-causa") {
    avisos.push("Não há multa do FGTS nem direito ao saque nesta modalidade.");
  }

  // ---------------------------------------------------------------- impostos
  // Base do INSS: saldo de salário. O 13º tem cálculo próprio e separado.
  // Ficam de fora o aviso indenizado e as férias indenizadas com o terço.
  const inssSalario = calcularInss(saldoSalario, tabelaInss);
  if (inssSalario > 0) {
    verbas.push({
      chave: "inss",
      descricao: "INSS sobre o saldo de salário",
      detalhe: `tabela de ${tabelaInss.vigencia}`,
      valor: -inssSalario,
      grupo: "desconto",
    });
  }

  const inss13 = decimo > 0 ? calcularInss(decimo, tabelaInss) : 0;
  if (inss13 > 0) {
    verbas.push({
      chave: "inss-13",
      descricao: "INSS sobre o 13º salário",
      detalhe: "cálculo separado, tributação exclusiva",
      valor: -inss13,
      grupo: "desconto",
    });
  }

  const irrfSalario = calcularIrrf(saldoSalario, entrada.dependentes, inssSalario, tabelaIrrf);
  if (irrfSalario > 0) {
    verbas.push({
      chave: "irrf",
      descricao: "IRRF sobre o saldo de salário",
      detalhe: `tabela de ${tabelaIrrf.vigencia}`,
      valor: -irrfSalario,
      grupo: "desconto",
    });
  }

  const irrf13 = decimo > 0 ? calcularIrrf(decimo, entrada.dependentes, inss13, tabelaIrrf) : 0;
  if (irrf13 > 0) {
    verbas.push({
      chave: "irrf-13",
      descricao: "IRRF sobre o 13º salário",
      detalhe: "tributação exclusiva na fonte",
      valor: -irrf13,
      grupo: "desconto",
    });
  }

  avisos.push(
    "Aviso prévio indenizado e férias indenizadas com o terço não sofrem INSS nem IRRF (Súmula 386 do STJ).",
  );

  const totalProventos = arredondar(
    verbas.filter((v) => v.grupo === "provento").reduce((s, v) => s + v.valor, 0),
  );
  const totalDescontos = arredondar(
    verbas.filter((v) => v.grupo === "desconto").reduce((s, v) => s + Math.abs(v.valor), 0),
  );
  const totalFgts = arredondar(verbas.filter((v) => v.grupo === "fgts").reduce((s, v) => s + v.valor, 0));

  return {
    ok: true,
    verbas,
    totalProventos,
    totalDescontos,
    liquido: arredondar(totalProventos - totalDescontos),
    totalFgts,
    dataProjetada: chaveData(dataProjetada),
    diasAviso,
    anosCompletos: anos,
    avisos,
  };
}

export const moeda = (valor: number): string =>
  valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
