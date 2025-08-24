import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { loadConfig } from './config.js';
import { httpRouter } from './api/http.js';
import { eventsBroadcaster } from './api/ws.js';

const config = loadConfig();
const app = express();

// Middleware
app.use(cors({ 
  origin: config.corsOrigins,
  credentials: true
}));
app.use(express.json());

// Routes
app.use('/api', httpRouter);

// Create HTTP server and initialize WebSocket
const server = createServer(app);
eventsBroadcaster.initialize(server);

// Start server
server.listen(config.port, () => {
  console.log(`🎰 Blackjack Backend running on port ${config.port}`);
  console.log(`📡 WebSocket events available at ws://localhost:${config.port}/events`);
  console.log(`🎯 CORS origins: ${config.corsOrigins.join(', ')}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down gracefully...');
  server.close(() => {
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('Shutting down gracefully...');
  server.close(() => {
    process.exit(0);
  });
});