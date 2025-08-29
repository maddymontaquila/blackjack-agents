import type { TPublicSnapshot, TPrivateInfo, TChatMsg, TAction, TAgentIO, TTalkOut, TDecisionOut } from '@shared/schemas';
import { Shoe } from './shoe.js';
import { calculateHandValue, isBust, isBlackjack, determineHandResult, shouldDealerHit, canSplit, canDouble, type HandResult } from './rules.js';
import { AgentClient } from '../mcp/httpClient.js';
import { eventsBroadcaster } from '../api/ws.js';

export interface Player {
  id: string;
  seat: number;
  cards: number[];
  bet: number;
  isStanding: boolean;
  isBusted: boolean;
  lastAction?: TAction;
  bankroll: number;
  // Debug info
  lastError?: string;
  lastActivityTime?: number;
  agentStatus?: 'idle' | 'thinking' | 'streaming' | 'error';
}

export interface DebugInfo {
  phaseStartTime: number;
  phaseDuration: number;
  lastError?: string;
  agentHealthStatus: { [seat: number]: { ok: boolean; details?: string; lastCheck: number } };
  streamingStatus: { [seat: number]: { active: number; operations: string[] } };
  operationLog: Array<{ timestamp: number; operation: string; seat?: number; success: boolean; duration?: number; error?: string }>;
  pendingOperations: string[];
  bettingCompletion: { [seat: number]: { completed: boolean; amount: number; timestamp: number } };
  agentBettingInitiated: boolean; // Track if agent betting has been initiated
  decisionProcessingInProgress: boolean; // Track if agent decision processing is in progress
}

export interface GameState {
  handNumber: number;
  shoe: Shoe;
  dealer: {
    cards: number[];
    isStanding: boolean;
    isBusted: boolean;
  };
  players: Player[];
  chat: TChatMsg[];
  phase: 'waiting' | 'betting' | 'dealing' | 'decisions' | 'dealer' | 'settling' | 'finished';
  currentPlayerIndex: number; // For decision phase
  maxPlayers: number;
  // Debug information
  debug: DebugInfo;
}

export class TableState {
  private state: GameState;
  private agentClients: Map<number, AgentClient> = new Map();

  constructor(agentClients: Map<number, AgentClient> = new Map()) {
    this.agentClients = agentClients;
    this.state = {
      handNumber: 0,
      shoe: new Shoe(Date.now(), 4),
      dealer: { cards: [], isStanding: false, isBusted: false },
      players: [
        { id: 'Pat Python', seat: 0, cards: [], bet: 0, isStanding: false, isBusted: false, bankroll: 100, agentStatus: 'idle' },
        { id: 'Dee DotNet', seat: 1, cards: [], bet: 0, isStanding: false, isBusted: false, bankroll: 100, agentStatus: 'idle' },
        { id: 'Tom TypeScript', seat: 2, cards: [], bet: 0, isStanding: false, isBusted: false, bankroll: 100, agentStatus: 'idle' }
      ],
      chat: [],
      phase: 'waiting',
      currentPlayerIndex: -1,
      maxPlayers: 3,
      debug: {
        phaseStartTime: Date.now(),
        phaseDuration: 0,
        agentHealthStatus: {},
        streamingStatus: {},
        operationLog: [],
        pendingOperations: [],
        bettingCompletion: {},
        agentBettingInitiated: false,
        decisionProcessingInProgress: false
      }
    };
    
    // Initialize debug info for all agents
    this.updateAgentHealthStatus();
  }

  // Get public view of the game state
  getPublicSnapshot(): TPublicSnapshot {
    const dealerUpcard = this.state.dealer.cards.length > 0 ? this.state.dealer.cards[0] : 1;
    
    return {
      handNumber: this.state.handNumber,
      shoePenetration: this.state.shoe.getPenetration(),
      runningCount: this.state.shoe.getRunningCount(),
      players: this.state.players.map(player => ({
        id: player.id,
        seat: player.seat,
        visibleCards: player.cards,
        lastAction: player.lastAction,
        bet: player.bet,
        balance: player.bankroll
      })),
      dealerUpcard,
      chat: this.state.chat
    };
  }

