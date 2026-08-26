import { db } from "./db.ts";

const TTL_MIN = 5;

export interface Pending {
  op: "split" | "resize";
  fileId: string;
  mime: string;
  filename: string;
}

export async function setPending(chatId: number, p: Pending): Promise<void> {
  await cleanup();
  const { error } = await db().from("telegram_pending_actions").upsert({
    chat_id: chatId, op: p.op, file_id: p.fileId, mime: p.mime, filename: p.filename,
    created_at: new Date().toISOString(),
  }, { onConflict: "chat_id" });
  if (error) throw new Error(`pending.set: ${error.message}`);
}

export async function takePending(chatId: number): Promise<Pending | null> {
  await cleanup();
  const { data, error } = await db()
    .from("telegram_pending_actions")
    .select("op, file_id, mime, filename")
    .eq("chat_id", chatId)
    .maybeSingle();
  if (error) throw new Error(`pending.take: ${error.message}`);
  if (!data) return null;
  await db().from("telegram_pending_actions").delete().eq("chat_id", chatId);
  return { op: data.op as Pending["op"], fileId: data.file_id, mime: data.mime, filename: data.filename };
}

export async function hasPending(chatId: number): Promise<boolean> {
  await cleanup();
  const { data } = await db()
    .from("telegram_pending_actions").select("chat_id").eq("chat_id", chatId).maybeSingle();
  return !!data;
}

async function cleanup() {
  const cutoff = new Date(Date.now() - TTL_MIN * 60_000).toISOString();
  await db().from("telegram_pending_actions").delete().lt("created_at", cutoff);
}