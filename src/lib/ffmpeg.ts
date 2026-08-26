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

const LOAD_STRATEGIES: LoadStrategy[] = [
  {
    name: "bundled-worker-default",
  },
  {
    name: "unpkg-explicit-worker",
    config: {
      classWorkerURL: `https://unpkg.com/@ffmpeg/ffmpeg@${FFMPEG_PACKAGE_VERSION}/dist/esm/worker.js`,
      coreURL: `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/umd/ffmpeg-core.js`,
      wasmURL: `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/umd/ffmpeg-core.wasm`,
      workerURL: `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/umd/ffmpeg-core.worker.js`,
    },
  },
  {
    name: "jsdelivr-explicit-worker",
    config: {
      classWorkerURL: `https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@${FFMPEG_PACKAGE_VERSION}/dist/esm/worker.js`,
      coreURL: `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/umd/ffmpeg-core.js`,
      wasmURL: `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/umd/ffmpeg-core.wasm`,
      workerURL: `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/umd/ffmpeg-core.worker.js`,
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

