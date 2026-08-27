# Migrar para um Supabase próprio

Passo a passo para sair do projeto Supabase provisionado pela Lovable e passar
para um projeto na sua própria conta.

Nada precisa ser copiado do banco antigo. As três tabelas que a aplicação usa
guardam apenas dados descartáveis: contadores de limite por IP e arquivos do
Telegram aguardando uma ação, com validade de 5 a 15 minutos. Não há conteúdo
de usuário lá dentro.

---

## 1. Criar o projeto

No painel do Supabase (<https://supabase.com/dashboard>), clique em
**New project**.

- **Name**: `matheusmarx-tools`
- **Database Password**: gere uma senha forte e **guarde num gerenciador de
  senhas**. Ela não é mostrada de novo, e sem ela não dá para conectar direto
  no Postgres.
- **Region**: `South America (São Paulo)` — é a mais perto dos seus usuários.

A criação leva alguns minutos.

---

## 2. Copiar as três credenciais

Ainda no painel do projeto novo, vá em **Project Settings** (engrenagem no menu
lateral) → **API**. Você vai precisar de:

| No painel | Cara que tem | Vai para |
| --- | --- | --- |
| **Project URL** | `https://abcdefgh.supabase.co` | `VITE_SUPABASE_URL` |
| **Project API keys → `anon` `public`** | um texto longo começando em `eyJ...` | `VITE_SUPABASE_PUBLISHABLE_KEY` |
| **Reference ID** (em **General**) | `abcdefgh` | `VITE_SUPABASE_PROJECT_ID` |

O **Reference ID** é o mesmo pedaço que aparece na URL do painel:
`https://supabase.com/dashboard/project/abcdefgh`.

> Existe uma quarta chave nessa tela, a `service_role`. **Ela não entra no
> `.env` nem em lugar nenhum do front.** Dá acesso total ao banco ignorando
> todas as regras de segurança. As edge functions a recebem sozinhas, do próprio
> Supabase.

---

## 3. Apontar o projeto para o banco novo

Edite o arquivo `.env` na raiz, trocando os três valores:

```
VITE_SUPABASE_PROJECT_ID="abcdefgh"
VITE_SUPABASE_PUBLISHABLE_KEY="eyJ..."
VITE_SUPABASE_URL="https://abcdefgh.supabase.co"
```

---

## 4. Criar as tabelas

Instale o CLI do Supabase, se ainda não tiver:

```powershell
npm install -g supabase
```

Depois, na pasta do projeto:

```powershell
supabase login
supabase link --project-ref abcdefgh
supabase db push
```

O `link` pede a senha do banco (a do passo 1) e preenche o `project_id` em
`supabase/config.toml` sozinho. O `db push` aplica
`supabase/migrations/20260827000000_schema_inicial.sql`, que cria as três
tabelas com as permissões corretas.

Confira em **Table Editor**: devem aparecer `ip_rate_limits`,
`telegram_pending_files` e `telegram_pending_actions`. Só isso — as tabelas
`posts` e `user_roles` do banco antigo eram de um blog que nunca existiu na
aplicação e ficaram para trás de propósito.

---

## 5. Cadastrar os secrets

Estes valores ficam no servidor e nunca chegam ao navegador:

```powershell
supabase secrets set GROQ_API_KEY=gsk_...
```

A chave da Groq sai de <https://console.groq.com/keys>. É ela que paga a
transcrição de áudio e a geração de voz.

Se for usar o bot do Telegram, também:

```powershell
supabase secrets set TELEGRAM_BOT_TOKEN=123456789:AAH...
supabase secrets set TELEGRAM_ALLOWED_CHAT_IDS=987654321
```

A seção 7 explica de onde vem cada um desses dois números.

Quando o site voltar ao domínio definitivo, acrescente:

```powershell
supabase secrets set ALLOWED_ORIGINS=https://tools.matheusmarx.com.br
```

---

## 6. Publicar as edge functions

```powershell
supabase functions deploy transcribe-audio
supabase functions deploy groq-tts
supabase functions deploy telegram-webhook
```

Teste a transcrição pelo site antes de seguir. Se falhar, veja o motivo em
**Edge Functions → transcribe-audio → Logs**.

---

## 7. Configurar o bot do Telegram

São **dois números diferentes**, e é fácil confundir:

**`TELEGRAM_BOT_TOKEN` — a senha do bot.**
Quem dá é o [@BotFather](https://t.me/BotFather) no próprio Telegram. Mande
`/newbot` para ele (ou `/mybots` se o bot já existe) e ele devolve algo como
`123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw`. Repare no formato: números,
dois-pontos, e uma sequência longa de letras.

**`TELEGRAM_ALLOWED_CHAT_IDS` — quem pode falar com o bot. É você.**
É o identificador da **sua conta pessoal do Telegram**, não do bot. Serve para
o bot atender só você e ignorar qualquer estranho que o encontre. É só um
número, sem dois-pontos, tipo `987654321`.

Para descobrir o seu:

```powershell
$env:TELEGRAM_BOT_TOKEN = "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw"
npm run telegram chat-id
```

Se ele disser que não há mensagens recentes, **abra o Telegram, procure o seu
bot pelo @nome e mande qualquer coisa para ele** (um "oi" serve). Rode o
comando de novo e o número vai aparecer. Cadastre:

```powershell
supabase secrets set TELEGRAM_ALLOWED_CHAT_IDS=987654321
```

Por fim, registre o webhook — é o endereço que o Telegram chama a cada mensagem:

```powershell
npm run telegram set https://abcdefgh.supabase.co/functions/v1/telegram-webhook
npm run telegram status
```

O `status` deve mostrar o nome do bot, a URL registrada e nenhum erro recente.
Mande `/help` para o bot: se ele responder com a lista de comandos, está pronto.

> Se o bot ficar mudo, quase sempre é `TELEGRAM_ALLOWED_CHAT_IDS` com o número
> errado — ele ignora em silêncio quem não está na lista. O chat id que tentou
> falar aparece em **Edge Functions → telegram-webhook → Logs**.

---

## 8. Atualizar a Vercel

Em **Settings → Environment Variables**, confira se existe alguma
`VITE_SUPABASE_*` cadastrada. Se existir, atualize com os valores novos; se
estiver vazia ou apontando para o projeto antigo, corrija — o valor do painel
tem prioridade sobre o `.env` do repositório.

Depois faça um novo deploy para o build pegar os valores.

---

## 9. Conferir antes de desligar o antigo

- [ ] Transcrição de áudio funciona no site
- [ ] Texto para fala funciona no site
- [ ] O bot responde `/help` no Telegram
- [ ] O bot transcreve um áudio enviado por lá
- [ ] Nenhum erro em **Edge Functions → Logs**

Só depois de tudo verde é seguro encerrar o projeto antigo e a conta da Lovable.
