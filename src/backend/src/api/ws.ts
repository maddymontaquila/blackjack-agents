import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { tableState } from './http.js';

interface WebSocketMessage {
  type: 'deal' | 'chat' | 'action' | 'dealer' | 'settle' | 'error' | 'state';
  [key: string]: any;
}

class EventsBroadcaster {
  private wss: WebSocketServer | null = null;

  initialize(server: Server) {
    this.wss = new WebSocketServer({ 
      server, 
      path: '/events'
    });

    this.wss.on('connection', (ws: WebSocket) => {
      console.log('Client connected to events WebSocket');
      
      // Send current state on connection
      this.sendToClient(ws, {
        type: 'state',
        state: tableState.getState()
      });

      ws.on('close', () => {
        console.log('Client disconnected from events WebSocket');
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
      });
    });
  }

  private sendToClient(ws: WebSocket, message: WebSocketMessage) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  broadcast(message: WebSocketMessage) {
    if (!this.wss) return;
    
    this.wss.clients.forEach((client) => {
      this.sendToClient(client, message);
    });
  }

  // Convenience methods for different event types
  broadcastDeal(snap: any) {
    this.broadcast({ type: 'deal', snap });
  }

  broadcastChat(msg: any) {
    this.broadcast({ type: 'chat', msg });
  }

  broadcastAction(seat: number, decision: any, handState: any) {
    this.broadcast({ type: 'action', seat, decision, handState });
  }

  broadcastDealer(action: string, card?: number) {
    this.broadcast({ type: 'dealer', action, card });
  }

  broadcastSettle(results: any[]) {
    this.broadcast({ type: 'settle', results });
  }

  broadcastError(message: string) {
    this.broadcast({ type: 'error', message });
  }

  broadcastState() {
    this.broadcast({ type: 'state', state: tableState.getState() });
  }
}

export const eventsBroadcaster = new EventsBroadcaster();