import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Tools from "./pages/Tools";
import NotFound from "./pages/NotFound";
import DomainGuard from "./components/DomainGuard";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <DomainGuard>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Tools />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </DomainGuard>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
