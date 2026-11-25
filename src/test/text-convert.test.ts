import { describe, it, expect } from "vitest";
import {
  convertText,
  csvToMarkdownTable,
  csvToRecords,
  detectDelimiter,
  escapeHtml,
  htmlToMarkdown,
  htmlToPlainText,
  mdToHtml,
  mdToPlainText,
  parseCsv,
  recordsToCsv,
  textToHtml,
  textToMarkdown,
} from "@/lib/text-convert";

/** O texto que um HTML mostra, com <br> e parágrafos como quebras de linha. */
function shown(html: string): string {
  // Quebra de linha do código-fonte do HTML é espaço na exibição.
  const doc = new DOMParser().parseFromString(html.replace(/\n/g, " "), "text/html");
  doc.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
  doc.querySelectorAll("p").forEach((p) => p.append("\n\n"));
  return (doc.body.textContent ?? "").replace(/\u00a0/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").replace(/^[ \n]*\n|\n[ \n]*$/g, "").replace(/ +$/, "");
}

describe("textToMarkdown", () => {
  it("o Markdown gerado mostra exatamente o texto original", () => {
    const texts = [
      "# não é título\n* nem lista\n1. nem lista numerada",
      "preço: 2*3 = 6 e nome_do_arquivo.txt e <b>tag</b>",
      "linha um\nlinha dois\n\nnovo parágrafo",
      "    recuo de quatro espaços",
      "[colchetes] e `crase` e barra \\ invertida",
    ];
    for (const t of texts) expect(shown(mdToHtml(textToMarkdown(t)))).toBe(t);
  });
});

describe("parseCsv", () => {
  it("lê uma tabela simples", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("aceita CRLF e a última linha sem quebra", () => {
    expect(parseCsv("a,b\r\n1,2\r\n3,4")).toEqual([["a", "b"], ["1", "2"], ["3", "4"]]);
  });

  it("preserva quebra de linha dentro de campo entre aspas", () => {
    // Era o defeito: o texto era cortado por linha antes de olhar as aspas,
    // então o endereço virava duas linhas e desalinhava a tabela.
    const csv = 'nome,endereco\n"Ana","Rua A, 10\nApto 2"';
    expect(parseCsv(csv)).toEqual([
      ["nome", "endereco"],
      ["Ana", "Rua A, 10\nApto 2"],
    ]);
  });

  it("preserva vírgula dentro de aspas", () => {
    expect(parseCsv('a,b\n"x,y",z')).toEqual([["a", "b"], ["x,y", "z"]]);
  });

  it("entende aspas escapadas", () => {
    expect(parseCsv('a\n"ele disse ""oi"""')).toEqual([["a"], ['ele disse "oi"']]);
  });

  it("descarta o BOM do Excel no primeiro cabeçalho", () => {
    expect(parseCsv("﻿nome,idade\nAna,30")[0]).toEqual(["nome", "idade"]);
  });

  it("ignora linhas totalmente vazias", () => {
    expect(parseCsv("a,b\n\n1,2\n\n")).toEqual([["a", "b"], ["1", "2"]]);
  });
});

describe("CSV <-> registros", () => {
  it("faz a ida e volta sem perder conteúdo com vírgula e quebra de linha", () => {
    const original = [{ nome: "Ana", obs: "linha 1\nlinha 2", cidade: "Rio, RJ" }];
    const csv = recordsToCsv(original);
    expect(csvToRecords(csv)).toEqual(original);
  });

  it("escapa aspas ao gerar CSV", () => {
    expect(recordsToCsv([{ a: 'diz "oi"' }])).toBe('a\n"diz ""oi"""');
  });

  it("usa a união das chaves quando os objetos diferem", () => {
    expect(recordsToCsv([{ a: 1 }, { b: 2 }])).toBe("a,b\n1,\n,2");
  });
});

describe("csvToMarkdownTable", () => {
  it("monta a tabela com cabeçalho e separador", () => {
    expect(csvToMarkdownTable("nome,idade\nAna,30")).toBe(
      "| nome | idade |\n| --- | --- |\n| Ana | 30 |",
    );
  });

  it("escapa barra vertical dentro da célula", () => {
    // Sem escape, "a|b" criava uma coluna fantasma e quebrava a tabela.
    expect(csvToMarkdownTable('x\n"a|b"')).toBe("| x |\n| --- |\n| a\\|b |");
  });
});

describe("mdToPlainText", () => {
  it("não destrói hífens legítimos", () => {
    // Era o pior defeito: `replace(/[#*\`>-]/g, "")` apagava esses caracteres
    // do documento inteiro, dentro das palavras inclusive.
    expect(mdToPlainText("Envie um e-mail em 2024-01-15")).toBe("Envie um e-mail em 2024-01-15");
  });

  it("remove marcação de título sem tocar no texto", () => {
    expect(mdToPlainText("# Título\n\nCorpo")).toBe("Título\n\nCorpo");
  });

  it("remove marcadores de lista mantendo o item", () => {
    expect(mdToPlainText("- um\n- dois")).toBe("um\ndois");
  });

  it("mantém a numeração de listas ordenadas", () => {
    expect(mdToPlainText("1. um\n2. dois")).toBe("1. um\n2. dois");
  });

  it("reduz ênfase, código e links ao texto visível", () => {
    expect(mdToPlainText("**forte** e *fraco* e `cod` e [site](https://x.com)")).toBe(
      "forte e fraco e cod e site",
    );
  });
});

/** HTML sem as quebras de linha entre as tags (o conteúdo é o mesmo). */
const flat = (html: string) => html.replace(/>\n+</g, "><");

describe("mdToHtml", () => {
  it("converte títulos", () => {
    expect(mdToHtml("## Sub")).toContain("<h2>Sub</h2>");
  });

  it("converte lista não ordenada em <ul>", () => {
    // Antes virava um parágrafo com hífens no meio do texto.
    const html = flat(mdToHtml("- um\n- dois"));
    expect(html).toContain("<ul><li>um</li><li>dois</li></ul>");
  });

  it("converte lista ordenada em <ol>", () => {
    expect(flat(mdToHtml("1. um\n2. dois"))).toContain("<ol><li>um</li><li>dois</li></ol>");
  });

  it("preserva bloco de código cercado", () => {
    const html = mdToHtml("```js\nconst a = 1 < 2;\n```");
    expect(html).toContain('<pre><code class="language-js">const a = 1 &lt; 2;');
  });

  it("listas aninhadas, tachado e tarefas (GFM)", () => {
    const html = flat(mdToHtml("- a\n  - b\n\n~~x~~\n\n- [x] feito"));
    expect(html).toContain("<li>a<ul><li>b</li></ul></li>");
    expect(html).toContain("<del>x</del>");
    expect(html).toMatch(/<input[^>]*type="checkbox"/);
  });

  it("quebra de linha simples é espaço, não <br>", () => {
    expect(mdToHtml("linha um\nlinha dois")).not.toContain("<br");
  });

  it("não deixa link com javascript:", () => {
    expect(mdToHtml("[x](javascript:alert(1))")).not.toContain("javascript:");
  });

  it("converte citação", () => {
    expect(mdToHtml("> citado")).toContain("<blockquote>");
  });

  it("converte tabela GFM", () => {
    const html = mdToHtml("| a | b |\n| --- | --- |\n| 1 | 2 |");
    expect(html).toContain("<table>");
    expect(html).toContain("<th>a</th>");
    expect(html).toContain("<td>1</td>");
  });

  it("não trata número solto como trecho de código", () => {
    // O marcador interno de código era delimitado por espaço; qualquer
    // " 0 " na frase virava <code>.
    expect(mdToHtml("o total foi 0 reais")).toContain("o total foi 0 reais");
  });

  it("mantém asterisco literal dentro de código", () => {
    expect(mdToHtml("use `a * b` aqui")).toContain("<code>a * b</code>");
  });

  it("escapa HTML vindo do markdown", () => {
    expect(mdToHtml("<script>alert(1)</script>")).not.toContain("<script>");
  });

  it("converte linha horizontal", () => {
    expect(mdToHtml("---")).toMatch(/<hr\/?>/);
  });
});

describe("escapeHtml e textToHtml", () => {
  it("escapa o & antes dos demais, sem escapar duas vezes", () => {
    expect(escapeHtml("a & b < c")).toBe("a &amp; b &lt; c");
  });

  it("não deixa entidade quebrada quando o texto já tem &lt;", () => {
    // Antes só o "<" era escapado, então "&lt;" do texto original era
    // renderizado como "<" e o resultado deixava de ser fiel.
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });

  it("embrulha texto puro em <pre> escapado", () => {
    const html = textToHtml("1 < 2 & 3 > 2");
    expect(html).toContain(">1 &lt; 2 &amp; 3 &gt; 2</pre>");
    expect(html).toContain("white-space:pre-wrap");
  });
});

describe("convertText", () => {
  it("converte CSV para JSON", async () => {
    const out = await convertText("nome,idade\nAna,30", "csv", "json");
    expect(JSON.parse(out)).toEqual([{ nome: "Ana", idade: "30" }]);
  });

  it("converte JSON para YAML e volta", async () => {
    const yaml = await convertText('[{"a":1}]', "json", "yaml");
    const json = await convertText(yaml, "yaml", "json");
    expect(JSON.parse(json)).toEqual([{ a: 1 }]);
  });

  it("converte YAML para CSV", async () => {
    const out = await convertText("- nome: Ana\n  idade: 30", "yaml", "csv");
    expect(out).toBe("nome,idade\nAna,30");
  });

  it("devolve o mesmo texto quando origem e destino são iguais", async () => {
    expect(await convertText("abc", "txt", "txt")).toBe("abc");
  });

  it("recusa uma combinação que não existe", async () => {
    await expect(convertText("x", "csv", "html")).rejects.toThrow(/não suportada/);
  });
});

describe("separador do CSV", () => {
  it("reconhece o ponto e vírgula do Excel em português e a tabulação colada de planilha", () => {
    expect(detectDelimiter("nome;valor\nAna;1,50\nBia;2,00")).toBe(";");
    expect(detectDelimiter("nome\tvalor\nAna\t1,50")).toBe("\t");
    expect(detectDelimiter('nome,obs\nAna,"a;b;c"\nBia,"d;e"')).toBe(",");
    expect(detectDelimiter("sozinho\nAna")).toBe(",");
  });

  it("lê o CSV brasileiro com a vírgula decimal intacta", () => {
    expect(parseCsv("nome;valor\nAna;1,50")).toEqual([["nome", "valor"], ["Ana", "1,50"]]);
  });

  it("aspas no meio do campo são texto, como no Excel", () => {
    expect(parseCsv('item,obs\nTV 5" tela,ok')).toEqual([["item", "obs"], ['TV 5" tela', "ok"]]);
  });
});

describe("CSV para registros sem perder dados", () => {
  it("cabeçalho repetido ganha número em vez de sobrescrever", () => {
    expect(csvToRecords("valor,valor\n1,2")).toEqual([{ valor: "1", "valor 2": "2" }]);
  });

  it("célula além do cabeçalho ganha coluna própria", () => {
    expect(csvToRecords("a,b\n1,2,3")).toEqual([{ a: "1", b: "2", "coluna 3": "3" }]);
  });

  it("lista de valores soltos vira uma coluna", () => {
    expect(recordsToCsv([1, "dois", null])).toBe("valor\n1\ndois\n");
  });
});

describe("YAML", () => {
  it("data continua texto (YAML 1.2) e a mesclagem funciona", async () => {
    const json = await convertText("dia: 2024-01-15\nbase: &b {k: 1}\nfilho:\n  <<: *b\n  j: 2", "yaml", "json");
    expect(JSON.parse(json)).toEqual({ dia: "2024-01-15", base: { k: 1 }, filho: { k: 1, j: 2 } });
  });

  it("texto que pareceria outro tipo sai entre aspas no YAML", async () => {
    const yaml = await convertText('{"d":"2024-01-15","s":"yes","n":"123"}', "json", "yaml");
    const back = await convertText(yaml, "yaml", "json");
    expect(JSON.parse(back)).toEqual({ d: "2024-01-15", s: "yes", n: "123" });
  });
});

describe("Markdown para texto puro, pelo analisador", () => {
  it("tira escapes, entidades, sublinhado e tachado", () => {
    expect(mdToPlainText("\\*nada\\* &amp; _ênfase_ e ~~velho~~")).toBe("*nada* & ênfase e velho");
  });

  it("tabela vira colunas separadas por tabulação", () => {
    expect(mdToPlainText("| Nome | Idade |\n|---|---|\n| Ana | 30 |")).toBe("Nome\tIdade\nAna\t30");
  });

  it("sublista fica recuada sob o item e tarefa mostra a marca", () => {
    expect(mdToPlainText("- um\n  - dentro\n- [x] feito")).toBe("um\n  dentro\n[x] feito");
  });

  it("bloco de código mantém o conteúdo exato", () => {
    expect(mdToPlainText("```js\nconst a = 1;\n  b();\n```")).toBe("const a = 1;\n  b();");
  });
});

describe("HTML para texto puro, como a página mostra", () => {
  it("recolhe o espaço do código-fonte e separa parágrafos com linha em branco", async () => {
    const html = "<p>Olá,\n      mundo</p>\n<p>Segundo   parágrafo</p>";
    expect(await htmlToPlainText(html)).toBe("Olá, mundo\n\nSegundo parágrafo");
  });

  it("tabela com tabulação, listas com marcador e número", async () => {
    const html = "<table><tr><th>Nome</th><th>Idade</th></tr><tr><td>Ana</td><td>30</td></tr></table><ul><li>a</li><li>b</li></ul><ol start=\"3\"><li>c</li></ol>";
    expect(await htmlToPlainText(html)).toBe("Nome\tIdade\nAna\t30\n\n• a\n• b\n\n3. c");
  });

  it("pre mantém o espaço; CSS e elementos ocultos não aparecem", async () => {
    const html = "<style>p{color:red}</style><pre>  a\n    b</pre><p hidden>segredo</p><p>fim</p>";
    expect(await htmlToPlainText(html)).toBe("  a\n    b\n\nfim");
  });
});

describe("HTML para Markdown", () => {
  it("tabela vira tabela GFM e tachado vira ~~", async () => {
    const md = await htmlToMarkdown("<table><tr><th>A</th><th>B</th></tr><tr><td>1|2</td><td><del>x</del></td></tr></table>");
    expect(md).toBe("| A | B |\n| --- | --- |\n| 1\\|2 | ~~x~~ |");
  });
});
