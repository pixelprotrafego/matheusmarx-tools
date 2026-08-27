import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export interface SubTool {
  key: string;
  icon: LucideIcon;
  title: string;
  description: string;
  isNew?: boolean;
  render: () => JSX.Element;
}

const SubToolPanel = ({ tools }: { tools: SubTool[] }) => {
  const [active, setActive] = useState<string | null>(null);
  const current = tools.find((t) => t.key === active);

  if (current) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => setActive(null)} className="gap-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> Voltar
        </Button>
        <div className="flex items-center gap-2 mb-4">
          <div className="line-gold flex-1" />
          <span className="text-sm text-muted-foreground font-medium">{current.title}</span>
          <div className="line-gold flex-1" />
        </div>
        {current.render()}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {tools.map((t) => {
        const Icon = t.icon;
        return (
          <Card
            key={t.key}
            className="group cursor-pointer border-border bg-secondary/20 hover:border-primary/40 hover:bg-secondary/40 transition-all"
            onClick={() => setActive(t.key)}
          >
            <CardContent className="p-6 flex items-start gap-4">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/20 transition-colors">
                <Icon className="w-5 h-5 text-primary" />
              </div>
              <div className="min-w-0">
                {/* div, e não p: o Badge renderiza um div, que é HTML inválido dentro de <p>. */}
                <div className="font-heading font-medium text-foreground flex items-center gap-2">
                  {t.title}
                  {t.isNew && <Badge variant="secondary" className="text-xs px-1.5 py-0">Novo</Badge>}
                </div>
                <p className="text-sm text-muted-foreground">{t.description}</p>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
};

export default SubToolPanel;