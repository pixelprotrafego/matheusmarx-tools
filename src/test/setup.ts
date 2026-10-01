import "@testing-library/jest-dom";

// Os testes do servidor (api/) rodam em ambiente node, sem `window`. Este
// arquivo vale para todos, então o que é de navegador fica condicionado.
if (typeof window !== "undefined") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => {},
    }),
  });
}
