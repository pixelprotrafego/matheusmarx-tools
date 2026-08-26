import { Lock } from "lucide-react";

const SiteHeader = () => (
  <header className="border-b border-border/50 backdrop-blur-sm bg-background/70">
    <div className="container max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
      <a href="/" className="font-heading font-semibold tracking-tight text-base md:text-lg">
        Matheus Marx <span className="text-gradient-gold">Tools</span>
      </a>
      <div className="flex items-center gap-1.5 text-[11px] md:text-xs text-muted-foreground border border-border/60 rounded-full px-2.5 py-1">
        <Lock className="w-3 h-3 text-primary" />
        <span>100% no navegador · sem upload</span>
      </div>
    </div>
  </header>
);

export default SiteHeader;