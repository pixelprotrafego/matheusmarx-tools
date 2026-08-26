import { useLocation } from "react-router-dom";
import { useEffect } from "react";

const setMeta = (selector: string, attr: string, value: string) => {
  let el = document.head.querySelector<HTMLMetaElement>(selector);
  if (!el) {
    el = document.createElement("meta");
    const [, key, val] = selector.match(/\[(\w+)="([^"]+)"\]/) || [];
    if (key && val) el.setAttribute(key, val);
    document.head.appendChild(el);
  }
  el.setAttribute(attr, value);
};

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);

    const prevTitle = document.title;
    const prevDesc = document.head.querySelector<HTMLMetaElement>('meta[name="description"]')?.getAttribute("content") || "";
    const prevOgTitle = document.head.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.getAttribute("content") || "";
    const prevOgDesc = document.head.querySelector<HTMLMetaElement>('meta[property="og:description"]')?.getAttribute("content") || "";

    document.title = "404 — Página não encontrada | Matheus Marx Tools";
    setMeta('meta[name="description"]', "content", "A página solicitada não foi encontrada. Volte para a página inicial e explore as ferramentas de conversão de arquivos no navegador.");
    setMeta('meta[property="og:title"]', "content", "404 — Página não encontrada");
    setMeta('meta[property="og:description"]', "content", "A página solicitada não existe em Matheus Marx Tools.");

    return () => {
      document.title = prevTitle;
      setMeta('meta[name="description"]', "content", prevDesc);
      setMeta('meta[property="og:title"]', "content", prevOgTitle);
      setMeta('meta[property="og:description"]', "content", prevOgDesc);
    };
  }, [location.pathname]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted">
      <div className="text-center">
        <h1 className="mb-4 text-4xl font-bold">404</h1>
        <p className="mb-4 text-xl text-muted-foreground">Oops! Page not found</p>
        <a href="/" className="text-primary underline hover:text-primary/90">
          Return to Home
        </a>
      </div>
    </main>
  );
};

export default NotFound;
