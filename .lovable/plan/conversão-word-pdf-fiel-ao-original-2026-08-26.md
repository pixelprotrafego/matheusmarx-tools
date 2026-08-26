# Conversão Word → PDF fiel ao original

## O problema

A ferramenta atual extrai apenas o **texto** do arquivo Word (usando `mammoth`) e o redesenha do zero no PDF. Por isso somem: imagens, marca d'água, cores de fundo, cabeçalho/rodapé, colunas, alinhamentos, fontes e espaçamento reais. O que sai é um "texto limpo em PDF", não uma cópia do documento.

## A reestruturação

Trocar o motor: em vez de extrair texto, **renderizar o documento Word de verdade** na tela (invisível para o usuário) usando a biblioteca `docx-preview` — que já está instalada no projeto e desenha páginas A4 com estilos, imagens, cabeçalhos, rodapés e marcas d'água — e então capturar cada página renderizada para dentro do PDF.

### Dois modos de saída

1. **Fiel ao original (padrão)** — layout idêntico: imagens, marca d'água, fundo, fontes e posicionamento preservados. O texto vira imagem de alta resolução (não selecionável).
2. **Texto selecionável (alternativo)** — o comportamento atual, para quem precisa copiar/buscar texto e não se importa com o visual.

O usuário escolhe com um seletor antes de converter (mantendo a regra do app de nunca processar automaticamente no upload).

## Detalhes técnicos

**Arquivo principal:** `src/components/tools/DocxToPdf.tsx` (reescrita)

- Renderizar com `docx-preview` em um container fora da tela (`position: fixed; left: -10000px`), com as opções `breakPages: true`, `renderHeaders: true`, `renderFooters: true`, `renderBackground: true`, `experimental: true`, `useBase64URL: true` (evita `blob:` que quebra na captura) e largura fixa de página A4.
- Aguardar `document.fonts.ready` + carregamento de todas as `<img>` antes de capturar, senão páginas saem em branco.
- Para cada `section.docx` gerada (uma por página do Word):
  - `html2canvas(section, { scale: 2, backgroundColor: "#ffffff", useCORS: true })`
  - inserir no `jsPDF` como JPEG (qualidade 0.92) ocupando a página A4 inteira, respeitando a proporção; orientação detectada por página (retrato/paisagem).
- Progresso real por página (`página N de M`).
- Limites de segurança: aviso acima de ~60 páginas e liberação do canvas a cada página para não estourar memória.
- Todo o processamento continua **100% no navegador** — nenhum upload.

**Modo texto selecionável:** o código atual de `mammoth` + `jsPDF.text()` é extraído para um helper `src/lib/docx-to-pdf-text.ts` e acionado só quando esse modo é escolhido.

**Estilos:** adicionar no `src/index.css` um escopo `.docx-render-host` para neutralizar o tema escuro do app dentro do container de renderização (o Word precisa ser desenhado em fundo branco com cores próprias).

## Limitações honestas

- Marca d'água feita como forma VML no cabeçalho aparece; efeitos raros de WordArt podem sair simplificados.
- Fontes proprietárias não instaladas no navegador são substituídas pela mais próxima (isso vale para qualquer conversor que rode no navegador).
- No modo fiel, o PDF fica maior e sem texto pesquisável — por isso o segundo modo continua disponível.

## Validação

Converter um `.docx` com marca d'água, imagem e cabeçalho; abrir o PDF resultante e comparar página a página com o original antes de entregar.
