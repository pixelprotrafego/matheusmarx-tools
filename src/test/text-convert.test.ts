import { describe, it, expect } from "vitest";
import {
  convertText,
  csvToMarkdownTable,
  csvToRecords,
  escapeHtml,
  mdToHtml,
  mdToPlainText,
  parseCsv,
  recordsToCsv,
  textToHtml,
} from "@/lib/text-convert";

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

describe("mdToHtml", () => {
  it("converte títulos", () => {
    expect(mdToHtml("## Sub")).toContain("<h2>Sub</h2>");
  });

  it("converte lista não ordenada em <ul>", () => {
    // Antes virava um parágrafo com hífens no meio do texto.
    const html = mdToHtml("- um\n- dois");
    expect(html).toContain("<ul><li>um</li><li>dois</li></ul>");
  });

  it("converte lista ordenada em <ol>", () => {
    expect(mdToHtml("1. um\n2. dois")).toContain("<ol><li>um</li><li>dois</li></ol>");
  });

  it("preserva bloco de código cercado", () => {
    const html = mdToHtml("```js\nconst a = 1 < 2;\n```");
    expect(html).toContain('<pre><code class="language-js">const a = 1 &lt; 2;</code></pre>');
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
    expect(mdToHtml("---")).toContain("<hr/>");
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
    expect(html).toContain("<pre>1 &lt; 2 &amp; 3 &gt; 2</pre>");
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
