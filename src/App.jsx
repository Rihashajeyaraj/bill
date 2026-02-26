import React, { useEffect, useState } from "react";
import { useRoutes } from "react-router-dom";
import { routes } from "./routes";
import { ensureSeeded } from "./services/seed";
import { authBootstrapSession } from "./services/auth.service";
import { companyLoadMyOrganization } from "./services/company.service";

export default function App() {
  const [ready, setReady] = useState(false);
  const element = useRoutes(routes);

  useEffect(() => {
    let mounted = true;
    async function bootstrap() {
      ensureSeeded();
      try {
        const hasSession = await authBootstrapSession();
        if (hasSession) {
          await companyLoadMyOrganization();
        }
      } finally {
        if (mounted) setReady(true);
      }
    }
    bootstrap();
    return () => {
      mounted = false;
    };
  }, []);

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm app-muted-text">
        Loading...
      </div>
    );
  }

  return element;
}
