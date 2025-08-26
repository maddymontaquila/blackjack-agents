import type { TAgentIO, TTalkOut, TDecisionOut, TBetOut } from '@shared/schemas';
import { TalkOut, DecisionOut, BetOut } from '@shared/schemas';

export class AgentClient {
  constructor(
    private baseUrl: string, 
    private timeouts: { talk: number; decide: number; bet: number }
  ) {}

  private async mcpCall<T>(
    toolName: string,
    args: unknown,
    timeoutMs: number,
    schema: { parse: (data: any) => T }
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    
    try {
      const response = await fetch(`${this.baseUrl}/mcp/tools/call`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: toolName,
          arguments: args
        }),
        signal: controller.signal
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const mcpResponse = await response.json() as any;
      
      // Extract text content from MCP response
      if (mcpResponse.content && mcpResponse.content[0]?.text) {
        const toolResult = JSON.parse(mcpResponse.content[0].text);
        return schema.parse(toolResult);
      } else {
        throw new Error('Invalid MCP response format');
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Request timeout after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async placeBet(bankroll: number, handNumber: number): Promise<TBetOut> {
    return this.mcpCall('place_bet', { bankroll, handNumber }, this.timeouts.bet, BetOut);
  }

  async talk(io: TAgentIO): Promise<TTalkOut> {
    return this.mcpCall('table_talk', io, this.timeouts.talk, TalkOut);
  }

  async decide(io: TAgentIO): Promise<TDecisionOut> {
    return this.mcpCall('decide', io, this.timeouts.decide, DecisionOut);
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
        return { ok: false };
      }
    } catch {
      return { ok: false };
    }
  }
}