import { getStore } from "./store.js";

/**
 * Estado curto do bot do Telegram.
 *
 * Guarda só o `file_id` que o Telegram atribuiu ao arquivo — nunca o conteúdo.
 * Quando a ação é escolhida, o arquivo é baixado de novo do Telegram.
 */

/** Arquivo recebido, esperando o clique num dos botões do menu. */
export interface StoredFile {
  fileId: string;
  mime: string;
  filename: string;
}

/** Ação esperando um dado que a pessoa ainda vai digitar (intervalo de páginas, largura). */
export interface Pending extends StoredFile {
  op: "split" | "resize";
}

const TTL_ARQUIVO = 15 * 60;
const TTL_PENDENTE = 5 * 60;
const TTL_UPDATE = 60 * 60;

/** Chave curta e aleatória: entra no `callback_data`, que o Telegram limita a 64 bytes. */
function chaveCurta(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 10);
}

export async function putFile(file: StoredFile): Promise<string> {
  const key = chaveCurta();
  await getStore().set(`tg:file:${key}`, file, TTL_ARQUIVO);
  return key;
}

export function getFile(key: string): Promise<StoredFile | null> {
  return getStore().get<StoredFile>(`tg:file:${key}`);
}

export async function setPending(chatId: number, pending: Pending): Promise<void> {
  await getStore().set(`tg:pending:${chatId}`, pending, TTL_PENDENTE);
}

/** Lê e apaga numa só operação lógica: a ação pendente vale para uma resposta. */
export async function takePending(chatId: number): Promise<Pending | null> {
  const store = getStore();
  const pending = await store.get<Pending>(`tg:pending:${chatId}`);
  if (pending) await store.del(`tg:pending:${chatId}`);
  return pending;
}

/**
 * Marca um update como processado. Devolve `false` se ele já tinha sido visto.
 *
 * O Telegram reenvia o update quando a resposta demora — o que acontece numa
 * transcrição longa. Sem isto, a mesma mensagem de voz seria transcrita duas
 * vezes. Diferente da versão anterior, que lembrava só dentro da mesma
 * instância, aqui a marca fica no Redis e vale para todas.
 */
export async function claimUpdate(updateId: number): Promise<boolean> {
  try {
    return await getStore().claim(`tg:update:${updateId}`, TTL_UPDATE);
  } catch (e) {
    console.error("[telegram] falha ao marcar update, processando mesmo assim:", e);
    return true;
  }
}
