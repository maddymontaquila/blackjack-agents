import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { tableState } from './http.js';

interface WebSocketMessage {
  type: 'deal' | 'chat' | 'action' | 'dealer' | 'settle' | 'error' | 'state' | 'player-typing' | 'chat-stream' | 'chat-message';
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
        console.error('Stack trace:', error instanceof Error ? error.stack : 'No stack trace available');
      });
    });
  }

  private sendToClient(ws: WebSocket, message: WebSocketMessage) {
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
      }
    } catch (error) {
      console.error('Error sending WebSocket message:', error, 'Message:', message);
      console.error('Stack trace:', error instanceof Error ? error.stack : 'No stack trace available');
    }
  }

  broadcast(message: WebSocketMessage) {
    if (!this.wss) return;
    
    try {
      this.wss.clients.forEach((client) => {
        this.sendToClient(client, message);
      });
    } catch (error) {
      console.error('Error broadcasting WebSocket message:', error, 'Message:', message);
      console.error('Stack trace:', error instanceof Error ? error.stack : 'No stack trace available');
    }
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

  // Streaming chat methods
  broadcastPlayerTyping(player: string, isTyping: boolean = true) {
    this.broadcast({ type: 'player-typing', player, isTyping });
  }

  broadcastChatStream(player: string, content: string) {
    this.broadcast({ type: 'chat-stream', player, content });
  }

  broadcastChatMessage(player: string, message: string) {
    this.broadcast({ type: 'chat-message', player, message });
  }
}

export const eventsBroadcaster = new EventsBroadcaster();