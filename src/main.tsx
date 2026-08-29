import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { initAnalytics } from "./lib/analytics";
import "./index.css";

// Só faz algo quando VITE_META_PIXEL_ID está definida no build. Sem ela — que é
// o caso de quem clona o repositório ou roda em Docker — nada é carregado.
initAnalytics();

createRoot(document.getElementById("root")!).render(<App />);
