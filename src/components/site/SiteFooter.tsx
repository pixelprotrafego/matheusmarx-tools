const SiteFooter = () => (
  <footer className="mt-16 border-t border-border/50">
    <div className="container max-w-5xl mx-auto px-4 py-6 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
      <span>© {new Date().getFullYear()} Matheus Marx</span>
      <a
        href="https://matheusmarx.com.br"
        target="_blank"
        rel="noreferrer"
        className="hover:text-primary transition-colors"
      >
        matheusmarx.com.br
      </a>
    </div>
  </footer>
);

export default SiteFooter;