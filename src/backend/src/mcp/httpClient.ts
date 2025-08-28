import type { TAgentIO, TTalkOut, TDecisionOut, TBetOut } from '@shared/schemas';
import { TalkOut, DecisionOut, BetOut } from '@shared/schemas';
import { eventsBroadcaster } from '../api/ws.js';

export class AgentClient {
  constructor(
    private baseUrl: string, 
    private timeouts: { talk: number; decide: number; bet: number },
    private playerName?: string
  ) {}

  private async agentCall<T>(
    endpoint: string,
    body: unknown,
    timeoutMs: number,
    schema: { parse: (data: any) => T }
  ): Promise<T> {
    const fullUrl = `${this.baseUrl}${endpoint}`;
    console.log(`AgentClient: Making request to ${fullUrl} with timeout ${timeoutMs}ms`);
    console.log(`AgentClient: Request body:`, JSON.stringify(body, null, 2));
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    
    try {
      const response = await fetch(fullUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      
      console.log(`AgentClient: Response status: ${response.status} ${response.statusText}`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const responseData = await response.json();
      console.log(`AgentClient: Response data:`, JSON.stringify(responseData, null, 2));
      return schema.parse(responseData);
    } catch (error) {
      console.error(`AgentClient error for ${endpoint}:`, error);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Request timeout after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  // Streaming version that emits rationale character by character
  private async streamingAgentCall<T>(
    endpoint: string,
    body: unknown,
    timeoutMs: number,
    schema: { parse: (data: any) => T },
    playerName: string
  ): Promise<T> {
    // Start typing indicator
    eventsBroadcaster.broadcastPlayerTyping(playerName, true);
    
    // Show "thinking..." message while waiting for response
    const thinkingMessage = `💭 ${playerName} is thinking...`;
    eventsBroadcaster.broadcastChatStream(playerName, thinkingMessage);
    
    try {
      const result = await this.agentCall(endpoint, body, timeoutMs, schema);
      
      // Small delay to ensure "thinking..." is visible, then stream the actual response
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Stream the rationale if available (don't await - let it run in background)
      const rationale = (result as any).rationale || (result as any).say;
      if (rationale && typeof rationale === 'string') {
        // Run streaming in background, don't block the main response
        this.streamText(playerName, rationale).catch(error => {
          console.error(`Background streaming failed for ${playerName}:`, error);
        });
      }
      
      return result;
    } catch (error) {
      console.error(`Streaming agent call failed for ${playerName} at ${endpoint}:`, error);
      throw error;
    } finally {
      // Stop typing indicator
      eventsBroadcaster.broadcastPlayerTyping(playerName, false);
    }
  }

  private async streamText(playerName: string, text: string): Promise<void> {
    try {
      // Faster streaming - by words instead of characters, with shorter delays
      const words = text.split(' ');
      let accumulated = '';
      
      for (let i = 0; i < words.length; i++) {
        const word = words[i];
        accumulated += (i > 0 ? ' ' : '') + word;
        
        // Stream the accumulated text
        eventsBroadcaster.broadcastChatStream(playerName, accumulated);
        
        // Shorter delay for faster streaming (25-75ms instead of 50-150ms)
        await new Promise(resolve => setTimeout(resolve, 25 + Math.random() * 50));
      }
      
      // Send final message
      eventsBroadcaster.broadcastChatMessage(playerName, accumulated);
    } catch (error) {
      console.error(`Error streaming text for ${playerName}:`, error, 'Text:', text);
      console.error('Stack trace:', error instanceof Error ? error.stack : 'No stack trace available');
      // Still try to send the complete message
      try {
        eventsBroadcaster.broadcastChatMessage(playerName, text);
      } catch (finalError) {
        console.error(`Even final message broadcast failed for ${playerName}:`, finalError);
      }
    }
  }

  async placeBet(bankroll: number, handNumber: number): Promise<TBetOut> {
    return this.agentCall('/place_bet', { bankroll, handNumber }, this.timeouts.bet, BetOut);
  }

  async talk(io: TAgentIO): Promise<TTalkOut> {
    return this.agentCall('/table_talk', io, this.timeouts.talk, TalkOut);
  }

  async decide(io: TAgentIO): Promise<TDecisionOut> {
    return this.agentCall('/decide', io, this.timeouts.decide, DecisionOut);
  }

  // Streaming versions
  async placeBetStreaming(bankroll: number, handNumber: number): Promise<TBetOut> {
    if (!this.playerName) throw new Error('Player name required for streaming');
    return this.streamingAgentCall('/place_bet', { bankroll, handNumber }, this.timeouts.bet, BetOut, this.playerName);
  }

  async talkStreaming(io: TAgentIO): Promise<TTalkOut> {
    if (!this.playerName) throw new Error('Player name required for streaming');
    return this.streamingAgentCall('/table_talk', io, this.timeouts.talk, TalkOut, this.playerName);
  }

  async decideStreaming(io: TAgentIO): Promise<TDecisionOut> {
    if (!this.playerName) throw new Error('Player name required for streaming');
    return this.streamingAgentCall('/decide', io, this.timeouts.decide, DecisionOut, this.playerName);
  }

  async healthCheck(): Promise<{ ok: boolean }> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        headers: { 'accept': 'application/json' }
      });
      
      if (response.ok) {
        const json = await response.json() as { ok?: boolean };
        return { ok: json.ok === true };
      } else {
        console.error(`Health check failed: HTTP ${response.status} ${response.statusText}`);
        return { ok: false };
      }
    } catch (error) {
      console.error(`Health check error for ${this.baseUrl}:`, error);
      return { ok: false };
    }
  }
}