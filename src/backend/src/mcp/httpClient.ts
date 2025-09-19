import type { TAgentIO, TTalkOut, TDecisionOut, TBetOut } from '@shared/schemas';
import { TalkOut, DecisionOut, BetOut } from '@shared/schemas';
import { eventsBroadcaster } from '../api/ws.js';

export class AgentClient {
  private streamingOperations = new Map<string, Promise<void>>();
  
  constructor(
    private baseUrl: string, 
    private timeouts: { talk: number; decide: number; bet: number },
    private playerName?: string
  ) {}

  private async agentCall<T>(
    endpoint: string,
    body: unknown,
    timeoutMs: number,
    schema: { parse: (data: any) => T },
    retryCount: number = 1
  ): Promise<T> {
    const fullUrl = `${this.baseUrl}${endpoint}`;
    console.log(`AgentClient: Making request to ${fullUrl} with timeout ${timeoutMs}ms (attempt ${2 - retryCount}/2)`);
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
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`);
      }
      
      const responseData = await response.json();
      console.log(`AgentClient: Response data:`, JSON.stringify(responseData, null, 2));
      
      const parsed = schema.parse(responseData);
      console.log(`AgentClient: Successfully parsed response from ${endpoint}`);
      return parsed;
    } catch (error) {
      console.error(`AgentClient error for ${endpoint} (attempt ${2 - retryCount}/2):`, error);
      
      // Retry logic for timeouts and network errors
      if (retryCount > 0 && (error instanceof Error && 
          (error.name === 'AbortError' || error.message.includes('fetch')))) {
        console.log(`AgentClient: Retrying ${endpoint} (${retryCount} attempts left)`);
        await new Promise(resolve => setTimeout(resolve, 1000)); // 1s delay before retry
        return this.agentCall(endpoint, body, timeoutMs, schema, retryCount - 1);
      }
      
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Request timeout after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  // Streaming version that emits rationale character by character - FIXED FOR SYNCHRONOUS COMPLETION
  private async streamingAgentCall<T>(
    endpoint: string,
    body: unknown,
    timeoutMs: number,
    schema: { parse: (data: any) => T },
    playerName: string
  ): Promise<T> {
    const operationKey = `${playerName}-${endpoint}-${Date.now()}`;
    console.log(`StreamingAgentCall: Starting ${operationKey}`);
    
    // Start typing indicator
    eventsBroadcaster.broadcastPlayerTyping(playerName, true);
    
    // Show "thinking..." message while waiting for response
    const thinkingMessage = `💭 ${playerName} is thinking...`;
    eventsBroadcaster.broadcastChatStream(playerName, thinkingMessage);
    
    try {
      const result = await this.agentCall(endpoint, body, timeoutMs, schema);
      
      // Small delay to ensure "thinking..." is visible
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Stream the rationale if available - WAIT for completion
      const rationale = (result as any).rationale || (result as any).say;
      if (rationale && typeof rationale === 'string') {
        console.log(`StreamingAgentCall: Starting synchronous streaming for ${operationKey}`);
        const streamingPromise = this.streamText(playerName, rationale);
        this.streamingOperations.set(operationKey, streamingPromise);
        
        // WAIT for streaming to complete before returning
        await streamingPromise;
        console.log(`StreamingAgentCall: Streaming completed for ${operationKey}`);
        this.streamingOperations.delete(operationKey);
      } else {
        // No streaming needed, just send immediate message
        console.log(`StreamingAgentCall: No rationale to stream for ${operationKey}`);
        eventsBroadcaster.broadcastChatMessage(playerName, `✓ ${playerName} completed ${endpoint}`);
      }
      
      return result;
    } catch (error) {
      console.error(`Streaming agent call failed for ${playerName} at ${endpoint}:`, error);
      // Show error in chat for debugging
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      eventsBroadcaster.broadcastChatMessage(playerName, `❌ ERROR: ${errorMsg}`);
      throw error;
    } finally {
      // Stop typing indicator
      eventsBroadcaster.broadcastPlayerTyping(playerName, false);
      this.streamingOperations.delete(operationKey);
    }
  }

  private async streamText(playerName: string, text: string): Promise<void> {
    try {
      console.log(`StreamText: Starting streaming for ${playerName}, text length: ${text.length}`);
      
      // Faster streaming - by words instead of characters, with shorter delays
      const words = text.split(' ');
      let accumulated = '';
      
      for (let i = 0; i < words.length; i++) {
        const word = words[i];
        accumulated += (i > 0 ? ' ' : '') + word;
        
        // Stream the accumulated text
        eventsBroadcaster.broadcastChatStream(playerName, accumulated);
        
        // Even faster streaming for better UX (10-30ms)
        await new Promise(resolve => setTimeout(resolve, 10 + Math.random() * 20));
      }
      
      // Send final message
      console.log(`StreamText: Sending final message for ${playerName}`);
      eventsBroadcaster.broadcastChatMessage(playerName, accumulated);
      console.log(`StreamText: Completed streaming for ${playerName}`);
    } catch (error) {
      console.error(`Error streaming text for ${playerName}:`, error, 'Text:', text);
      console.error('Stack trace:', error instanceof Error ? error.stack : 'No stack trace available');
      // Still try to send the complete message
      try {
        eventsBroadcaster.broadcastChatMessage(playerName, text);
      } catch (finalError) {
        console.error(`Even final message broadcast failed for ${playerName}:`, finalError);
        // Show error in UI for debugging
        eventsBroadcaster.broadcastChatMessage(playerName, `❌ STREAMING ERROR: ${finalError}`);
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

  async healthCheck(): Promise<{ ok: boolean; details?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        headers: { 'accept': 'application/json' },
        signal: AbortSignal.timeout(5000) // 5s timeout for health checks
      });
      
      if (response.ok) {
        const json = await response.json() as { ok?: boolean };
        return { ok: json.ok === true, details: `✓ Healthy (${response.status})` };
      } else {
        const errorText = await response.text().catch(() => 'Unknown error');
        console.error(`Health check failed: HTTP ${response.status} ${response.statusText}`);
        return { ok: false, details: `❌ HTTP ${response.status}: ${errorText}` };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error(`Health check error for ${this.baseUrl}:`, error);
      return { ok: false, details: `❌ ${errorMsg}` };
    }
  }

  // Wait for all streaming operations to complete
  async waitForStreamingCompletion(): Promise<void> {
    if (this.streamingOperations.size > 0) {
      console.log(`AgentClient: Waiting for ${this.streamingOperations.size} streaming operations to complete...`);
      await Promise.all(this.streamingOperations.values());
      console.log(`AgentClient: All streaming operations completed`);
    }
  }

  // Get current streaming status
  isStreaming(): boolean {
    return this.streamingOperations.size > 0;
  }

  getStreamingStatus(): { active: number; operations: string[] } {
    return {
      active: this.streamingOperations.size,
      operations: Array.from(this.streamingOperations.keys())
    };
  }
}