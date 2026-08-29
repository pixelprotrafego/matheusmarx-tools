/**
 * Numeração única de processos judiciais (Resolução CNJ 65/2008).
 *
 * O formato é `NNNNNNN-DD.AAAA.J.TR.OOOO`:
 *
 * - `NNNNNNN` número sequencial por unidade de origem, reiniciado a cada ano;
 * - `DD` dígito verificador;
 * - `AAAA` ano do ajuizamento;
 * - `J` segmento do Poder Judiciário;
 * - `TR` tribunal ou região;
 * - `OOOO` unidade de origem (vara, foro, juizado).
 *
 * O dígito verificador segue o ISO 7064 MOD 97-10, o mesmo do IBAN bancário.
 * Isso dá uma propriedade útil: no número completo e correto, os 20 dígitos na
 * ordem `NNNNNNN AAAA J TR OOOO DD` deixam resto 1 na divisão por 97. É assim
 * que a validação é feita aqui — sem recalcular o dígito e comparar, o que daria
 * o mesmo resultado por um caminho mais longo.
 *
 * Os números são maiores que `Number.MAX_SAFE_INTEGER`, então a divisão é feita
 * dígito a dígito, como se faz na conta armada. Usar `Number` perderia precisão
 * silenciosamente e o validador passaria a aceitar números inválidos.
 */

/** Segmentos do Poder Judiciário, o dígito `J` da numeração. */
export const SEGMENTOS: Record<string, string> = {
  "1": "Supremo Tribunal Federal",
  "2": "Conselho Nacional de Justiça",
  "3": "Superior Tribunal de Justiça",
  "4": "Justiça Federal",
  "5": "Justiça do Trabalho",
  "6": "Justiça Eleitoral",
  "7": "Justiça Militar da União",
  "8": "Justiça Estadual",
  "9": "Justiça Militar Estadual",
};

/**
 * Códigos de unidade federativa usados pelos segmentos 6, 8 e 9.
 *
 * A ordem é a alfabética do nome do estado, e não a da sigla — por isso Sergipe
 * (25) vem antes de São Paulo (26).
 */
export const UF_POR_CODIGO: Record<string, { uf: string; nome: string }> = {
  "01": { uf: "AC", nome: "Acre" },
  "02": { uf: "AL", nome: "Alagoas" },
  "03": { uf: "AP", nome: "Amapá" },
  "04": { uf: "AM", nome: "Amazonas" },
  "05": { uf: "BA", nome: "Bahia" },
  "06": { uf: "CE", nome: "Ceará" },
  "07": { uf: "DF", nome: "Distrito Federal" },
  "08": { uf: "ES", nome: "Espírito Santo" },
  "09": { uf: "GO", nome: "Goiás" },
  "10": { uf: "MA", nome: "Maranhão" },
  "11": { uf: "MT", nome: "Mato Grosso" },
  "12": { uf: "MS", nome: "Mato Grosso do Sul" },
  "13": { uf: "MG", nome: "Minas Gerais" },
  "14": { uf: "PA", nome: "Pará" },
  "15": { uf: "PB", nome: "Paraíba" },
  "16": { uf: "PR", nome: "Paraná" },
  "17": { uf: "PE", nome: "Pernambuco" },
  "18": { uf: "PI", nome: "Piauí" },
  "19": { uf: "RJ", nome: "Rio de Janeiro" },
  "20": { uf: "RN", nome: "Rio Grande do Norte" },
  "21": { uf: "RS", nome: "Rio Grande do Sul" },
  "22": { uf: "RO", nome: "Rondônia" },
  "23": { uf: "RR", nome: "Roraima" },
  "24": { uf: "SC", nome: "Santa Catarina" },
  "25": { uf: "SE", nome: "Sergipe" },
  "26": { uf: "SP", nome: "São Paulo" },
  "27": { uf: "TO", nome: "Tocantins" },
};