  // Get private info for a specific player
  getPrivateInfo(seat: number): TPrivateInfo | null {
    const player = this.state.players.find(p => p.seat === seat);
    if (!player) return null;

    return {
      myHoleCards: player.cards,
      mySeat: seat,
      bankroll: player.bankroll
    };
  }

  // Get current state info for frontend
  getState() {
    // Update debug timing info
    this.state.debug.phaseDuration = Date.now() - this.state.debug.phaseStartTime;
    
    const publicSnapshot = this.getPublicSnapshot();
    return {
      snap: publicSnapshot,
      status: this.state.phase,
      seats: this.state.players.map(p => ({ 
        id: p.id, 
        seat: p.seat, 
        isActive: !p.isStanding && !p.isBusted,
        agentStatus: p.agentStatus,
        lastError: p.lastError
      })),
      config: { maxPlayers: this.state.maxPlayers },
      dealer: {
        cards: this.state.dealer.cards,
        visibleCards: this.state.phase === 'dealing' || this.state.phase === 'decisions' 
          ? [this.state.dealer.cards[0]] // Only show first card during play
          : this.state.dealer.cards, // Show all cards after
        isStanding: this.state.dealer.isStanding,
        isBusted: this.state.dealer.isBusted
      },
      currentPlayerIndex: this.state.currentPlayerIndex,
      // Enhanced debug information for UI
      debug: {
        phase: this.state.phase,
        phaseStartTime: this.state.debug.phaseStartTime,
        phaseDuration: this.state.debug.phaseDuration,
        phaseStatus: this.getPhaseStatusDescription(),
        agentHealthStatus: this.state.debug.agentHealthStatus,
        streamingStatus: this.state.debug.streamingStatus,
        pendingOperations: this.state.debug.pendingOperations,
        bettingCompletion: this.state.debug.bettingCompletion,
        agentBettingInitiated: this.state.debug.agentBettingInitiated,
        decisionProcessingInProgress: this.state.debug.decisionProcessingInProgress,
        recentOperations: this.state.debug.operationLog.slice(-5), // Last 5 operations
        lastError: this.state.debug.lastError
      }
    };
  }

  // Start a new hand
  startNewHand(): void {
    const operationId = `start-hand-${Date.now()}`;
    this.logOperation(operationId, 'Starting new hand', undefined, true);
    
    // Reset state for new hand
    this.state.handNumber++;
    this.setPhase('betting');
    this.state.currentPlayerIndex = -1;
    
    // Reset shoe with new seed if needed
    if (this.state.shoe.getCardsRemaining() < 20) {
      this.state.shoe.reset(4);  // Reset with 4 decks
      this.logOperation(operationId + '-shoe', 'Reset shoe with 4 decks', undefined, true);
    }
    
    // Reset dealer
    this.state.dealer.cards = [];
    this.state.dealer.isStanding = false;
    this.state.dealer.isBusted = false;
    
    // Reset players for new hand but keep bankroll and reset bets
    this.state.players.forEach(player => {
      player.cards = [];
      player.bet = 0; // Reset bet to 0
      player.isStanding = false;
      player.isBusted = false;
      player.lastAction = undefined;
      player.lastError = undefined;
      player.agentStatus = 'idle';
      player.lastActivityTime = Date.now();
    });
    
    // Clear chat for new hand
    this.state.chat = [];
    
    // Reset debug info for new hand
    this.state.debug.bettingCompletion = {};
    this.state.debug.pendingOperations = [];
    this.state.debug.lastError = undefined;
    this.state.debug.agentBettingInitiated = false; // Reset for new hand
    this.state.debug.decisionProcessingInProgress = false; // Reset for new hand
    
    this.logOperation(operationId, 'New hand started successfully', undefined, true, Date.now() - parseInt(operationId.split('-')[2]));
  }

