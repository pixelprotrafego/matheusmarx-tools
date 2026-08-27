// ATENÇÃO: cópia espelhada de src/lib/unit-conversions.ts. O deploy das edge
// functions não alcança arquivos fora de supabase/functions, por isso a
// duplicação. Toda correção aqui precisa ser aplicada lá também, e vice-versa.
//
// Unit conversion factors (relative to a base unit per category).
// Temperature is handled separately because it's affine, not linear.

export type CategoryKey =
  | "distance" | "mass" | "temperature" | "speed" | "volume"
  | "area" | "time" | "data" | "angle" | "energy" | "pressure";

export interface UnitDef {
  id: string;
  label: string;
  factor: number; // value_in_base = input * factor
}

export interface Category {
  key: CategoryKey;
  label: string;
  base: string;
  units: UnitDef[];
}

export const CATEGORIES: Category[] = [
  {
    key: "distance", label: "Distância", base: "m",
    units: [
      { id: "mm", label: "Milímetro (mm)", factor: 0.001 },
      { id: "cm", label: "Centímetro (cm)", factor: 0.01 },
      { id: "m", label: "Metro (m)", factor: 1 },
      { id: "km", label: "Quilômetro (km)", factor: 1000 },
      { id: "in", label: "Polegada (in)", factor: 0.0254 },
      { id: "ft", label: "Pé (ft)", factor: 0.3048 },
      { id: "yd", label: "Jarda (yd)", factor: 0.9144 },
      { id: "mi", label: "Milha (mi)", factor: 1609.344 },
      { id: "nmi", label: "Milha náutica (nmi)", factor: 1852 },
    ],
  },
  {
    key: "mass", label: "Peso / Massa", base: "kg",
    units: [
      { id: "mg", label: "Miligrama (mg)", factor: 1e-6 },
      { id: "g", label: "Grama (g)", factor: 0.001 },
      { id: "kg", label: "Quilograma (kg)", factor: 1 },
      { id: "t", label: "Tonelada (t)", factor: 1000 },
      { id: "oz", label: "Onça (oz)", factor: 0.0283495231 },
      { id: "lb", label: "Libra (lb)", factor: 0.45359237 },
      { id: "st", label: "Stone (st)", factor: 6.35029318 },
    ],
  },
  {
    key: "temperature", label: "Temperatura", base: "C",
    units: [
      { id: "C", label: "Celsius (°C)", factor: 1 },
      { id: "F", label: "Fahrenheit (°F)", factor: 1 },
      { id: "K", label: "Kelvin (K)", factor: 1 },
    ],
  },
  {
    key: "speed", label: "Velocidade", base: "mps",
    units: [
      { id: "mps", label: "Metros/segundo (m/s)", factor: 1 },
      { id: "kmh", label: "Quilômetros/hora (km/h)", factor: 1 / 3.6 },
      { id: "mph", label: "Milhas/hora (mph)", factor: 0.44704 },
      { id: "kn", label: "Nós (kn)", factor: 0.514444 },
      { id: "fps", label: "Pés/segundo (ft/s)", factor: 0.3048 },
    ],
  },
  {
    key: "volume", label: "Volume", base: "l",
    units: [
      { id: "ml", label: "Mililitro (ml)", factor: 0.001 },
      { id: "l", label: "Litro (l)", factor: 1 },
      { id: "m3", label: "Metro cúbico (m³)", factor: 1000 },
      { id: "galus", label: "Galão US (gal)", factor: 3.78541 },
      { id: "galuk", label: "Galão UK (gal)", factor: 4.54609 },
      { id: "floz", label: "Onça fluida (fl oz)", factor: 0.0295735 },
      { id: "cup", label: "Xícara (cup)", factor: 0.24 },
    ],
  },
  {
    key: "area", label: "Área", base: "m2",
    units: [
      { id: "mm2", label: "Milímetro² (mm²)", factor: 1e-6 },
      { id: "cm2", label: "Centímetro² (cm²)", factor: 1e-4 },
      { id: "m2", label: "Metro² (m²)", factor: 1 },
      { id: "km2", label: "Quilômetro² (km²)", factor: 1e6 },
      { id: "ha", label: "Hectare (ha)", factor: 10000 },
      { id: "acre", label: "Acre", factor: 4046.8564224 },
      { id: "ft2", label: "Pé² (ft²)", factor: 0.09290304 },
      { id: "in2", label: "Polegada² (in²)", factor: 0.00064516 },
    ],
  },
  {
    key: "time", label: "Tempo", base: "s",
    units: [
      { id: "ms", label: "Milissegundo (ms)", factor: 0.001 },
      { id: "s", label: "Segundo (s)", factor: 1 },
      { id: "min", label: "Minuto (min)", factor: 60 },
      { id: "h", label: "Hora (h)", factor: 3600 },
      { id: "day", label: "Dia", factor: 86400 },
      { id: "week", label: "Semana", factor: 604800 },
      { id: "month", label: "Mês (30d)", factor: 2592000 },
      { id: "year", label: "Ano (365d)", factor: 31536000 },
    ],
  },
  {
    key: "data", label: "Dados", base: "B",
    units: [
      { id: "B", label: "Byte (B)", factor: 1 },
      { id: "KB", label: "Kilobyte (KB)", factor: 1e3 },
      { id: "MB", label: "Megabyte (MB)", factor: 1e6 },
      { id: "GB", label: "Gigabyte (GB)", factor: 1e9 },
      { id: "TB", label: "Terabyte (TB)", factor: 1e12 },
      { id: "PB", label: "Petabyte (PB)", factor: 1e15 },
      { id: "KiB", label: "Kibibyte (KiB)", factor: 1024 },
      { id: "MiB", label: "Mebibyte (MiB)", factor: 1024 ** 2 },
      { id: "GiB", label: "Gibibyte (GiB)", factor: 1024 ** 3 },
      { id: "TiB", label: "Tebibyte (TiB)", factor: 1024 ** 4 },
    ],
  },
  {
    key: "angle", label: "Ângulo", base: "rad",
    units: [
      { id: "deg", label: "Grau (°)", factor: Math.PI / 180 },
      { id: "rad", label: "Radiano (rad)", factor: 1 },
      { id: "grad", label: "Gradiano (grad)", factor: Math.PI / 200 },
      { id: "turn", label: "Volta (turn)", factor: 2 * Math.PI },
    ],
  },
  {
    key: "energy", label: "Energia", base: "J",
    units: [
      { id: "J", label: "Joule (J)", factor: 1 },
      { id: "kJ", label: "Quilojoule (kJ)", factor: 1000 },
      { id: "cal", label: "Caloria (cal)", factor: 4.184 },
      { id: "kcal", label: "Quilocaloria (kcal)", factor: 4184 },
      { id: "Wh", label: "Watt-hora (Wh)", factor: 3600 },
      { id: "kWh", label: "Quilowatt-hora (kWh)", factor: 3.6e6 },
      { id: "BTU", label: "BTU", factor: 1055.06 },
    ],
  },
  {
    key: "pressure", label: "Pressão", base: "Pa",
    units: [
      { id: "Pa", label: "Pascal (Pa)", factor: 1 },
      { id: "kPa", label: "Quilopascal (kPa)", factor: 1000 },
      { id: "bar", label: "Bar", factor: 1e5 },
      { id: "atm", label: "Atmosfera (atm)", factor: 101325 },
      { id: "psi", label: "PSI", factor: 6894.757293168 },
      { id: "mmHg", label: "mmHg", factor: 133.322387415 },
    ],
  },
];

const tempToC = (v: number, from: string): number => {
  if (from === "C") return v;
  if (from === "F") return (v - 32) * (5 / 9);
  if (from === "K") return v - 273.15;
  return v;
};
const tempFromC = (c: number, to: string): number => {
  if (to === "C") return c;
  if (to === "F") return c * (9 / 5) + 32;
  if (to === "K") return c + 273.15;
  return c;
};

export function convert(value: number, category: Category, fromId: string, toId: string): number {
  if (category.key === "temperature") return tempFromC(tempToC(value, fromId), toId);
  const from = category.units.find((u) => u.id === fromId);
  const to = category.units.find((u) => u.id === toId);
  if (!from || !to) return NaN;
  const base = value * from.factor;
  return base / to.factor;
}

export function formatConverted(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "0";
  const abs = Math.abs(n);
  if (abs >= 1e12 || abs < 1e-6) return n.toExponential(6);
  return parseFloat(n.toPrecision(10)).toString();
}