/** Tribunais Regionais Federais e os estados de cada um. */
const TRF: Record<string, { nome: string; ufs: string[] }> = {
  "01": { nome: "TRF da 1ª Região", ufs: ["AC", "AM", "AP", "BA", "DF", "GO", "MA", "MT", "PA", "PI", "RO", "RR", "TO"] },
  "02": { nome: "TRF da 2ª Região", ufs: ["ES", "RJ"] },
  "03": { nome: "TRF da 3ª Região", ufs: ["MS", "SP"] },
  "04": { nome: "TRF da 4ª Região", ufs: ["PR", "RS", "SC"] },
  "05": { nome: "TRF da 5ª Região", ufs: ["AL", "CE", "PB", "PE", "RN", "SE"] },
  // Instalado em 2022, com a competência sobre Minas Gerais que era da 1ª Região.
  "06": { nome: "TRF da 6ª Região", ufs: ["MG"] },
};

/** Tribunais Regionais do Trabalho e os estados de cada região. */
const TRT: Record<string, { nome: string; ufs: string[] }> = {
  "01": { nome: "TRT da 1ª Região", ufs: ["RJ"] },
  "02": { nome: "TRT da 2ª Região", ufs: ["SP"] },
  "03": { nome: "TRT da 3ª Região", ufs: ["MG"] },
  "04": { nome: "TRT da 4ª Região", ufs: ["RS"] },
  "05": { nome: "TRT da 5ª Região", ufs: ["BA"] },
  "06": { nome: "TRT da 6ª Região", ufs: ["PE"] },
  "07": { nome: "TRT da 7ª Região", ufs: ["CE"] },
  "08": { nome: "TRT da 8ª Região", ufs: ["AP", "PA"] },
  "09": { nome: "TRT da 9ª Região", ufs: ["PR"] },
  "10": { nome: "TRT da 10ª Região", ufs: ["DF", "TO"] },
  "11": { nome: "TRT da 11ª Região", ufs: ["AM", "RR"] },
  "12": { nome: "TRT da 12ª Região", ufs: ["SC"] },
  "13": { nome: "TRT da 13ª Região", ufs: ["PB"] },
  "14": { nome: "TRT da 14ª Região", ufs: ["AC", "RO"] },
  "15": { nome: "TRT da 15ª Região", ufs: ["SP"] },
  "16": { nome: "TRT da 16ª Região", ufs: ["MA"] },
  "17": { nome: "TRT da 17ª Região", ufs: ["ES"] },
  "18": { nome: "TRT da 18ª Região", ufs: ["GO"] },
  "19": { nome: "TRT da 19ª Região", ufs: ["AL"] },
  "20": { nome: "TRT da 20ª Região", ufs: ["SE"] },
  "21": { nome: "TRT da 21ª Região", ufs: ["RN"] },
  "22": { nome: "TRT da 22ª Região", ufs: ["PI"] },
  "23": { nome: "TRT da 23ª Região", ufs: ["MT"] },
  "24": { nome: "TRT da 24ª Região", ufs: ["MS"] },
};

/** Os três estados que mantêm Tribunal de Justiça Militar próprio. */
const JUSTICA_MILITAR_ESTADUAL = new Set(["13", "21", "26"]);

export interface ProcessoCnj {
  sequencial: string;
  digito: string;
  ano: string;
  segmento: string;
  tribunal: string;
  origem: string;
}

export interface DescricaoTribunal {
  /** Nome do órgão, quando identificável. */
  nome: string;
  /** Sigla da UF, quando o segmento e o código permitem determinar uma só. */
  uf: string | null;
  /** Estados abrangidos, para tribunais com mais de um. */
  ufs: string[];
}

const somenteDigitos = (valor: string) => valor.replace(/\D/g, "");

/** Formata 20 dígitos crus no padrão com pontos e hífen. */
export function formatarCnj(digitos: string): string {
  const d = somenteDigitos(digitos).padStart(20, "0").slice(0, 20);
  return `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}.${d.slice(13, 14)}.${d.slice(14, 16)}.${d.slice(16, 20)}`;
}

/** Separa os campos de um número já com 20 dígitos. */
export function separarCampos(digitos: string): ProcessoCnj | null {
  const d = somenteDigitos(digitos);
  if (d.length !== 20) return null;
  return {
    sequencial: d.slice(0, 7),
    digito: d.slice(7, 9),
    ano: d.slice(9, 13),
    segmento: d.slice(13, 14),
    tribunal: d.slice(14, 16),
    origem: d.slice(16, 20),
  };
}

