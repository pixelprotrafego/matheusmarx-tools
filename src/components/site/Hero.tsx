import { ShieldCheck, Cpu, Infinity as InfinityIcon } from "lucide-react";

const pills = [
  { icon: ShieldCheck, label: "100% privado" },
  { icon: Cpu, label: "Sem instalação" },
  { icon: InfinityIcon, label: "Grátis e sem limites" },
];

const Hero = () => (
  <section className="relative text-center pt-12 md:pt-16 pb-10 md:pb-12 animate-fade-in">
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 -top-10 mx-auto h-64 max-w-2xl rounded-full opacity-30 blur-3xl"
      style={{ background: "radial-gradient(closest-side, hsl(var(--gold) / 0.35), transparent)" }}
    />
    <div className="relative">
      <span className="inline-block text-[11px] md:text-xs tracking-[0.2em] uppercase text-primary/90 font-medium mb-4">
        Hub de ferramentas no navegador
      </span>
      <h1 className="text-3xl md:text-5xl font-heading font-bold leading-[1.1] tracking-tight max-w-3xl mx-auto">
        Ferramentas úteis do dia a dia,
        <br className="hidden md:block" />{" "}
        <span className="text-gradient-gold">grátis e com privacidade total</span>
      </h1>
      <p className="mt-4 text-sm md:text-base text-muted-foreground max-w-xl mx-auto">
        PDF, mídia, imagem, áudio, voz, QR Code, senhas, notepad, calculadora e mais — tudo processado no seu navegador.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {pills.map(({ icon: Icon, label }) => (
          <div
            key={label}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground border border-border/60 bg-card/50 rounded-full px-3 py-1"
          >
            <Icon className="w-3 h-3 text-primary" />
            {label}
          </div>
        ))}
      </div>
      <div className="mt-8 mx-auto line-gold max-w-xs" />
    </div>
  </section>
);

export default Hero;