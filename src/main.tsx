// src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";

// 1) App-komponenten (MÅSTE importeras)
import App from "./App";

// 2) Global CSS (håll den här ordningen: bas -> egna -> brand/override)
import "./index.css";   // Tailwind / bas
import "./App.css";     // dina generella overrides
import "./brand.css";   // tema/override - sist

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Kunde inte hitta <div id=\"root\"></div> i index.html");
}

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