/**
 * Resto da divisão de um número inteiro decimal grande por 97.
 *
 * Feito dígito a dígito porque o número tem 20 algarismos e não cabe num
 * `Number` sem perda: a partir de 2^53 as contas passam a arredondar, e o
 * validador começaria a aprovar número errado sem dar nenhum sinal.
 */
function restoMod97(digitos: string): number {
  let resto = 0;
  for (const caractere of digitos) {
    resto = (resto * 10 + Number(caractere)) % 97;
  }
  return resto;
}

/** Calcula o dígito verificador dos 18 dígitos restantes, já na ordem correta. */
export function calcularDigito(sem: {
  sequencial: string;
  ano: string;
  segmento: string;
  tribunal: string;
  origem: string;
}): string {
  const base = `${sem.sequencial}${sem.ano}${sem.segmento}${sem.tribunal}${sem.origem}`;
  // O "00" no fim reserva as duas casas do dígito, exatamente como manda a
  // Resolução: calcula-se sobre o número com o dígito zerado.
  const digito = 98 - restoMod97(`${base}00`);
  return String(digito).padStart(2, "0");
}

export interface ResultadoValidacao {
  valido: boolean;
  /** Motivo da recusa, pronto para exibir. */
  erro?: string;
  campos?: ProcessoCnj;
  formatado?: string;
  /** Dígito que o número deveria ter, quando o informado está errado. */
  digitoEsperado?: string;
  tribunal?: DescricaoTribunal;
  segmentoNome?: string;
}

/** Descreve o órgão a partir do segmento e do código de tribunal. */
export function descreverTribunal(segmento: string, tribunal: string): DescricaoTribunal {
  switch (segmento) {
    case "1":
      return { nome: "Supremo Tribunal Federal", uf: null, ufs: [] };
    case "2":
      return { nome: "Conselho Nacional de Justiça", uf: null, ufs: [] };
    case "3":
      return { nome: "Superior Tribunal de Justiça", uf: null, ufs: [] };
    case "7":
      return { nome: "Justiça Militar da União", uf: null, ufs: [] };
    case "4": {
      const t = TRF[tribunal];
      return t
        ? { nome: t.nome, uf: t.ufs.length === 1 ? t.ufs[0] : null, ufs: t.ufs }
        : { nome: `Região federal desconhecida (${tribunal})`, uf: null, ufs: [] };
    }
    case "5": {
      const t = TRT[tribunal];
      return t
        ? { nome: t.nome, uf: t.ufs.length === 1 ? t.ufs[0] : null, ufs: t.ufs }
        : { nome: `Região trabalhista desconhecida (${tribunal})`, uf: null, ufs: [] };
    }
    case "6": {
      const u = UF_POR_CODIGO[tribunal];
      return u
        ? { nome: `Tribunal Regional Eleitoral de ${u.nome}`, uf: u.uf, ufs: [u.uf] }
        : { nome: `Tribunal eleitoral desconhecido (${tribunal})`, uf: null, ufs: [] };
    }
    case "8": {
      const u = UF_POR_CODIGO[tribunal];
      return u
        ? { nome: `Tribunal de Justiça de ${u.nome}`, uf: u.uf, ufs: [u.uf] }
        : { nome: `Tribunal estadual desconhecido (${tribunal})`, uf: null, ufs: [] };
    }
    case "9": {
      const u = UF_POR_CODIGO[tribunal];
      if (u && JUSTICA_MILITAR_ESTADUAL.has(tribunal)) {
        return { nome: `Tribunal de Justiça Militar de ${u.nome}`, uf: u.uf, ufs: [u.uf] };
      }
      return {
        nome: u
          ? `${u.nome} não mantém Tribunal de Justiça Militar próprio`
          : `Tribunal militar estadual desconhecido (${tribunal})`,
        uf: u?.uf ?? null,
        ufs: u ? [u.uf] : [],
      };
    }
    default:
      return { nome: `Segmento desconhecido (${segmento})`, uf: null, ufs: [] };
  }
}

