# Blackjack LLM Table — HTTP/SSE + Aspire Spec

This document defines the architecture and contracts for a demo blackjack table with multiple LLM agents (Python, TypeScript, C#) orchestrated via **Aspire**.

---

## 0) Services & topology

- **frontend** (existing UI) → talks to **backend/Host**
- **backend** (Host/Engine, TypeScript): authoritative rules + orchestrator
- **dee-dotnet** (C# Agent): MCP-style HTTP server exposing `table_talk`, `decide`
- **tom-typescript** (TS Agent): same contract
- **pat-python** (Python Agent): same contract

Aspire orchestrates service discovery, health, secrets, and networking.

---

## 1) Repo layout

```
src/
  frontend/           # UI
  backend/            # Host/Engine (Node/TS)
  pat-python/         # Python Agent
  tom-typescript/     # TS Agent
  dee-dotnet/         # C# Agent
  shared/             # Shared schemas
```

---

## 2) Shared contracts (`src/shared/schemas.ts`)

```ts
import { z } from "zod";

export const Action = z.enum(["hit","stand","double","split"]);
export const TalkSignal = z.enum(["aggressive","conservative","neutral"]).optional();

export const PublicPlayer = z.object({
  id: z.string().min(1).max(64),
  seat: z.number().int().min(0).max(7),
  visibleCards: z.array(z.number().int().min(1).max(10)),
  lastAction: Action.optional(),
  bet: z.number().nonnegative().optional(),
});

export const ChatMsg = z.object({ from: z.string(), text: z.string().max(160) });

export const PublicSnapshot = z.object({
  handNumber: z.number().int().min(1),
  shoePenetration: z.number().min(0).max(1),
  runningCount: z.number().int().optional(),
  players: z.array(PublicPlayer),
  dealerUpcard: z.number().int().min(1).max(10),
  chat: z.array(ChatMsg),
});

export const PrivateInfo = z.object({
  myHoleCards: z.array(z.number().int().min(1).max(10)),
  mySeat: z.number().int().min(0).max(7),
  bankroll: z.number().nonnegative(),
});

export const AgentIO = z.object({
  role: z.union([z.literal("table-talk"), z.literal("decision")]),
  public: PublicSnapshot,
  me: PrivateInfo,
});

export const TalkOut = z.object({
  say: z.string().min(1).max(160),
  signal: TalkSignal,
});

export const DecisionOut = z.object({
  action: Action,
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1).max(240),
});

export type TPublicSnapshot = z.infer<typeof PublicSnapshot>;
export type TPrivateInfo   = z.infer<typeof PrivateInfo>;
export type TAgentIO       = z.infer<typeof AgentIO>;
export type TDecisionOut   = z.infer<typeof DecisionOut>;
```

---

## 3) Agent API (all languages)

Each agent exposes the same HTTP interface:

- `POST /table_talk`  
  - Input: `AgentIO` (`role: "table-talk"`)  
  - Output: `TalkOut`

- `POST /decide`  
  - Input: `AgentIO` (`role: "decision"`)  
  - Output: `DecisionOut`

- Optional: `GET /health`, `GET /logs` (SSE)

---

## 4) Backend API (frontend-facing)

- `GET /state` → `{ snap: PublicSnapshot, status, seats, config }`
- `POST /next` → `{ startedHand: number }`
- `GET /health` → `{ ok: true }`

**WebSocket `/events`** broadcasts:
- `{ type:"deal", snap: PublicSnapshot }`
- `{ type:"chat", msg: ChatMsg }`
- `{ type:"action", seat, decision, handState }`
- `{ type:"dealer", action, card? }`
- `{ type:"settle", results:[…] }`
- `{ type:"error", message }`

---

## 5) Backend internals

- `engine/shoe.ts` — seeded shoe, draw, penetration
- `engine/rules.ts` — handValue, dealer policy
- `engine/state.ts` — table state, deal/apply/settle
- `engine/strategy.ts` — **basic strategy fallback**
- `mcp/httpClient.ts` — thin HTTP client to agents (timeouts + validation)
- `api/http.ts` — `/state`, `/next`, `/health`
- `api/ws.ts` — `/events`
- `config.ts` — URLs/timeouts from Aspire env vars

**Agent client example:**

```ts
import { AgentIO, TalkOut, DecisionOut } from "@shared/schemas";
import { z } from "zod";

export class AgentClient {
  constructor(private baseUrl: string, private ms: { talk: number; decide: number }) {}
  private async post<T>(path: string, body: unknown, timeoutMs: number, schema: z.ZodSchema<T>): Promise<T> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: ctrl.signal
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return schema.parse(json);
    } finally {
      clearTimeout(t);
    }
  }
  talk(io: z.infer<typeof AgentIO>)   { return this.post("/table_talk", io, this.ms.talk, TalkOut); }
  decide(io: z.infer<typeof AgentIO>) { return this.post("/decide",     io, this.ms.decide, DecisionOut); }
}
```

---

## 6) Game loop outline

```ts
async function playHand() {
  resetAndDeal(); broadcast({ type:"deal", snap: snapshot(state) });

  // table-talk
  for (const seat of seatsInOrder()) {
    const io = { role:"table-talk", public: snapshot(state), me: privateFor(state, seat) };
    const res = await agentClientForSeat(seat).talk(io).catch(() => null);
    const say = TalkOut.safeParse(res).success ? res!.say : "(…)";
    appendChat({ from: seat.id, text: say });
    broadcast({ type:"chat", msg: { from: seat.id, text: say } });
  }

  // decisions
  for (const seat of seatsInOrder()) {
    while (!handResolved(state, seat)) {
      const io = { role:"decision", public: snapshot(state), me: privateFor(state, seat) };
      const res = await agentClientForSeat(seat).decide(io).catch(() => null);
      const parsed = DecisionOut.safeParse(res);
      const action = parsed.success ? parsed.data.action : basicStrategy(io.public, io.me);
      applyAction(state, seat, action);
      broadcast({ type:"action", seat: seat.index, decision: parsed.success ? parsed.data : { action:"fallback" }, handState: viewHand(state, seat) });
      if (isBustOrStanding(state, seat)) break;
    }
  }

  finishDealer(state, step => broadcast({ type:"dealer", ...step }));
  const results = settleBets(state);
  broadcast({ type:"settle", results });
}
```

---

## 7) Aspire AppHost

Everything in this app will be orchestrated by an Aspire AppHost located at .aspire/AppHost.cs. From anywhere in the root of the repo or below, "aspire run" will start the whole stack.

## 8) Health & guardrails

- Agents: `GET /health` returns `{ ok:true }` once LLM ready.
- Backend: `GET /health` includes agent reachability.
- Host ensures agents only see public info + their own hole cards.
- All agent replies validated with Zod. Fallback to basic strategy on timeout or bad JSON.

---

## 9) Determinism & logging

- RNG seeded per hand (`handNumber + salt`).
- Backend logs JSONL with: seed, agent calls, latencies, fallbacks, settlements.
- Use OTEL for all logging and telemetry.

---

## 10) Acceptance criteria

- Frontend shows table from `GET /state` and subscribes to `/events`.
- One talk round per hand (3 messages).
- Each seat resolves with an action (agent or fallback).
- Dealer resolves correctly; results broadcast.
