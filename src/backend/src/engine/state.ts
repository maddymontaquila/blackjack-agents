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
  phase: 'waiting' | 'betting' | 'dealing' | 'table-talk' | 'decisions' | 'dealer' | 'settling' | 'finished';
  currentPlayerIndex: number; // For decision phase
  maxPlayers: number;
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
        { id: 'Pat Python', seat: 0, cards: [], bet: 0, isStanding: false, isBusted: false, bankroll: 100 },
        { id: 'Dee DotNet', seat: 1, cards: [], bet: 0, isStanding: false, isBusted: false, bankroll: 100 },
        { id: 'Tom TypeScript', seat: 2, cards: [], bet: 0, isStanding: false, isBusted: false, bankroll: 100 }
      ],
      chat: [],
      phase: 'waiting',
      currentPlayerIndex: -1,
      maxPlayers: 3
    };
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
    const publicSnapshot = this.getPublicSnapshot();
    return {
      snap: publicSnapshot,
      status: this.state.phase,
      seats: this.state.players.map(p => ({ id: p.id, seat: p.seat, isActive: !p.isStanding && !p.isBusted })),
      config: { maxPlayers: this.state.maxPlayers },
      dealer: {
        cards: this.state.dealer.cards,
        visibleCards: this.state.phase === 'dealing' || this.state.phase === 'table-talk' || this.state.phase === 'decisions' 
          ? [this.state.dealer.cards[0]] // Only show first card during play
          : this.state.dealer.cards, // Show all cards after
        isStanding: this.state.dealer.isStanding,
        isBusted: this.state.dealer.isBusted
      },
      currentPlayerIndex: this.state.currentPlayerIndex
    };
  }

  // Start a new hand
  startNewHand(): void {
    // Reset state for new hand
    this.state.handNumber++;
    this.state.phase = 'betting'; // Start with betting phase
    this.state.currentPlayerIndex = -1;
    
    // Reset shoe with new seed if needed
    if (this.state.shoe.getCardsRemaining() < 20) {
      this.state.shoe.reset(4);  // Reset with 4 decks
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
    });
    
    // Clear chat for new hand
    this.state.chat = [];
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

  // Place bet for an agent player
  async placeBetForAgent(seat: number): Promise<void> {
    if (this.state.phase !== 'betting') {
      throw new Error('Not in betting phase');
    }

    const player = this.state.players.find(p => p.seat === seat);
    if (!player) {
      throw new Error(`Player at seat ${seat} not found`);
    }

    const agentClient = this.agentClients.get(seat);
    if (!agentClient) {
      console.log(`DEBUG: No agent client configured for seat ${seat} (${player.id}) - skipping automated betting (manual betting allowed)`);
      return; // Skip this seat - allow manual betting
    }

    try {
      console.log(`DEBUG: Starting bet placement for ${player.id} at seat ${seat}`);
      console.log(`DEBUG: Player bankroll: ${player.bankroll}, hand number: ${this.state.handNumber}`);
      
      // Call agent's place_bet method with streaming
      console.log(`DEBUG: Calling placeBetStreaming for ${player.id}...`);
      const startTime = Date.now();
      const betResult = await agentClient.placeBetStreaming(player.bankroll, this.state.handNumber);
      const endTime = Date.now();
      console.log(`DEBUG: placeBetStreaming completed for ${player.id} in ${endTime - startTime}ms`);
      
      // Validate and place the bet
      if (this.placeBet(seat, betResult.bet_amount)) {
        // The rationale was already streamed via WebSocket, just add to chat
        this.addChatMessage(player.id, betResult.rationale);
        console.log(`DEBUG: Bet placed successfully for ${player.id}: $${betResult.bet_amount}`);
      } else {
        // Fallback to minimum bet if agent's bet was invalid
        this.placeBet(seat, 5);
        this.addChatMessage(player.id, "Oops, betting logic failed - going minimum!");
        console.log(`DEBUG: Fallback minimum bet placed for ${player.id}`);
      }
    } catch (error) {
      // Emergency fallback - place minimum bet
      console.error(`Error in placeBetForAgent for seat ${seat} (${player.id}):`, error);
      console.error('Stack trace:', error instanceof Error ? error.stack : 'No stack trace available');
      this.placeBet(seat, 5);
      this.addChatMessage(player.id, "My betting circuits are fried - minimum bet it is!");
    }
  }

  // Place bets for all agent players
  async placeBetsForAllAgents(): Promise<void> {
    console.log('DEBUG: placeBetsForAllAgents() called');
    
    if (this.state.phase !== 'betting') {
      throw new Error('Not in betting phase');
    }

    const agentSeats = Array.from(this.agentClients.keys());
    console.log(`DEBUG: Starting betting for ${agentSeats.length} agents: seats ${agentSeats.join(', ')}`);
    console.log(`DEBUG: Current game phase: ${this.state.phase}`);
    console.log(`DEBUG: Available agent clients: ${Array.from(this.agentClients.keys()).join(', ')}`);
    
    if (agentSeats.length === 0) {
      console.log('DEBUG: No agent clients configured - only manual betting available');
      return;
    }
    
    const startTime = Date.now();
    
    // Place bets for all agents in parallel and wait for all to complete
    await Promise.all(
      agentSeats.map(seat => this.placeBetForAgent(seat))
    );
    
    const endTime = Date.now();
    console.log(`DEBUG: All agent bets completed in ${endTime - startTime}ms`);
  }

  // Check if all players have placed valid bets
  allPlayersHaveBet(): boolean {
    return this.state.players.every(player => player.bet >= 5);
  }

  // Start dealing (move from betting to dealing phase)
  async startDealing(): Promise<void> {
    if (this.state.phase !== 'betting' || !this.allPlayersHaveBet()) {
      throw new Error('Cannot start dealing: not in betting phase or not all players have bet');
    }

    console.log('Starting dealing phase - all bets are placed');
    this.state.phase = 'dealing';
    
    // Deal initial cards (this will automatically progress through table-talk to decisions)
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
    
    // Move to table talk phase and automatically generate table talk
    this.state.phase = 'table-talk';
    
    // Automatically generate table talk for all agents and wait for completion
    console.log('Starting table talk generation...');
    try {
      await this.generateTableTalkForAllAgents();
      console.log('Table talk generation completed, moving to decisions');
      eventsBroadcaster.broadcastState();
      
      // After table talk, automatically move to decisions phase
      await this.startDecisionPhase();
    } catch (error) {
      console.error('Error during automatic table talk generation:', error);
      console.error('Stack trace:', error instanceof Error ? error.stack : 'No stack trace available');
      // Still move to decisions even if table talk fails
      await this.startDecisionPhase();
    }
  }

  // Add chat message
  addChatMessage(from: string, text: string): void {
    this.state.chat.push({ from, text: text.substring(0, 160) }); // Enforce max length
  }

  // Start decision phase
  async startDecisionPhase(): Promise<void> {
    this.state.phase = 'decisions';
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
    this.state.phase = 'dealer';
    
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
    this.state.phase = 'settling';
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
    
    this.state.phase = 'finished';
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
        { id: 'Pat Python', seat: 0, cards: [], bet: 0, isStanding: false, isBusted: false, bankroll: 100 },
        { id: 'Dee DotNet', seat: 1, cards: [], bet: 0, isStanding: false, isBusted: false, bankroll: 100 },
        { id: 'Tom TypeScript', seat: 2, cards: [], bet: 0, isStanding: false, isBusted: false, bankroll: 100 }
      ],
      chat: [],
      phase: 'waiting',
      currentPlayerIndex: -1,
      maxPlayers: 3
    };
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

  // Generate table talk for all agents
  async generateTableTalkForAllAgents(): Promise<void> {
    if (this.state.phase !== 'table-talk') {
      throw new Error('Not in table-talk phase');
    }

    const agentSeats = Array.from(this.agentClients.keys());
    
    // Generate table talk for all agents in parallel
    await Promise.all(
      agentSeats.map(seat => this.generateTableTalkForAgent(seat))
    );
  }

  // Generate table talk for a specific agent
  async generateTableTalkForAgent(seat: number): Promise<void> {
    const player = this.state.players.find(p => p.seat === seat);
    if (!player) {
      throw new Error(`Player at seat ${seat} not found`);
    }

    const agentClient = this.agentClients.get(seat);
    if (!agentClient) {
      throw new Error(`No agent client configured for seat ${seat}`);
    }

    try {
      const agentIO = this.buildAgentIO(seat, 'table-talk');
      const talkResult = await agentClient.talkStreaming(agentIO);
      
      // The rationale was already streamed via WebSocket, just add to chat
      this.addChatMessage(player.id, talkResult.say);
    } catch (error) {
      console.error(`Error generating table talk for ${player.id} at seat ${seat}:`, error);
      console.error('Stack trace:', error instanceof Error ? error.stack : 'No stack trace available');
      this.addChatMessage(player.id, "My chat circuits are on the fritz!");
    }
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
  }
}