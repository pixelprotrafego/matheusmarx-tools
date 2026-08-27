# Matheus Marx Tools

Hub de ferramentas utilitárias que rodam **inteiramente no navegador**. Nenhum
arquivo do usuário sai da máquina dele: conversões, edições e cálculos acontecem
localmente, via WebAssembly e APIs nativas do navegador.

Produção: <https://tools.matheusmarx.com.br/>

## Ferramentas

| Grupo | O que faz |
| --- | --- |
| Áudio & Voz | Transcrição de áudio e texto para fala |
| Notepad & Desenho | Bloco de notas com formatação rica e prancheta de desenho livre |
| Calculadora & Conversões | Calculadora científica e conversor de unidades |
| Conversão de Arquivos & Mídia | PDF ↔ DOCX/XLSX, HEIC/WEBP/AVIF, GIF → MP4, MP4/MKV/WEBM, MP3/WAV/FLAC/OPUS, CSV ↔ JSON ↔ YAML |
| Ferramentas PDF | Unir, separar, rotacionar, comprimir, marca d'água, reordenar, achatar, extrair imagens |
| Edição de Imagem & Vídeo | Redimensionar, comprimir, remover fundo, cortar, unir, extrair frames e áudio |
| Privacidade & Utilitários | QR Code, senhas, hashes, Base64, JSON, limpeza de metadados, esteganografia |

## Stack

- **Vite** + **React 18** + **TypeScript**
- **Tailwind CSS** + **shadcn/ui** (Radix)
- **pdf-lib** / **pdf.js** — manipulação e leitura de PDF
- **ffmpeg.wasm** — áudio e vídeo
- **SheetJS**, **mammoth**, **docx**, **docx-preview** — arquivos Office
- **fabric** — prancheta de desenho
- **TipTap** — editor de texto rico
- **@imgly/background-removal** — remoção de fundo por modelo local

## Rodando localmente

Requer Node.js 20+.

```sh
npm install
npm run dev      # http://localhost:8080
```

Outros comandos:

```sh
npm run build    # build de produção em dist/
npm run preview  # serve o build localmente
npm run lint     # eslint
npm test         # vitest
```

## Variáveis de ambiente

Copie `.env.example` para `.env` e preencha conforme necessário.

| Variável | Obrigatória | Para que serve |
| --- | --- | --- |
| `VITE_ALLOWED_HOSTS` | não | Trava de domínio. Lista de hostnames separados por vírgula onde a aplicação pode rodar. Vazio = trava desligada. Um item iniciado por `.` libera o domínio e seus subdomínios. |
| `VITE_SUPABASE_URL` | sim¹ | URL do projeto Supabase |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | sim¹ | Chave publishable (anon) do Supabase |
| `VITE_SUPABASE_PROJECT_ID` | sim¹ | ID do projeto Supabase |

¹ Necessárias apenas para as duas ferramentas de Áudio & Voz, que são as únicas
que dependem de servidor. Todo o resto funciona sem nenhuma configuração.

## Backend

As ferramentas de **transcrição de áudio** e **texto para fala** são a única
exceção ao processamento local: elas chamam edge functions em `supabase/functions/`,
que por sua vez usam a API da Groq (Whisper e Orpheus).

| Secret | Onde | Para que serve |
| --- | --- | --- |
| `GROQ_API_KEY` | Supabase | Acesso à API da Groq |
| `ALLOWED_ORIGINS` | Supabase | Origens autorizadas a chamar as functions. Vazio = checagem desligada. |
| `TELEGRAM_BOT_TOKEN` | Supabase | Token do bot, para o webhook do Telegram |
| `TELEGRAM_ALLOWED_CHAT_IDS` | Supabase | Chat ids autorizados a usar o bot, separados por vírgula. Vazio = ninguém. |

O banco guarda apenas dados descartáveis: contadores de limite por IP e
arquivos do Telegram aguardando uma ação, com validade de minutos. Nenhum
conteúdo de usuário é armazenado.

Para trocar de projeto Supabase, veja
[docs/migrar-para-supabase-proprio.md](docs/migrar-para-supabase-proprio.md).

## Bot do Telegram

O bot expõe as ferramentas pelo chat: `/calc`, `/conv`, `/qr`, `/senha`, `/tts`,
além de transcrever áudios e oferecer um menu de ações ao receber PDF, imagem,
DOCX ou XLSX. Ele fala direto com `api.telegram.org`.

A configuração envolve **dois números diferentes**:

- **`TELEGRAM_BOT_TOKEN`** — a senha do bot, entregue pelo `@BotFather`. Tem
  dois-pontos no meio: `123456789:AAHdqTcvCH1...`
- **`TELEGRAM_ALLOWED_CHAT_IDS`** — o id da **sua conta pessoal** do Telegram,
  que autoriza você a usar o bot. É só um número: `987654321`. Sem ele, o bot
  ignora todo mundo em silêncio.

```sh
supabase functions deploy telegram-webhook
supabase secrets set TELEGRAM_BOT_TOKEN=<token do @BotFather>
supabase secrets set GROQ_API_KEY=<sua chave da Groq>

# Descobrir o id da sua conta (mande uma mensagem ao bot antes)
$env:TELEGRAM_BOT_TOKEN = "<token>"
npm run telegram chat-id
supabase secrets set TELEGRAM_ALLOWED_CHAT_IDS=<o id da sua conta>

# Registrar o webhook e conferir
npm run telegram set https://<ref>.supabase.co/functions/v1/telegram-webhook
npm run telegram status
```

O `secret_token` do webhook é derivado do próprio token do bot, então não
precisa ser guardado: a edge function recalcula e compara a cada update.

Limite herdado da Bot API: o bot só consegue baixar arquivos de até 20 MB.

## Deploy

O build é estático (`dist/`) e pode ser servido por qualquer host de arquivos.
Em produção, defina `VITE_ALLOWED_HOSTS` no ambiente de build e `ALLOWED_ORIGINS`
nos secrets do Supabase para restringir o uso ao domínio oficial.
