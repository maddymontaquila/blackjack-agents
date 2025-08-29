// Backend API client for frontend
export interface BackendState {
  snap: {
    handNumber: number;
    shoePenetration: number;
    runningCount?: number;
    players: Array<{
      id: string;
      seat: number;
      visibleCards: number[];
      lastAction?: 'hit' | 'stand' | 'double' | 'split';
      bet?: number;
      balance?: number;
    }>;
    dealerUpcard: number;
    chat: Array<{ from: string; text: string }>;
  };
  status: string;
  seats: Array<{ id: string; seat: number; isActive: boolean }>;
  config: { maxPlayers: number };
  dealer: {
    cards: number[];
    visibleCards: number[];
    isStanding: boolean;
    isBusted: boolean;
  };
  currentPlayerIndex: number;
  debug?: {
    agentBettingInitiated?: boolean;
    phaseStatus?: string;
    pendingOperations?: string[];
    agentHealthStatus?: any;
    streamingStatus?: any;
    lastError?: string;
  };
}

export interface ActionResult {
  success: boolean;
  state: BackendState;
}

export interface DealerResult {
  results: Array<{ seat: number; result: 'win' | 'lose' | 'push'; payout: number }>;
  state: BackendState;
}

class BackendClient {
  private baseUrl: string;
  private ws: WebSocket | null = null;
  private eventListeners: Map<string, Set<(data: any) => void>> = new Map();

  constructor(baseUrl: string = 'http://localhost:3001') {
    this.baseUrl = baseUrl;
  }

  // HTTP API methods
  async getState(): Promise<BackendState> {
    const response = await fetch(`${this.baseUrl}/api/state`);
    if (!response.ok) {
      throw new Error(`Failed to get state: ${response.statusText}`);
    }
    return response.json();
  }

  async startNextHand(): Promise<{ startedHand: number }> {
    const response = await fetch(`${this.baseUrl}/api/next`, {
      method: 'POST',
    });
    if (!response.ok) {
      throw new Error(`Failed to start next hand: ${response.statusText}`);
    }
    return response.json();
  }

  async placeBet(seat: number, amount: number): Promise<ActionResult> {
    const response = await fetch(`${this.baseUrl}/api/bet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seat, amount }),
    });
    if (!response.ok) {
      throw new Error(`Failed to place bet: ${response.statusText}`);
    }
    return response.json();
  }

  async placeAgentBets(): Promise<ActionResult> {
    const response = await fetch(`${this.baseUrl}/api/agent-bets`, {
      method: 'POST',
    });
    if (!response.ok) {
      throw new Error(`Failed to place agent bets: ${response.statusText}`);
    }
    return response.json();
  }

  async startDealing(): Promise<{ ok: boolean; state: BackendState }> {
    const response = await fetch(`${this.baseUrl}/api/start-dealing`, {
      method: 'POST',
    });
    if (!response.ok) {
      throw new Error(`Failed to start dealing: ${response.statusText}`);
    }
    return response.json();
  }

  async startDecisions(): Promise<{ ok: boolean }> {
    const response = await fetch(`${this.baseUrl}/api/start-decisions`, {
      method: 'POST',
    });
    if (!response.ok) {
      throw new Error(`Failed to start decisions: ${response.statusText}`);
    }
    return response.json();
  }

  async playerAction(seat: number, action: 'hit' | 'stand' | 'double' | 'split'): Promise<ActionResult> {
    const response = await fetch(`${this.baseUrl}/api/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seat, action }),
    });
    if (!response.ok) {
      throw new Error(`Failed to perform action: ${response.statusText}`);
    }
    return response.json();
  }

  async dealerPlay(): Promise<DealerResult> {
    const response = await fetch(`${this.baseUrl}/api/dealer-play`, {
      method: 'POST',
    });
    if (!response.ok) {
      throw new Error(`Failed to play dealer hand: ${response.statusText}`);
    }
    return response.json();
  }

  async resetEntireGame(): Promise<{ success: boolean; message: string; state: BackendState }> {
    const response = await fetch(`${this.baseUrl}/api/reset`, {
      method: 'POST',
    });
    if (!response.ok) {
      throw new Error(`Failed to reset game: ${response.statusText}`);
    }
    return response.json();
  }

  // WebSocket event handling
  connectWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = this.baseUrl.replace('http', 'ws') + '/events';
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('Connected to backend WebSocket');
        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          this.handleWebSocketMessage(message);
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      };

      this.ws.onclose = () => {
        console.log('Disconnected from backend WebSocket');
        this.ws = null;
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        reject(error);
      };
    });
  }

  private handleWebSocketMessage(message: any) {
    const { type, ...data } = message;
    const listeners = this.eventListeners.get(type);
    if (listeners) {
      listeners.forEach(listener => listener(data));
    }
  }

  addEventListener(type: string, listener: (data: any) => void) {
    if (!this.eventListeners.has(type)) {
      this.eventListeners.set(type, new Set());
    }
    this.eventListeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: (data: any) => void) {
    const listeners = this.eventListeners.get(type);
    if (listeners) {
      listeners.delete(listener);
    }
  }

  disconnectWebSocket() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

export const backendClient = new BackendClient();