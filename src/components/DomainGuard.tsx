import { useEffect, useState, type ReactNode } from "react";

// Trava de domínio: impede que terceiros clonem o front e sirvam em domínio próprio.
//
// DESLIGADA por padrão. Para religar, defina VITE_ALLOWED_HOSTS com a lista de
// hostnames permitidos (separados por vírgula) no ambiente de build:
//
//   VITE_ALLOWED_HOSTS=tools.matheusmarx.com.br
//
// Hosts de desenvolvimento (localhost / 127.0.0.1) são sempre liberados, para a
// trava não atrapalhar o `npm run dev`. Sem a variável, a aplicação roda em
// qualquer domínio — que é o comportamento desejado durante o deploy de preview.
const ALLOWED = (import.meta.env.VITE_ALLOWED_HOSTS ?? "")
  .split(",")
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

const DEV_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

function isAllowed(host: string): boolean {
  // Lista vazia = trava desligada.
  if (ALLOWED.length === 0) return true;
  const h = host.toLowerCase();
  if (DEV_HOSTS.includes(h)) return true;
  // Entrada iniciada por "." libera o domínio e todos os seus subdomínios.
  return ALLOWED.some((allowed) =>
    allowed.startsWith(".") ? h === allowed.slice(1) || h.endsWith(allowed) : h === allowed,
  );
}

const DomainGuard = ({ children }: { children: ReactNode }) => {
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    setAllowed(isAllowed(window.location.hostname));
  }, []);

  if (allowed === null) return null;
  if (allowed) return <>{children}</>;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="max-w-md text-center space-y-4">
        <h1 className="text-2xl font-heading text-foreground">Domínio não autorizado</h1>
        <p className="text-muted-foreground">
          Esta aplicação só roda nos domínios oficiais.
        </p>
        <a
          href="https://tools.matheusmarx.com.br"
          className="inline-block px-4 py-2 rounded-md bg-primary text-primary-foreground font-medium"
        >
          Ir para o site oficial
        </a>
      </div>
    </div>
  );
};

export default DomainGuard;