  // Place a bet for a player
  placeBet(seat: number, amount: number): boolean {
    if (this.state.phase !== 'betting') {
      return false;
    }

    const player = this.state.players.find(p => p.seat === seat);
    if (!player) {
      return false;
    }

    // Calculate available balance (current bankroll + current bet, since we'll replace the bet)
    const availableBalance = player.bankroll + player.bet;
    
    // Validate bet amount
    if (amount < 0 || amount > availableBalance || amount > 100) {
      return false; // Non-negative, can't exceed available balance or $100 max
    }

    // If player had a previous bet, return it to bankroll
    if (player.bet > 0) {
      player.bankroll += player.bet;
    }

    // Set new bet (but don't deduct from bankroll yet - that happens when dealing starts)
    player.bet = amount;
    
    // Deduct the new bet from bankroll temporarily for betting phase
    if (amount > 0) {
      player.bankroll -= amount;
    }

    return true;
  }

  // Place bet for an agent player - ENHANCED WITH BETTER TRACKING
  async placeBetForAgent(seat: number): Promise<void> {
    const operationId = `bet-${seat}-${Date.now()}`;
    this.addPendingOperation(operationId);
    
    if (this.state.phase !== 'betting') {
      this.removePendingOperation(operationId);
      throw new Error('Not in betting phase');
    }

    const player = this.state.players.find(p => p.seat === seat);
    if (!player) {
      this.removePendingOperation(operationId);
      throw new Error(`Player at seat ${seat} not found`);
    }

    const agentClient = this.agentClients.get(seat);
    if (!agentClient) {
      console.log(`DEBUG: No agent client configured for seat ${seat} (${player.id}) - skipping automated betting (manual betting allowed)`);
      this.removePendingOperation(operationId);
      // Mark as "completed" for manual players
      this.state.debug.bettingCompletion[seat] = { completed: true, amount: 0, timestamp: Date.now() };
      return;
    }

    const startTime = Date.now();
    player.agentStatus = 'thinking';
    this.updateStreamingStatus();
    
    try {
      console.log(`DEBUG: Starting bet placement for ${player.id} at seat ${seat}`);
      console.log(`DEBUG: Player bankroll: ${player.bankroll}, hand number: ${this.state.handNumber}`);
      
      // Call agent's place_bet method with streaming - WAIT FOR COMPLETION
      console.log(`DEBUG: Calling placeBetStreaming for ${player.id}...`);
      player.agentStatus = 'streaming';
      const betResult = await agentClient.placeBetStreaming(player.bankroll, this.state.handNumber);
      
      // WAIT for any ongoing streaming to complete
      await agentClient.waitForStreamingCompletion();
      
      const endTime = Date.now();
      console.log(`DEBUG: placeBetStreaming completed for ${player.id} in ${endTime - startTime}ms`);
      
      // Validate and place the bet
      if (this.placeBet(seat, betResult.bet_amount)) {
        // The rationale was already streamed via WebSocket, just add to chat
        this.addChatMessage(player.id, betResult.rationale);
        console.log(`DEBUG: Bet placed successfully for ${player.id}: $${betResult.bet_amount}`);
        
        // Mark betting as completed
        this.state.debug.bettingCompletion[seat] = { 
          completed: true, 
          amount: betResult.bet_amount, 
          timestamp: Date.now() 
        };
        
        this.logOperation(operationId, `Bet placed: $${betResult.bet_amount}`, seat, true, endTime - startTime);
      } else {
        // Fallback to minimum bet if agent's bet was invalid
        this.placeBet(seat, 5);
        this.addChatMessage(player.id, "Oops, betting logic failed - going minimum!");
        console.log(`DEBUG: Fallback minimum bet placed for ${player.id}`);
        
        this.state.debug.bettingCompletion[seat] = { 
          completed: true, 
          amount: 5, 
          timestamp: Date.now() 
        };
        
        this.logOperation(operationId, 'Fallback bet: $5', seat, false, endTime - startTime, 'Invalid bet amount from agent');
      }
      
      player.agentStatus = 'idle';
      player.lastActivityTime = Date.now();
      
    } catch (error) {
      // Emergency fallback - place minimum bet
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error(`Error in placeBetForAgent for seat ${seat} (${player.id}):`, error);
      console.error('Stack trace:', error instanceof Error ? error.stack : 'No stack trace available');
      
      player.lastError = errorMsg;
      player.agentStatus = 'error';
      
      this.placeBet(seat, 5);
      this.addChatMessage(player.id, `❌ ERROR: ${errorMsg.substring(0, 100)}... (bet $5 fallback)`);
      
      // Still mark as completed to not block game flow
      this.state.debug.bettingCompletion[seat] = { 
        completed: true, 
        amount: 5, 
        timestamp: Date.now() 
      };
      
      this.logOperation(operationId, 'Emergency fallback bet: $5', seat, false, Date.now() - startTime, errorMsg);
    } finally {
      this.removePendingOperation(operationId);
      this.updateStreamingStatus();
    }
  }