/** Valida um número de processo digitado com ou sem máscara. */
export function validarCnj(entrada: string): ResultadoValidacao {
  const d = somenteDigitos(entrada);

  if (!d) return { valido: false, erro: "Digite um número de processo." };
  if (d.length !== 20) {
    return {
      valido: false,
      erro: `O número deve ter 20 dígitos; este tem ${d.length}.`,
    };
  }

  const campos = separarCampos(d)!;
  const formatado = formatarCnj(d);

  if (!SEGMENTOS[campos.segmento]) {
    return {
      valido: false,
      erro: `Segmento "${campos.segmento}" não existe. O dígito do segmento vai de 1 a 9.`,
      campos,
      formatado,
    };
  }

  // A verificação e o cálculo do dígito são o mesmo teste por caminhos
  // diferentes; o resto 1 confirma, e o dígito esperado serve para mostrar
  // onde está o erro de digitação.
  const confere = restoMod97(`${campos.sequencial}${campos.ano}${campos.segmento}${campos.tribunal}${campos.origem}${campos.digito}`) === 1;

  if (!confere) {
    return {
      valido: false,
      erro: "Dígito verificador não confere. Provavelmente há um erro de digitação.",
      campos,
      formatado,
      digitoEsperado: calcularDigito(campos),
    };
  }

  return {
    valido: true,
    campos,
    formatado,
    tribunal: descreverTribunal(campos.segmento, campos.tribunal),
    segmentoNome: SEGMENTOS[campos.segmento],
  };
}

export interface OpcoesGeracao {
  ano: number;
  segmento: string;
  tribunal: string;
  origem: string;
  /** Sequencial fixo; sorteado quando ausente. */
  sequencial?: string;
}

/**
 * Monta um número de processo válido a partir dos campos escolhidos.
 *
 * O resultado é sintaticamente correto e passa em qualquer validador, mas
 * **não corresponde a processo nenhum**: serve para preencher modelo de
 * petição, testar sistema e dar exemplo em aula.
 */
export function gerarCnj(opcoes: OpcoesGeracao): string {
  const sequencial = (opcoes.sequencial ?? String(Math.floor(Math.random() * 10_000_000)))
    .replace(/\D/g, "")
    .padStart(7, "0")
    .slice(0, 7);
  const ano = String(opcoes.ano).padStart(4, "0").slice(0, 4);
  const segmento = opcoes.segmento.replace(/\D/g, "").slice(0, 1) || "8";
  const tribunal = opcoes.tribunal.replace(/\D/g, "").padStart(2, "0").slice(0, 2);
  const origem = opcoes.origem.replace(/\D/g, "").padStart(4, "0").slice(0, 4);

  const digito = calcularDigito({ sequencial, ano, segmento, tribunal, origem });
  return formatarCnj(`${sequencial}${digito}${ano}${segmento}${tribunal}${origem}`);
}

/** Códigos de tribunal aceitáveis para um segmento, para montar o formulário. */
export function tribunaisDoSegmento(segmento: string): { codigo: string; nome: string }[] {
  switch (segmento) {
    case "4":
      return Object.entries(TRF).map(([codigo, t]) => ({ codigo, nome: t.nome }));
    case "5":
      return Object.entries(TRT).map(([codigo, t]) => ({ codigo, nome: t.nome }));
    case "6":
      return Object.entries(UF_POR_CODIGO).map(([codigo, u]) => ({ codigo, nome: `TRE-${u.uf} — ${u.nome}` }));
    case "8":
      return Object.entries(UF_POR_CODIGO).map(([codigo, u]) => ({ codigo, nome: `TJ${u.uf} — ${u.nome}` }));
    case "9":
      return [...JUSTICA_MILITAR_ESTADUAL].map((codigo) => ({
        codigo,
        nome: `TJM-${UF_POR_CODIGO[codigo].uf} — ${UF_POR_CODIGO[codigo].nome}`,
      }));
    default:
      // STF, CNJ, STJ e Justiça Militar da União não têm subdivisão.
      return [{ codigo: "00", nome: "Tribunal único" }];
  }
}
