# Conversão Word → PDF fiel ao original

## A regra

Conversão é conversão: o PDF tem que sair igual ao documento de origem, só em
outro formato. Não existe modo "só o texto" — ele foi removido, junto com o
helper `src/lib/docx-to-pdf-text.ts` que o implementava.

## Como funciona

`src/components/tools/DocxToPdf.tsx` renderiza o documento Word de verdade num
container invisível (`.docx-render-host`, definido em `src/index.css`) usando o
`docx-preview`, espera fontes e imagens carregarem, e captura cada página com
`html2canvas` para dentro do `jsPDF`.

Cada página do PDF sai com o tamanho que o Word declarou (`sectPr`), e não em A4
presumido — forçar A4 encolhia e centralizava documentos em Carta, ofício ou A5.
A imagem entra como PNG, não JPEG: o JPEG cria halos de compressão ao redor das
letras, e o deflate do próprio PDF já dá conta do tamanho em página de texto.

## A paginação — onde estava o bug

O `docx-preview` **não reflui texto**. Ele só começa uma `<section>` nova quando
encontra uma marca explícita de quebra, e a altura da página entra como
`min-height`: se o conteúdo passa disso, a seção simplesmente cresce. Um Word de
dez páginas virava uma seção de dez páginas de altura e, no fim, um PDF de
**uma página só, muito comprida**.

O Word grava em cada arquivo onde ele próprio quebrou as páginas, no elemento
`w:lastRenderedPageBreak`. O `docx-preview` ignora essas marcas por padrão
(`ignoreLastRenderedPageBreak: true`), e era exatamente essa a origem do
problema. Agora a opção é passada como `false`, e a paginação sai idêntica à que
o usuário vê no Word.

Arquivos que nunca passaram pelo Word (exportados do Google Docs, do LibreOffice
ou gerados por script) não trazem essas marcas. Para esses existe a paginação de
reserva em `src/lib/docx-pagination.ts`: a seção alta demais é dividida em
fatias da altura declarada, e os cortes caem em bordas de blocos — parágrafo,
tabela, imagem — para não partir uma linha de texto ao meio. Um bloco isolado
maior que a página inteira é cortado na altura cheia, porque não há borda melhor.

A captura é feita fatia por fatia, usando as opções `x`/`y`/`width`/`height` do
`html2canvas`, que são relativas ao próprio elemento. Assim o canvas nunca fica
mais alto que uma página, e um documento de centenas de páginas não estoura a
memória da aba.

## Limitações honestas

- Marca d'água feita como forma VML no cabeçalho aparece; efeitos raros de
  WordArt podem sair simplificados.
- Fontes proprietárias não instaladas no navegador são substituídas pela mais
  próxima — isso vale para qualquer conversor que rode no navegador.
- O texto do PDF é imagem, não texto selecionável. É o preço de ser fiel ao
  layout com renderização no navegador.
- A nitidez cede conforme o documento cresce (escala 3 até 20 páginas, 2,5 até
  60, 2 acima disso), para não estourar a memória da aba.

## Testes

`src/test/docx-pagination.test.ts` cobre a lógica de fatiamento: documento que
cabe em uma página, documento longo, corte em borda de bloco, cobertura sem
buraco nem sobreposição, bloco maior que a página e entradas degeneradas.

O resto depende de renderização real e continua sendo validado à mão: converter
um `.docx` com marca d'água, imagem e cabeçalho, abrir o PDF e comparar página a
página com o original.
