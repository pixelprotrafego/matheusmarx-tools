import { FFmpeg } from "@ffmpeg/ffmpeg";

let ffmpegInstance: FFmpeg | null = null;
let loadPromise: Promise<FFmpeg> | null = null;

const FFMPEG_PACKAGE_VERSION = "0.12.15";
const CORE_VERSION = "0.12.9";
const LOAD_TIMEOUT_MS = 90000;

type LoadStrategy = {
  name: string;
  config?: Parameters<FFmpeg["load"]>[0];
};

/** Raiz do site, respeitando um eventual `base` configurado no Vite. */
const BASE = import.meta.env.BASE_URL.endsWith("/")
  ? import.meta.env.BASE_URL
  : `${import.meta.env.BASE_URL}/`;

/**
 * Ordem de carregamento do motor de vídeo.
 *
 * O domínio próprio vem primeiro: o site promete que nada sai da máquina de
 * quem usa, e buscar o motor num CDN de terceiros entrega o IP do visitante e
 * impede o uso offline. Os arquivos são colocados em `public/ffmpeg/` por
 * `scripts/copy-ffmpeg-core.mjs`, que roda antes do `dev` e do `build`.
 *
 * Os CDNs continuam como rede de segurança para o caso de a cópia falhar num
 * deploy. Se preferir garantir que nunca haja requisição externa, basta apagar
 * as duas últimas estratégias — o site passa a falhar de forma explícita em vez
 * de recorrer a terceiros.
 */
const LOAD_STRATEGIES: LoadStrategy[] = [
  {
    name: "self-hosted",
    config: {
      classWorkerURL: `${BASE}ffmpeg/worker.js`,
      coreURL: `${BASE}ffmpeg/ffmpeg-core.js`,
      wasmURL: `${BASE}ffmpeg/ffmpeg-core.wasm`,
    },
  },
  {
    name: "bundled-worker-default",
  },
  // Atenção: nada de `workerURL` aqui. O @ffmpeg/core 0.12.9 de thread única
  // não publica `ffmpeg-core.worker.js`, então apontar para ele dava 404 e
  // derrubava estas duas estratégias antes mesmo de tentarem carregar.
  {
    name: "unpkg",
    config: {
      classWorkerURL: `https://unpkg.com/@ffmpeg/ffmpeg@${FFMPEG_PACKAGE_VERSION}/dist/esm/worker.js`,
      coreURL: `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/umd/ffmpeg-core.js`,
      wasmURL: `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/umd/ffmpeg-core.wasm`,
    },
  },
  {
    name: "jsdelivr",
    config: {
      classWorkerURL: `https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@${FFMPEG_PACKAGE_VERSION}/dist/esm/worker.js`,
      coreURL: `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/umd/ffmpeg-core.js`,
      wasmURL: `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/umd/ffmpeg-core.wasm`,
    },
  },
];

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout: ${label} (${ms}ms)`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

export type ProgressCallback = (progress: number) => void;

function attachProgressListener(ffmpeg: FFmpeg, onProgress?: ProgressCallback) {
  if (!onProgress) return;
  ffmpeg.on("progress", ({ progress: p }) => onProgress(Math.round(p * 100)));
}

export async function getFFmpeg(onProgress?: ProgressCallback): Promise<FFmpeg> {
  if (ffmpegInstance) {
    attachProgressListener(ffmpegInstance, onProgress);
    return ffmpegInstance;
  }

  if (loadPromise) {
    return loadPromise.then((instance) => {
      attachProgressListener(instance, onProgress);
      return instance;
    });
  }

  loadPromise = (async () => {
    let lastError: Error | null = null;

    for (const strategy of LOAD_STRATEGIES) {
      const ffmpeg = new FFmpeg();
      attachProgressListener(ffmpeg, onProgress);

      try {
        await withTimeout(ffmpeg.load(strategy.config), LOAD_TIMEOUT_MS, `FFmpeg load [${strategy.name}]`);
        ffmpegInstance = ffmpeg;
        loadPromise = null;
        return ffmpeg;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.warn(`FFmpeg load failed (${strategy.name}):`, lastError.message);
        try {
          ffmpeg.terminate();
        } catch {
          // no-op
        }
      }
    }

    loadPromise = null;
    throw new Error(
      `Não foi possível inicializar o motor de vídeo. Verifique sua conexão e tente novamente. (${lastError?.message ?? "erro desconhecido"})`
    );
  })();

  return loadPromise;
}

export function resetFFmpeg() {
  if (ffmpegInstance) {
    try {
      ffmpegInstance.terminate();
    } catch {
      // no-op
    }
  }
  ffmpegInstance = null;
  loadPromise = null;
}

