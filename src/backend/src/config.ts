// Configuration from environment variables (Aspire will set these)
export interface Config {
  port: number;
  corsOrigins: string[];
  agents: {
    pat: { url: string; timeouts: { talk: number; decide: number } };
    dee: { url: string; timeouts: { talk: number; decide: number } };
    tom: { url: string; timeouts: { talk: number; decide: number } };
  };
}

export function loadConfig(): Config {
  const port = parseInt(process.env.PORT || '3001');
  const corsOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173').split(',');
  
  return {
    port,
    corsOrigins,
    agents: {
      pat: {
        url: process.env.PAT_PYTHON_URL || 'http://localhost:3002',
        timeouts: { talk: 3000, decide: 5000 }
      },
      dee: {
        url: process.env.DEE_DOTNET_URL || 'http://localhost:3003',
        timeouts: { talk: 3000, decide: 5000 }
      },
      tom: {
        url: process.env.TOM_TYPESCRIPT_URL || 'http://localhost:3004',
        timeouts: { talk: 3000, decide: 5000 }
      }
    }
  };
}