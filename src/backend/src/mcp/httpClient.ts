import type { TAgentIO, TTalkOut, TDecisionOut } from '@shared/schemas';
import { TalkOut, DecisionOut } from '@shared/schemas';

export class AgentClient {
  constructor(
    private baseUrl: string, 
    private timeouts: { talk: number; decide: number }
  ) {}

  private async post<T>(
    path: string, 
    body: unknown, 
    timeoutMs: number, 
    schema: { parse: (data: any) => T }
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const json = await response.json().catch(() => ({}));
      return schema.parse(json);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Request timeout after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async talk(io: TAgentIO): Promise<TTalkOut> {
    return this.post('/table_talk', io, this.timeouts.talk, TalkOut);
  }

  async decide(io: TAgentIO): Promise<TDecisionOut> {
    return this.post('/decide', io, this.timeouts.decide, DecisionOut);
  }

  async healthCheck(): Promise<{ ok: boolean }> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        headers: { 'accept': 'application/json' }
      });
      
      if (response.ok) {
        const json = await response.json();
        return { ok: json.ok === true };
      } else {
        return { ok: false };
      }
    } catch {
      return { ok: false };
    }
  }
}