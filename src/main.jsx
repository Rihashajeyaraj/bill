import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import ProvidersTree from "./context/AppProviders";
import "./index.css";
import "./styles/themes.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter future={{ v7_relativeSplatPath: true }}>
      <ProvidersTree>
        <App />
      </ProvidersTree>
    </BrowserRouter>
  </React.StrictMode>
);