  // Place bets for all agent players - SEQUENTIAL WITH PROPER COMPLETION TRACKING
  async placeBetsForAllAgents(): Promise<void> {
    console.log('DEBUG: placeBetsForAllAgents() called');
    
    if (this.state.phase !== 'betting') {
      throw new Error('Not in betting phase');
    }

    // Flag should already be set by endpoint before calling this method
    console.log('DEBUG: placeBetsForAllAgents called, agentBettingInitiated should already be true:', this.state.debug.agentBettingInitiated);

    const agentSeats = Array.from(this.agentClients.keys());
    console.log(`DEBUG: Starting betting for ${agentSeats.length} agents: seats ${agentSeats.join(', ')}`);
    console.log(`DEBUG: Current game phase: ${this.state.phase}`);
    console.log(`DEBUG: Available agent clients: ${Array.from(this.agentClients.keys()).join(', ')}`);
    
    if (agentSeats.length === 0) {
      console.log('DEBUG: No agent clients configured - only manual betting available');
      return; // Flag already set by endpoint
    }
    
    const startTime = Date.now();
    
    // Place bets SEQUENTIALLY to avoid race conditions with streaming
    for (const seat of agentSeats) {
      try {
        console.log(`DEBUG: Processing betting for seat ${seat}`);
        await this.placeBetForAgent(seat);
        
        // Small delay between agents to ensure UI updates properly
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Broadcast state after each agent completes
        eventsBroadcaster.broadcastState();
      } catch (error) {
        console.error(`DEBUG: Error processing bet for seat ${seat}:`, error);
        // Continue with next agent even if one fails
      }
    }
    
    // Final wait to ensure all streaming operations have fully completed
    console.log('DEBUG: Waiting for all streaming operations to complete...');
    await Promise.all(
      agentSeats.map(async seat => {
        const client = this.agentClients.get(seat);
        if (client) {
          await client.waitForStreamingCompletion();
        }
      })
    );
    
    const endTime = Date.now();
    console.log(`DEBUG: All agent bets completed in ${endTime - startTime}ms`);
    
    // Additional delay to ensure WebSocket updates reach frontend
    console.log('DEBUG: Adding final delay for WebSocket synchronization...');
    await new Promise(resolve => setTimeout(resolve, 500));
    
    this.logOperation(`all-bets-${startTime}`, 'All agent betting completed', undefined, true, endTime - startTime);
  }

  // Check if all players have placed valid bets - IMPROVED WITH AGENT TRACKING
  allPlayersHaveBet(): boolean {
    const agentSeats = Array.from(this.agentClients.keys());
    
    // For automated players (agents), check if they completed betting process
    for (const seat of agentSeats) {
      const completion = this.state.debug.bettingCompletion[seat];
      if (!completion || !completion.completed || completion.amount < 5) {
        console.log(`allPlayersHaveBet: Agent at seat ${seat} has not completed betting (${completion ? completion.amount : 'no bet'})`);
        return false;
      }
    }
    
    // For manual players, check if they have valid bets
    for (const player of this.state.players) {
      if (!agentSeats.includes(player.seat)) {
        if (player.bet < 5) {
          console.log(`allPlayersHaveBet: Manual player ${player.id} needs to place bet (current: ${player.bet})`);
          return false;
        }
      }
    }
    
    console.log(`allPlayersHaveBet: All players have valid bets`);
    return true;
  }

