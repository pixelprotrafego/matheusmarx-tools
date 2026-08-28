import { describe, it, expect } from "vitest";
import {
  evenAndOddHeadersEnabled,
  needsEvenRefStrip,
  stripEvenHeaderFooterRefs,
} from "@/lib/docx-normalize";

/** O sectPr real do documento que revelou o problema. */
const SECT_PR = `<w:sectPr w:rsidR="00A539E5">
  <w:headerReference w:type="even" r:id="rId9"/>
  <w:headerReference w:type="default" r:id="rId10"/>
  <w:footerReference w:type="default" r:id="rId11"/>
  <w:headerReference w:type="first" r:id="rId12"/>
  <w:footerReference w:type="first" r:id="rId13"/>
  <w:pgSz w:w="11906" w:h="16838"/>
  <w:titlePg/>
</w:sectPr>`;

describe("evenAndOddHeadersEnabled", () => {
  it("é falso quando a opção não existe", () => {
    // O caso do documento real: a opção nunca foi ligada.
    expect(evenAndOddHeadersEnabled("<w:settings><w:zoom/></w:settings>")).toBe(false);
  });

  it("é verdadeiro quando a tag está presente sem atributo", () => {
    expect(evenAndOddHeadersEnabled("<w:settings><w:evenAndOddHeaders/></w:settings>")).toBe(true);
  });

  it("respeita w:val explícito", () => {
    expect(evenAndOddHeadersEnabled('<w:evenAndOddHeaders w:val="true"/>')).toBe(true);
    expect(evenAndOddHeadersEnabled('<w:evenAndOddHeaders w:val="1"/>')).toBe(true);
    expect(evenAndOddHeadersEnabled('<w:evenAndOddHeaders w:val="false"/>')).toBe(false);
    expect(evenAndOddHeadersEnabled('<w:evenAndOddHeaders w:val="0"/>')).toBe(false);
    expect(evenAndOddHeadersEnabled('<w:evenAndOddHeaders w:val="off"/>')).toBe(false);
  });

  it("não confunde com outra tag de nome parecido", () => {
    expect(evenAndOddHeadersEnabled("<w:evenAndOddHeadersFoo/>")).toBe(false);
  });
});

describe("stripEvenHeaderFooterRefs", () => {
  it("remove a referência de cabeçalho par", () => {
    const saida = stripEvenHeaderFooterRefs(SECT_PR);
    expect(saida).not.toContain('w:type="even"');
  });

  it("preserva as referências default e first", () => {
    const saida = stripEvenHeaderFooterRefs(SECT_PR);
    expect(saida).toContain('w:type="default" r:id="rId10"');
    expect(saida).toContain('w:type="first" r:id="rId12"');
    expect(saida).toContain('w:type="default" r:id="rId11"');
  });

  it("remove também rodapé par", () => {
    const xml = '<w:footerReference w:type="even" r:id="rId8"/><w:footerReference w:type="default" r:id="rId9"/>';
    const saida = stripEvenHeaderFooterRefs(xml);
    expect(saida).toBe('<w:footerReference w:type="default" r:id="rId9"/>');
  });

  it("não altera o resto do documento", () => {
    const saida = stripEvenHeaderFooterRefs(SECT_PR);
    expect(saida).toContain('<w:pgSz w:w="11906" w:h="16838"/>');
    expect(saida).toContain("<w:titlePg/>");
  });

  it("aceita atributos em ordem diferente", () => {
    const xml = '<w:headerReference r:id="rId9" w:type="even"/>';
    expect(stripEvenHeaderFooterRefs(xml)).toBe("");
  });

  it("é inofensivo quando não há referência par", () => {
    const xml = '<w:headerReference w:type="default" r:id="rId1"/>';
    expect(stripEvenHeaderFooterRefs(xml)).toBe(xml);
  });
});

describe("needsEvenRefStrip", () => {
  it("pede correção no caso do documento real", () => {
    expect(needsEvenRefStrip("<w:settings/>", SECT_PR)).toBe(true);
  });

  it("não mexe quando o Word realmente usa páginas pares", () => {
    expect(needsEvenRefStrip("<w:evenAndOddHeaders/>", SECT_PR)).toBe(false);
  });

  it("não mexe quando não há referência par", () => {
    const xml = '<w:headerReference w:type="default" r:id="rId1"/>';
    expect(needsEvenRefStrip("<w:settings/>", xml)).toBe(false);
  });
});
