import { Redis } from "@upstash/redis";

/**
 * Armazenamento chave-valor com prazo de validade.
 *
 * Tudo o que o servidor guarda é descartável e expira em minutos: contadores
 * do limite por IP e o estado curto do bot do Telegram ("você mandou um
 * arquivo, o que faço com ele?"). Um banco relacional era desproporcional para
 * isso; um Redis com TTL faz o trabalho e apaga sozinho o que venceu.
 */
export interface Store {
  /** Incrementa e devolve o novo valor. Uma chave nova nasce com `ttlSeconds`. */
  incr(key: string, ttlSeconds: number): Promise<number>;
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  get<T>(key: string): Promise<T | null>;
  del(key: string): Promise<void>;
  /** Grava só se a chave não existir. Devolve `true` para quem chegou primeiro. */
  claim(key: string, ttlSeconds: number): Promise<boolean>;
}

/** Upstash Redis, falando por HTTP — funciona em ambiente serverless sem conexão persistente. */
class UpstashStore implements Store {
  constructor(private readonly redis: Redis) {}

  async incr(key: string, ttlSeconds: number): Promise<number> {
    const valor = await this.redis.incr(key);
    if (valor === 1) await this.redis.expire(key, ttlSeconds);
    return valor;
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    await this.redis.set(key, value, { ex: ttlSeconds });
  }

  async get<T>(key: string): Promise<T | null> {
    return (await this.redis.get<T>(key)) ?? null;
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async claim(key: string, ttlSeconds: number): Promise<boolean> {
    return (await this.redis.set(key, 1, { nx: true, ex: ttlSeconds })) === "OK";
  }
}

/**
 * Armazenamento em memória, para desenvolvimento local e para testes.
 *
 * Em produção ele **não** substitui o Redis: cada instância de função tem a
 * própria memória, então o limite por IP vira por instância e o bot esquece o
 * arquivo entre um clique e outro se a próxima requisição cair noutra
 * instância.
 */
export class MemoryStore implements Store {
  private readonly dados = new Map<string, { valor: unknown; expiraEm: number }>();

  constructor(private readonly agora: () => number = Date.now) {}

  private vivo(key: string) {
    const item = this.dados.get(key);
    if (!item) return undefined;
    if (item.expiraEm <= this.agora()) {
      this.dados.delete(key);
      return undefined;
    }
    return item;
  }

  async incr(key: string, ttlSeconds: number): Promise<number> {
    const item = this.vivo(key);
    if (item) {
      item.valor = (item.valor as number) + 1;
      return item.valor as number;
    }
    this.dados.set(key, { valor: 1, expiraEm: this.agora() + ttlSeconds * 1000 });
    return 1;
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    // Clonado pelo mesmo caminho do Redis, para os testes não passarem por
    // acaso graças a uma referência compartilhada.
    this.dados.set(key, {
      valor: JSON.parse(JSON.stringify(value)),
      expiraEm: this.agora() + ttlSeconds * 1000,
    });
  }

  async get<T>(key: string): Promise<T | null> {
    return (this.vivo(key)?.valor as T | undefined) ?? null;
  }

  async del(key: string): Promise<void> {
    this.dados.delete(key);
  }

  async claim(key: string, ttlSeconds: number): Promise<boolean> {
    if (this.vivo(key)) return false;
    await this.set(key, 1, ttlSeconds);
    return true;
  }
}

/**
 * Credenciais do Redis.
 *
 * Aceita os dois nomes em uso: `UPSTASH_REDIS_REST_*`, de quem cria o banco
 * direto no Upstash, e `KV_REST_API_*`, que é o que a integração do
 * marketplace da Vercel injeta no projeto.
 */
function credenciais(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  return url && token ? { url, token } : null;
}

let instancia: Store | null = null;

/** O armazenamento da execução atual: Redis se configurado, memória se não. */
export function getStore(): Store {
  if (instancia) return instancia;
  const c = credenciais();
  if (c) {
    instancia = new UpstashStore(new Redis({ url: c.url, token: c.token }));
  } else {
    console.warn(
      "[store] Redis não configurado — usando memória. Serve para desenvolvimento; " +
        "em produção o limite por IP e o estado do bot do Telegram ficam por instância.",
    );
    instancia = new MemoryStore();
  }
  return instancia;
}

/** Troca o armazenamento — só para testes. */
export function setStoreForTests(store: Store | null): void {
  instancia = store;
}
