import { db } from "./db.ts";

const TTL_MIN = 15;

export interface StoredFile {
  key: string;
  fileId: string;
  mime: string;
  filename: string;
}

export function shortKey(): string {
  return Math.random().toString(36).slice(2, 10);
}

export async function putFile(chatId: number, fileId: string, mime: string, filename: string): Promise<string> {
  const key = shortKey();
  const { error } = await db().from("telegram_pending_files").insert({
    key, chat_id: chatId, file_id: fileId, mime: mime ?? "", filename: filename ?? "",
  });
  if (error) throw new Error(`file-store.put: ${error.message}`);
  await cleanup();
  return key;
}

export async function getFile(key: string): Promise<StoredFile | null> {
  await cleanup();
  const { data, error } = await db()
    .from("telegram_pending_files")
    .select("key, file_id, mime, filename, created_at")
    .eq("key", key)
    .maybeSingle();
  if (error) throw new Error(`file-store.get: ${error.message}`);
  if (!data) return null;
  return { key: data.key, fileId: data.file_id, mime: data.mime, filename: data.filename };
}

async function cleanup() {
  const cutoff = new Date(Date.now() - TTL_MIN * 60_000).toISOString();
  await db().from("telegram_pending_files").delete().lt("created_at", cutoff);
}