  // Start dealing (move from betting to dealing phase)
  async startDealing(): Promise<void> {
    if (this.state.phase !== 'betting' || !this.allPlayersHaveBet()) {
      throw new Error('Cannot start dealing: not in betting phase or not all players have bet');
    }

    console.log('Starting dealing phase - all bets are placed');
    this.setPhase('dealing');
    
    // Deal initial cards and stop - frontend will trigger decision phase separately
    await this.dealInitialCards();
  }

  private async dealInitialCards(): Promise<void> {
    // Deal 2 cards to each player, then dealer
    for (let round = 0; round < 2; round++) {
      // Deal to players
      for (const player of this.state.players) {
        const card = this.state.shoe.draw();
        if (card !== null) {
          player.cards.push(card);
        }
      }
      
      // Deal to dealer
      const dealerCard = this.state.shoe.draw();
      if (dealerCard !== null) {
        this.state.dealer.cards.push(dealerCard);
      }
    }
    
    // Check for immediate blackjacks or busts
    this.state.players.forEach(player => {
      if (isBlackjack(player.cards)) {
        player.isStanding = true;
      }
    });
    
    // Cards are dealt - stay in dealing phase, wait for frontend to trigger decisions
    console.log('Cards dealt successfully. Waiting for frontend to start decision phase.');
    this.logOperation('deal-cards', 'Initial cards dealt to all players and dealer', undefined, true);
  }

  // Add chat message
  addChatMessage(from: string, text: string): void {
    this.state.chat.push({ from, text: text.substring(0, 160) }); // Enforce max length
  }

  // Start decision phase
  async startDecisionPhase(): Promise<void> {
    // Guard against multiple calls
    if (this.state.phase === 'decisions') {
      console.log('Decision phase already started - ignoring duplicate call');
      return;
    }
    
    this.setPhase('decisions');
    this.state.currentPlayerIndex = -1; // Start before first player
    this.findNextActivePlayer();
    
    // Automatically process agent decisions and wait for completion
    console.log('Starting agent decision processing...');
    try {
      await this.processAllAgentDecisions();
      console.log('All agent decisions processed');
      // Broadcast final state update after decisions
      eventsBroadcaster.broadcastState();
    } catch (error) {
      console.error('Error during automatic agent decisions processing:', error);
      console.error('Stack trace:', error instanceof Error ? error.stack : 'No stack trace available');
    }
  }

  // Apply player action
  applyPlayerAction(seat: number, action: TAction): boolean {
    const player = this.state.players.find(p => p.seat === seat);
    if (!player || player.isStanding || player.isBusted) {
      return false;
    }

    player.lastAction = action;

    switch (action) {
      case 'hit':
        const card = this.state.shoe.draw();
        if (card !== null) {
          player.cards.push(card);
          if (isBust(player.cards)) {
            player.isBusted = true;
            player.isStanding = true;
          } else if (calculateHandValue(player.cards) === 21) {
            player.isStanding = true;
          }
        }
        break;
      
      case 'stand':
        player.isStanding = true;
        break;
      
      // case 'double':
      //   if (canDouble(player.cards)) {
      //     player.bet *= 2;
      //     const doubleCard = this.state.shoe.draw();
      //     if (doubleCard !== null) {
      //       player.cards.push(doubleCard);
      //     }
      //     player.isStanding = true;
      //     if (isBust(player.cards)) {
      //       player.isBusted = true;
      //     }
      //   } else {
      //     // Fallback to hit if double not allowed
      //     return this.applyPlayerAction(seat, 'hit');
      //   }
      //   break;
      
      // case 'split':
      //   // For simplicity in this demo, treat split as stand
      //   // Full split implementation would require more complex state management
      //   player.isStanding = true;
      //   break;
    }

    // Check if we need to advance to next player
    if (player.isStanding || player.isBusted) {
      this.findNextActivePlayer();
    }

    return true;
  }

