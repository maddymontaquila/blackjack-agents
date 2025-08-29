import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { tableState } from './http.js';

interface WebSocketMessage {
  type: 'deal' | 'chat' | 'action' | 'dealer' | 'settle' | 'error' | 'state' | 'player-typing' | 'chat-stream' | 'chat-message' | 'debug';
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
        // Add timestamp to all messages for debugging
        const timestampedMessage = {
          ...message,
          timestamp: Date.now(),
          _id: Math.random().toString(36).substring(7) // Short random ID for tracking
        };
        ws.send(JSON.stringify(timestampedMessage));
      }
    } catch (error) {
      console.error('Error sending WebSocket message:', error, 'Message type:', message.type);
      console.error('Stack trace:', error instanceof Error ? error.stack : 'No stack trace available');
      // Broadcast error to help with debugging
      this.broadcastError(`WebSocket send failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  broadcast(message: WebSocketMessage) {
    if (!this.wss) {
      console.warn('WebSocketServer not initialized - cannot broadcast message:', message.type);
      return;
    }
    
    try {
      const connectedClients = Array.from(this.wss.clients).filter(client => client.readyState === WebSocket.OPEN);
      console.log(`Broadcasting ${message.type} to ${connectedClients.length} connected clients`);
      
      if (message.type === 'state') {
        // Special logging for state messages to debug button issue
        const state = (message as any).state;
        console.log(`  State broadcast details:`);
        console.log(`    - phase: ${state?.status}`);
        console.log(`    - agentBettingInitiated: ${state?.debug?.agentBettingInitiated}`);
      }
      
      connectedClients.forEach((client) => {
        this.sendToClient(client, message);
      });
      
      if (connectedClients.length === 0) {
        console.warn('No connected WebSocket clients to receive broadcast:', message.type);
      }
    } catch (error) {
      console.error('Error broadcasting WebSocket message:', error, 'Message type:', message.type);
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
    const state = tableState.getState();
    console.log(`Broadcasting state update: phase=${state.status}`);
    console.log(`  - agentBettingInitiated: ${state.debug?.agentBettingInitiated}`);
    console.log(`  - bettingCompletion: ${JSON.stringify(state.debug?.bettingCompletion)}`);
    console.log(`  - phaseStatus: ${state.debug?.phaseStatus}`);
    
    this.broadcast({ type: 'state', state });
    
    // Log the actual message being sent (first 500 chars)
    const message = JSON.stringify({ type: 'state', state });
    console.log(`  - Message preview: ${message.substring(0, 500)}...`);
  }

  // Streaming chat methods
  broadcastPlayerTyping(player: string, isTyping: boolean = true) {
    this.broadcast({ type: 'player-typing', player, isTyping });
  }

  broadcastChatStream(player: string, content: string) {
    this.broadcast({ type: 'chat-stream', player, content });
  }

  broadcastChatMessage(player: string, message: string) {
    console.log(`Broadcasting chat message from ${player}: ${message.substring(0, 50)}${message.length > 50 ? '...' : ''}`);
    this.broadcast({ type: 'chat-message', player, message });
  }

  // Enhanced debug broadcasting methods
  broadcastDebug(debugInfo: any) {
    this.broadcast({ type: 'debug', debug: debugInfo });
  }

  // Periodic debug broadcast (call this regularly to keep UI updated)
  broadcastPeriodicDebug() {
    const state = tableState.getState();
    if (state.debug) {
      this.broadcastDebug({
        phase: state.status,
        phaseStatus: state.debug.phaseStatus,
        pendingOperations: state.debug.pendingOperations,
        agentHealth: state.debug.agentHealthStatus,
        streamingStatus: state.debug.streamingStatus,
        lastError: state.debug.lastError,
        timestamp: Date.now()
      });
    }
  }

  // Enhanced error broadcasting with context
  broadcastErrorWithContext(message: string, context?: { phase?: string; seat?: number; operation?: string }) {
    const errorData = {
      type: 'error' as const,
      message,
      context,
      timestamp: Date.now(),
      gamePhase: tableState.getState().status
    };
    
    console.error('Broadcasting error with context:', errorData);
    this.broadcast(errorData);
  }

  // Connection status for debugging
  getConnectionStatus() {
    if (!this.wss) return { connected: 0, total: 0 };
    
    const total = this.wss.clients.size;
    const connected = Array.from(this.wss.clients).filter(client => client.readyState === WebSocket.OPEN).length;
    
    return { connected, total };
  }
}

export const eventsBroadcaster = new EventsBroadcaster();

// Auto-broadcast periodic debug info every 2 seconds for development
if (process.env.NODE_ENV !== 'production') {
  setInterval(() => {
    try {
      eventsBroadcaster.broadcastPeriodicDebug();
    } catch (error) {
      console.error('Error in periodic debug broadcast:', error);
    }
  }, 2000);
}