import React, { useEffect } from "react";
import { useRoutes } from "react-router-dom";
import { routes } from "./routes";
import { ensureSeeded } from "./services/seed";

export default function App() {
  useEffect(() => {
    ensureSeeded();
  }, []);

  const element = useRoutes(routes);
  return element;
}
