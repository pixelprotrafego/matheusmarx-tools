import { useEffect, useState, type ReactNode } from "react";

// Domínios permitidos. Qualquer outro hostname mostra tela de bloqueio.
// Impede que terceiros clonem o front e usem em domínio próprio.
const ALLOWED = [
  "tools.matheusmarx.com.br",
  "matheusmarxtools.lovable.app",
  "lovable.dev",
  "localhost",
  "127.0.0.1",
];

function isAllowed(host: string): boolean {
  if (ALLOWED.includes(host)) return true;
  // Subdomínios de preview da Lovable (ex: id-preview--*.lovable.app)
  if (host.endsWith(".lovable.app")) return true;
  // Editor e sandbox da Lovable (lovable.dev, *.sandbox.lovable.dev, etc.)
  if (host.endsWith(".lovable.dev")) return true;
  return false;
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