import { z } from "zod";

export const Action = z.enum(["hit","stand","double","split"]);
export const TalkSignal = z.enum(["aggressive","conservative","neutral"]).optional();

export const PublicPlayer = z.object({
  id: z.string().min(1).max(64),
  seat: z.number().int().min(0).max(7),
  visibleCards: z.array(z.number().int().min(1).max(10)),
  lastAction: Action.optional(),
  bet: z.number().nonnegative().optional(),
  balance: z.number().nonnegative().optional(),
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
export type TTalkOut       = z.infer<typeof TalkOut>;
export type TAction        = z.infer<typeof Action>;
export type TPublicPlayer  = z.infer<typeof PublicPlayer>;
export type TChatMsg       = z.infer<typeof ChatMsg>;