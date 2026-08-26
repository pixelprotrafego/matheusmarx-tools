import * as pdfjsLib from "pdfjs-dist";
// Worker bundled localmente (sem CDN) — versão sincronizada com pdfjs-dist.
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export { pdfjsLib };
export default pdfjsLib;