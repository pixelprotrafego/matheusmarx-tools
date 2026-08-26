import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeftRight } from "lucide-react";
import { CATEGORIES, convert, formatConverted, type Category } from "@/lib/unit-conversions";
import { cn } from "@/lib/utils";

const UnitConverter = () => {
  const [catKey, setCatKey] = useState<string>(CATEGORIES[0].key);
  const category = useMemo<Category>(
    () => CATEGORIES.find((c) => c.key === catKey)!,
    [catKey],
  );
  const [from, setFrom] = useState(category.units[0].id);
  const [to, setTo] = useState(category.units[1]?.id ?? category.units[0].id);
  const [value, setValue] = useState("1");

  useEffect(() => {
    setFrom(category.units[0].id);
    setTo(category.units[1]?.id ?? category.units[0].id);
  }, [category]);

  const num = parseFloat(value.replace(",", "."));
  const out = useMemo(() => {
    if (!Number.isFinite(num)) return "—";
    return formatConverted(convert(num, category, from, to));
  }, [num, category, from, to]);

  const swap = () => {
    setFrom(to);
    setTo(from);
  };

  return (
    <div className="space-y-6">
      {/* Category chips */}
      <div className="flex flex-wrap gap-2">
        {CATEGORIES.map((c) => (
          <button
            key={c.key}
            onClick={() => setCatKey(c.key)}
            className={cn(
              "px-3 py-1.5 rounded-full text-sm font-medium transition-all",
              catKey === c.key
                ? "bg-primary text-primary-foreground glow-gold"
                : "bg-secondary text-muted-foreground hover:text-foreground hover:bg-secondary/80",
            )}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Converter */}
      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-4 items-end">
        {/* From */}
        <div className="space-y-2">
          <label className="text-xs uppercase tracking-wider text-muted-foreground font-medium">De</label>
          <Input
            type="text"
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="h-14 text-2xl font-heading text-right"
          />
          <Select value={from} onValueChange={setFrom}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {category.units.map((u) => (
                <SelectItem key={u.id} value={u.id}>{u.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Swap */}
        <div className="flex justify-center md:pb-12">
          <Button
            variant="outline"
            size="icon"
            onClick={swap}
            className="rounded-full h-12 w-12 border-primary/40 hover:bg-primary/10 hover:text-primary"
            aria-label="Inverter unidades"
          >
            <ArrowLeftRight className="w-5 h-5" />
          </Button>
        </div>

        {/* To */}
        <div className="space-y-2">
          <label className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Para</label>
          <div className="h-14 px-3 rounded-md border border-input bg-secondary/30 flex items-center justify-end text-2xl font-heading text-gradient-gold break-all overflow-hidden">
            {out}
          </div>
          <Select value={to} onValueChange={setTo}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {category.units.map((u) => (
                <SelectItem key={u.id} value={u.id}>{u.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Quick examples row */}
      <div className="rounded-lg border border-border bg-secondary/20 p-4 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{category.label}: </span>
        {Number.isFinite(num) ? (
          <span>
            {num} {category.units.find((u) => u.id === from)?.label.replace(/\s*\(.+\)$/, "")} ={" "}
            <span className="text-primary font-medium">{out}</span>{" "}
            {category.units.find((u) => u.id === to)?.label.replace(/\s*\(.+\)$/, "")}
          </span>
        ) : (
          <span>Digite um número válido.</span>
        )}
      </div>
    </div>
  );
};

export default UnitConverter;