  private findNextActivePlayer(): void {
    // Find the next active player by seat number
    const currentSeat = this.state.currentPlayerIndex;
    
    // Look for the next active player starting from the seat after current
    for (const player of this.state.players) {
      if (player.seat > currentSeat && 
          !player.isStanding && 
          !player.isBusted && 
          calculateHandValue(player.cards) < 21) {
        this.state.currentPlayerIndex = player.seat;
        return;
      }
    }
    
    // No more active players, move to dealer phase and automatically play
    this.state.currentPlayerIndex = -1;
    this.setPhase('dealer');
    
    // Automatically play dealer hand
    this.playDealerHand();
    
    // Automatically settle hands after dealer finishes
    const results = this.settleHands();
    console.log('Hand settled automatically. Results:', results);
    
    // Broadcast final game state
    eventsBroadcaster.broadcastState();
    eventsBroadcaster.broadcastSettle(results);
  }

  // Play dealer hand
  playDealerHand(): void {
    while (shouldDealerHit(this.state.dealer.cards)) {
      const card = this.state.shoe.draw();
      if (card !== null) {
        this.state.dealer.cards.push(card);
        if (isBust(this.state.dealer.cards)) {
          this.state.dealer.isBusted = true;
          break;
        }
      } else {
        break; // No more cards
      }
    }
    
    this.state.dealer.isStanding = true;
    this.setPhase('settling');
  }

  // Settle all hands and calculate results
  settleHands(): Array<{ seat: number, result: 'win' | 'lose' | 'push', payout: number }> {
    const results: Array<{ seat: number, result: 'win' | 'lose' | 'push', payout: number }> = [];
    
    for (const player of this.state.players) {
      const result = determineHandResult(player.cards, this.state.dealer.cards);
      let payout = 0;
      
      switch (result) {
        case 'win':
          // For win: return bet + payout (1:1 for regular win, 1.5:1 for blackjack)
          payout = isBlackjack(player.cards) ? Math.floor(player.bet * 1.5) : player.bet;
          player.bankroll += player.bet + payout; // Return bet + winnings
          break;
        case 'lose':
          // Bet already deducted during dealing, no additional change needed
          payout = 0;
          break;
        case 'push':
          // Return the bet
          player.bankroll += player.bet;
          payout = 0;
          break;
      }
      
      results.push({ seat: player.seat, result, payout });
    }
    
    this.setPhase('finished');
    return results;
  }

  // Check if player can take action
  canPlayerAct(seat: number): boolean {
    if (this.state.phase !== 'decisions' || this.state.currentPlayerIndex !== seat) {
      return false;
    }
    
    const player = this.state.players.find(p => p.seat === seat);
    return player !== undefined && !player.isStanding && !player.isBusted;
  }

  // Get available actions for player
  getAvailableActions(seat: number): TAction[] {
    const player = this.state.players.find(p => p.seat === seat);
    if (!player || player.isStanding || player.isBusted) {
      return [];
    }

    const actions: TAction[] = ['hit', 'stand'];
    
    // if (canDouble(player.cards)) {
    //   actions.push('double');
    // }
    
    // if (canSplit(player.cards)) {
    //   actions.push('split');
    // }
    
    return actions;
  }

