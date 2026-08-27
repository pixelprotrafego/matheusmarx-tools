# Migrar para um Supabase próprio

> **Se o PowerShell responder `O termo 'npm' não é reconhecido`**: o Node está
> instalado, mas a janela do terminal foi aberta antes da instalação e não
> enxergou o PATH atualizado. **Feche o terminal e abra outro** — se estiver no
> VS Code, feche o VS Code inteiro. Confirme com `npm --version`. Para
> destravar só a janela atual, sem reabrir:
>
> ```powershell
> $env:Path = "C:\Program Files\nodejs;" + $env:Path
> ```

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

O CLI do Supabase roda por `npx`, sem precisar instalar nada:

```powershell
npx supabase login
npx supabase link --project-ref abcdefgh
npx supabase db push
```

O `link` pede a senha do banco (a do passo 1) e preenche o `project_id` em
`supabase/config.toml` sozinho. O `db push` aplica
`supabase/migrations/20260827000000_schema_inicial.sql`, que cria as três
tabelas com as permissões corretas.

> **Se o `db push` der "Connection timed out"**: em projetos novos o host
> `db.<ref>.supabase.co` só atende por IPv6, e a maioria das conexões
> domésticas não tem IPv6 de verdade. Use o **Session pooler**, que atende por
> IPv4 — no painel, em **Connection string**, escolha *Session pooler* em vez
> de *Direct connection*. O endereço tem outro formato, com o ref no nome do
> usuário:
>
> ```
> postgresql://postgres.abcdefgh:SENHA@aws-0-sa-east-1.pooler.supabase.com:5432/postgres
> ```
>
> Passe essa string em `npx supabase db push --db-url "<string>"`.

Confira em **Table Editor**: devem aparecer `ip_rate_limits`,
`telegram_pending_files` e `telegram_pending_actions`. Só isso — as tabelas
`posts` e `user_roles` do banco antigo eram de um blog que nunca existiu na
aplicação e ficaram para trás de propósito.

---

## 5. Cadastrar os secrets

Estes valores ficam no servidor e nunca chegam ao navegador. O `--project-ref`
evita depender do `link`, então nem a senha do banco é necessária aqui:

```powershell
npx supabase login
npx supabase secrets set --project-ref abcdefgh "GROQ_API_KEY=gsk_..."
```

A chave da Groq sai de <https://console.groq.com/keys>. É ela que paga a
transcrição de áudio e a geração de voz.

Sempre entre aspas: o token do Telegram tem dois-pontos, e sem aspas o
PowerShell pode quebrar o argumento no lugar errado.

Se for usar o bot do Telegram, também:

```powershell
npx supabase secrets set --project-ref abcdefgh "TELEGRAM_BOT_TOKEN=123456789:AAH..."
npx supabase secrets set --project-ref abcdefgh "TELEGRAM_ALLOWED_CHAT_IDS=987654321"
```

A seção 7 explica de onde vem cada um desses dois números.

Quando o site voltar ao domínio definitivo, acrescente:

```powershell
npx supabase secrets set --project-ref abcdefgh "ALLOWED_ORIGINS=https://tools.matheusmarx.com.br"
```

Confira o que ficou cadastrado (mostra só os nomes, nunca os valores):

```powershell
npx supabase secrets list --project-ref abcdefgh
```

---

## 6. Publicar as edge functions

```powershell
npx supabase functions deploy transcribe-audio --project-ref abcdefgh
npx supabase functions deploy groq-tts --project-ref abcdefgh
npx supabase functions deploy telegram-webhook --project-ref abcdefgh
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
