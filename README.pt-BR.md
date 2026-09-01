# Matheus Marx Tools

**Uma caixa de ferramentas para o trabalho diário com arquivos — PDF, Office, imagens, áudio e vídeo — que roda inteiramente dentro do seu navegador.**

[![Licença: AGPL v3](https://img.shields.io/badge/Licen%C3%A7a-AGPL%20v3-blue.svg)](LICENSE)

Instalação oficial: <https://tools.matheusmarx.com.br/> · [Read in English](README.md)

---

## Por que mais um conversor

Quase todo "conversor online grátis" funciona do mesmo jeito: você envia o
arquivo para um servidor que não conhece, ele volta convertido, e você torce
para que tenha sido apagado. Para um contrato, um laudo médico ou a foto de um
documento, essa troca é ruim.

Este aqui não envia nada. Conversão, edição e extração de texto acontecem na
própria aba, com WebAssembly e APIs do navegador. Depois que a página carrega,
você pode desconectar da internet e tudo continua funcionando.

É também por isso que dá para hospedar por conta própria com um comando só: não
existe backend para hospedar.

## Ferramentas

| Grupo | O que faz |
| --- | --- |
| **Conversão de arquivos e mídia** | PDF ↔ DOCX/XLSX, HEIC/WEBP/AVIF, GIF → MP4, MP4/MKV/WEBM, MP3/WAV/FLAC/OPUS, CSV ↔ JSON ↔ YAML |
| **Ferramentas PDF** | Unir, separar, rotacionar, comprimir, marca d'água, reordenar, achatar, extrair imagens |
| **Edição de imagem e vídeo** | Redimensionar, comprimir, remover fundo, cortar, unir, extrair frames e áudio |
| **Bloco de notas e desenho** | Editor com formatação rica e prancheta de desenho livre |
| **Calculadora e conversões** | Calculadora científica e conversor de unidades |
| **Privacidade e utilitários** | QR Code, senhas, hashes, Base64, JSON, limpeza de metadados, esteganografia |
| **Áudio e voz** ⚠️ | Transcrição e texto para fala — *as únicas que precisam de servidor* |

Os conversores PDF ↔ Word são os que recebem mais atenção: eles reconstroem
fontes, cores, alinhamento, listas, tabelas, cabeçalho e rodapé, em vez de
despejar texto puro.

## Como rodar

### Docker (o jeito recomendado para hospedar por conta própria)

```sh
git clone https://github.com/pixelprotrafego/matheusmarx-tools.git
cd matheusmarx-tools
docker compose up -d
```

Abra <http://localhost:7767>.

A imagem é um servidor de arquivos estáticos e nada além disso — sem banco, sem
volume, sem estado. O motor de vídeo (~31 MB de WebAssembly) vai dentro dela, então
as ferramentas de vídeo funcionam sem nenhuma conexão com a internet.

```sh
docker compose down          # parar
docker compose up -d --build # reconstruir depois de atualizar o código
```

### A partir do código

Requer **Node.js 20.19+ ou 22.12+** (o que o Vite 8 exige).

```sh
npm install
npm run dev      # http://localhost:7767
```

| Comando | O que faz |
| --- | --- |
| `npm run dev` | Servidor de desenvolvimento com recarga automática |
| `npm run build` | Build de produção em `dist/` |
| `npm run preview` | Serve o build de produção localmente |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript, sem gerar arquivos |
| `npm test` | Vitest |

## Configuração

**Tudo é opcional.** Copie `.env.example` para `.env` apenas se precisar de
alguma destas.

| Variável | Padrão | Para que serve |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | vazio | Liga as duas ferramentas de Áudio e Voz |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | vazio | Idem |
| `VITE_SUPABASE_PROJECT_ID` | vazio | Idem |
| `VITE_ALLOWED_HOSTS` | vazio (desligada) | Hostnames onde a aplicação pode rodar, separados por vírgula. `localhost` é sempre liberado |

Não há variável de analytics, porque não há analytics. Veja abaixo.

O Vite grava esses valores dentro do JavaScript no momento do **build**, e não na
hora de rodar. No Docker eles são build args; veja o `docker-compose.yml`.

## A única exceção ao "tudo é local"

Transcrição e texto para fala não rodam no navegador com qualidade aceitável,
então chamam edge functions em `supabase/functions/`, que por sua vez usam a API
da Groq (Whisper e Orpheus).

**Sem o Supabase configurado, essas duas ferramentas mostram um aviso dizendo que
estão desligadas. Nada mais é afetado.** Para ligá-las, você precisa de um
projeto Supabase próprio:

| Secret | Onde | Para que serve |
| --- | --- | --- |
| `GROQ_API_KEY` | Supabase | Acesso à API da Groq |
| `ALLOWED_ORIGINS` | Supabase | Origens autorizadas a chamar as functions. Vazio desliga a checagem |
| `TELEGRAM_BOT_TOKEN` | Supabase | Bot do Telegram, opcional |
| `TELEGRAM_ALLOWED_CHAT_IDS` | Supabase | Chat ids autorizados a usar o bot. Vazio = ninguém |

O banco guarda apenas dados descartáveis: contadores de limite por IP e arquivos
do Telegram aguardando uma ação, com validade de minutos. Nenhum conteúdo de
usuário é armazenado.

## As letras miúdas da privacidade

**Uma instalação própria não faz nenhuma requisição externa.** Não é "quase
nenhuma": a imagem Docker vai com uma Content-Security-Policy que não libera
origem de terceiro alguma, então qualquer tentativa de buscar algo lá fora falha
de forma visível em vez de acontecer em silêncio. O CI confere isso a cada push.

O que isso custou, e o que significa para você:

- **As fontes** (Sora e DM Sans) são servidas de `/fonts/`, no seu próprio
  domínio. Antes vinham do Google Fonts, que recebia o IP de cada visitante a
  cada carregamento de página. São arquivos `woff2` de peso variável, ~104 KB no
  total, sob a SIL Open Font License 1.1 (veja `public/fonts/`).
- **O ffmpeg** também é servido pelo seu domínio. `unpkg`/`jsdelivr` continuam
  no código apenas como rede de segurança caso essa cópia falte, e a CSP do
  Docker os bloqueia — assim uma cópia faltando falha na sua cara em vez de
  virar uma chamada externa.
- **Não há rastreamento.** Não é "desligado por padrão": não existe. Não há
  rastreador neste código, e não há nenhum rodando no site oficial. Já houve um
  pixel da Meta no deploy oficial; ele foi removido, junto com as origens do
  Meta que a CSP liberava. Ele continua visível no histórico do git, onde um id
  de pixel é inofensivo: esse id é público por natureza, impresso no HTML de
  toda página que roda um.
- **Áudio e voz** enviam áudio e texto para um servidor, como descrito acima.
  São claramente marcadas e ficam desligadas por padrão.

Todo o resto — cada conversão, cada operação de PDF, cada edição de imagem e
vídeo — acontece na aba e não toca a rede.

## Publicando um fork

Se você for publicar isto num domínio próprio, edite o `index.html` e troque
`og:url`, `og:image`, `twitter:image`, `canonical` e os dois blocos JSON-LD, que
apontam para a instalação oficial. Revise também a `Content-Security-Policy` em
`docker/nginx.conf` (auto-hospedagem) ou `vercel.json` (Vercel).

O `src/components/DomainGuard.tsx` prende um build a hostnames específicos via
`VITE_ALLOWED_HOSTS`. É uma conveniência da instalação oficial, não um controle
de segurança — com o código aberto, qualquer um o remove.

## Arquitetura

- **Vite** + **React 18** + **TypeScript**, sem renderização no servidor
- **Tailwind CSS** + **shadcn/ui** (Radix)
- **pdf.js** / **pdf-lib** — leitura e manipulação de PDF
- **docx**, **docx-preview**, **SheetJS** — formatos do Office
- **ffmpeg.wasm** — áudio e vídeo
- **fabric** — prancheta de desenho · **TipTap** — editor de texto rico
- **@imgly/background-removal** — remoção de fundo com modelo local

O motor de PDF → Word fica em `src/lib/pdf-to-docx/`, documentado módulo a
módulo; `scripts/diagnostico-pdf-docx.mjs` roda esse motor num Chromium de
verdade e grava o `.docx` resultante para conferência.

## Contribuindo

Issues e pull requests são bem-vindos — veja o [CONTRIBUTING.md](CONTRIBUTING.md).
Os comentários do código são em português e explicam o *porquê* de cada decisão;
por favor mantenha esse hábito. Para relatar um problema de segurança, leia o
[SECURITY.md](SECURITY.md).

## Licença

[GNU Affero General Public License v3.0 ou posterior](LICENSE).

Não foi uma escolha de estilo. O projeto depende de `@imgly/background-removal`
(AGPL-3.0) e `@ffmpeg/core` (GPL-2.0-or-later), então o trabalho combinado
precisa ser AGPL. Na prática significa: use, modifique, hospede — mas se você
rodar uma versão modificada como serviço público, publique suas modificações
também.

Veja o [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md) para o detalhamento
das dependências.