  // Reset entire game state to initial conditions
  resetEntireGame(): void {
    this.state = {
      handNumber: 0,
      shoe: new Shoe(Date.now(), 4),
      dealer: { cards: [], isStanding: false, isBusted: false },
      players: [
        { id: 'Pat Python', seat: 0, cards: [], bet: 0, isStanding: false, isBusted: false, bankroll: 100, agentStatus: 'idle' },
        { id: 'Dee DotNet', seat: 1, cards: [], bet: 0, isStanding: false, isBusted: false, bankroll: 100, agentStatus: 'idle' },
        { id: 'Tom TypeScript', seat: 2, cards: [], bet: 0, isStanding: false, isBusted: false, bankroll: 100, agentStatus: 'idle' }
      ],
      chat: [],
      phase: 'waiting',
      currentPlayerIndex: -1,
      maxPlayers: 3,
      debug: {
        phaseStartTime: Date.now(),
        phaseDuration: 0,
        agentHealthStatus: {},
        streamingStatus: {},
        operationLog: [],
        pendingOperations: [],
        bettingCompletion: {},
        agentBettingInitiated: false,
        decisionProcessingInProgress: false
      }
    };
    
    // Re-initialize agent health status
    this.updateAgentHealthStatus();
    this.logOperation('reset-game', 'Complete game reset', undefined, true);
  }

  // Generate agent IO for a specific player
  private buildAgentIO(seat: number, role: string): TAgentIO {
    const player = this.state.players.find(p => p.seat === seat);
    if (!player) throw new Error(`Player at seat ${seat} not found`);

    const publicSnapshot: TPublicSnapshot = {
      handNumber: this.state.handNumber,
      shoePenetration: this.state.shoe.getPenetration(),
      dealerUpcard: this.state.dealer.cards[0] ?? 1, // Default to ace if no dealer card yet
      players: this.state.players.map(p => ({
        id: p.id,
        seat: p.seat,
        visibleCards: p.cards,
        bet: p.bet,
        balance: p.bankroll,
        lastAction: p.lastAction
      })),
      chat: this.state.chat
    };

    const privateInfo: TPrivateInfo = {
      mySeat: seat,
      bankroll: player.bankroll,
      myHoleCards: player.cards
    };

    return {
      role: role as any,
      public: publicSnapshot,
      me: privateInfo
    };
  }

  // Table talk methods removed - agents now chat during betting and decisions instead

  // Mark agent betting as initiated (for button state management)
  markAgentBettingInitiated(): void {
    this.state.debug.agentBettingInitiated = true;
    this.logOperation('agent-betting-initiated', 'Agent betting initiated - button should disappear', undefined, true);
    console.log('DEBUG: agentBettingInitiated flag set to true');
  }

  // Make decision for an agent player
  async makeDecisionForAgent(seat: number): Promise<void> {
    const player = this.state.players.find(p => p.seat === seat);
    if (!player) {
      throw new Error(`Player at seat ${seat} not found`);
    }

    const agentClient = this.agentClients.get(seat);
    if (!agentClient) {
      throw new Error(`No agent client configured for seat ${seat}`);
    }

    try {
      const agentIO = this.buildAgentIO(seat, 'decision');
      const decisionResult = await agentClient.decideStreaming(agentIO);
      
      // The rationale was already streamed via WebSocket, just add to chat
      this.addChatMessage(player.id, decisionResult.rationale);
      
      // Apply the decision
      this.applyPlayerAction(seat, decisionResult.action);
      
      // Broadcast state update after each decision
      eventsBroadcaster.broadcastState();
    } catch (error) {
      console.error(`Error making decision for ${player.id} at seat ${seat}:`, error);
      console.error('Stack trace:', error instanceof Error ? error.stack : 'No stack trace available');
      this.addChatMessage(player.id, "My decision circuits are fried - standing!");
      this.applyPlayerAction(seat, 'stand');
    }
  }

  // Process all agent decisions automatically
  async processAllAgentDecisions(): Promise<void> {
    if (this.state.phase !== 'decisions') {
      throw new Error('Not in decisions phase');
    }

    // Guard against concurrent decision processing
    if (this.state.debug.decisionProcessingInProgress) {
      console.log('Agent decision processing already in progress - ignoring duplicate call');
      return;
    }

    // Mark as in progress
    this.state.debug.decisionProcessingInProgress = true;
    
    try {
      // Process decisions one by one for current active player
      while (this.state.phase === 'decisions' && this.state.currentPlayerIndex >= 0) {
        const currentSeat = this.state.currentPlayerIndex;
        const agentClient = this.agentClients.get(currentSeat);
        
        if (agentClient) {
          // This is an agent, make automatic decision
          await this.makeDecisionForAgent(currentSeat);
        } else {
          // This is a manual player, break and wait for manual input
          break;
        }
      }
    } finally {
      // Always reset the flag, even if there was an error
      this.state.debug.decisionProcessingInProgress = false;
    }
  }

  // HELPER METHODS FOR DEBUG TRACKING
  private setPhase(newPhase: GameState['phase']): void {
    const oldPhase = this.state.phase;
    this.state.phase = newPhase;
    this.state.debug.phaseStartTime = Date.now();
    this.state.debug.phaseDuration = 0;
    
    console.log(`PHASE TRANSITION: ${oldPhase} -> ${newPhase}`);
    this.logOperation(`phase-${Date.now()}`, `Phase transition: ${oldPhase} -> ${newPhase}`, undefined, true);
  }

  private logOperation(id: string, operation: string, seat?: number, success: boolean = true, duration?: number, error?: string): void {
    const logEntry = {
      timestamp: Date.now(),
      operation,
      seat,
      success,
      duration,
      error
    };
    
    this.state.debug.operationLog.push(logEntry);
    
    // Keep only last 20 operations to prevent memory bloat
    if (this.state.debug.operationLog.length > 20) {
      this.state.debug.operationLog = this.state.debug.operationLog.slice(-20);
    }
    
    if (!success && error) {
      this.state.debug.lastError = error;
    }
    
    console.log(`OPERATION LOG: [${success ? 'SUCCESS' : 'FAILED'}] ${operation} ${seat !== undefined ? `(seat ${seat})` : ''} ${duration ? `(${duration}ms)` : ''} ${error ? `ERROR: ${error}` : ''}`);
  }

  private addPendingOperation(operationId: string): void {
    this.state.debug.pendingOperations.push(operationId);
    console.log(`PENDING OPS: Added ${operationId}. Total: ${this.state.debug.pendingOperations.length}`);
  }

  private removePendingOperation(operationId: string): void {
    const index = this.state.debug.pendingOperations.indexOf(operationId);
    if (index > -1) {
      this.state.debug.pendingOperations.splice(index, 1);
    }
    console.log(`PENDING OPS: Removed ${operationId}. Total: ${this.state.debug.pendingOperations.length}`);
  }

  private async updateAgentHealthStatus(): Promise<void> {
    const healthPromises = Array.from(this.agentClients.entries()).map(async ([seat, client]) => {
      try {
        const health = await client.healthCheck();
        this.state.debug.agentHealthStatus[seat] = {
          ok: health.ok,
          details: health.details,
          lastCheck: Date.now()
        };
      } catch (error) {
        this.state.debug.agentHealthStatus[seat] = {
          ok: false,
          details: error instanceof Error ? error.message : 'Health check failed',
          lastCheck: Date.now()
        };
      }
    });
    
    await Promise.all(healthPromises);
  }

  private updateStreamingStatus(): void {
    Array.from(this.agentClients.entries()).forEach(([seat, client]) => {
      this.state.debug.streamingStatus[seat] = client.getStreamingStatus();
    });
  }

  private getPhaseStatusDescription(): string {
    const { phase } = this.state;
    const agentSeats = Array.from(this.agentClients.keys());
    
    switch (phase) {
      case 'waiting':
        return 'Ready to start new hand';
      case 'betting':
        const completedBets = Object.values(this.state.debug.bettingCompletion).filter(c => c.completed).length;
        return `Betting phase: ${completedBets}/${agentSeats.length} agents completed. Pending: ${this.state.debug.pendingOperations.length} operations`;
      case 'dealing':
        return 'Dealing initial cards';
      case 'decisions':
        return `Decision phase: Player ${this.state.currentPlayerIndex} to act`;
      case 'dealer':
        return 'Dealer playing hand';
      case 'settling':
        return 'Settling bets and payouts';
      case 'finished':
        return 'Hand complete';
      default:
        return `Unknown phase: ${phase}`;
    }
  }
}