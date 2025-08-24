import type { TPublicSnapshot, TPrivateInfo, TChatMsg, TAction } from '@shared/schemas';
import { Shoe } from './shoe.js';
import { calculateHandValue, isBust, isBlackjack, determineHandResult, shouldDealerHit, canSplit, canDouble } from './rules.js';

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
  phase: 'waiting' | 'dealing' | 'table-talk' | 'decisions' | 'dealer' | 'settling' | 'finished';
  currentPlayerIndex: number; // For decision phase
  maxPlayers: number;
}

export class TableState {
  private state: GameState;

  constructor() {
    this.state = {
      handNumber: 0,
      shoe: new Shoe(Date.now(), 4),
      dealer: { cards: [], isStanding: false, isBusted: false },
      players: [
        { id: 'Player 1', seat: 0, cards: [], bet: 100, isStanding: false, isBusted: false, bankroll: 1000 },
        { id: 'Player 2', seat: 1, cards: [], bet: 100, isStanding: false, isBusted: false, bankroll: 1000 },
        { id: 'Player 3', seat: 2, cards: [], bet: 100, isStanding: false, isBusted: false, bankroll: 1000 }
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
        bet: player.bet
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
    this.state.phase = 'dealing';
    this.state.currentPlayerIndex = -1;
    
    // Reset shoe with new seed if needed
    if (this.state.shoe.getCardsRemaining() < 20) {
      this.state.shoe.reset(4);  // Reset with 4 decks
    }
    
    // Reset dealer
    this.state.dealer.cards = [];
    this.state.dealer.isStanding = false;
    this.state.dealer.isBusted = false;
    
    // Reset players
    this.state.players.forEach(player => {
      player.cards = [];
      player.isStanding = false;
      player.isBusted = false;
      player.lastAction = undefined;
    });
    
    // Clear chat for new hand
    this.state.chat = [];
    
    // Deal initial cards
    this.dealInitialCards();
  }

  private dealInitialCards(): void {
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
    
    // Move to table talk phase
    this.state.phase = 'table-talk';
  }

  // Add chat message
  addChatMessage(from: string, text: string): void {
    this.state.chat.push({ from, text: text.substring(0, 160) }); // Enforce max length
  }

  // Start decision phase
  startDecisionPhase(): void {
    this.state.phase = 'decisions';
    this.state.currentPlayerIndex = -1; // Start before first player
    this.findNextActivePlayer();
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
      
      case 'double':
        if (canDouble(player.cards)) {
          player.bet *= 2;
          const doubleCard = this.state.shoe.draw();
          if (doubleCard !== null) {
            player.cards.push(doubleCard);
          }
          player.isStanding = true;
          if (isBust(player.cards)) {
            player.isBusted = true;
          }
        } else {
          // Fallback to hit if double not allowed
          return this.applyPlayerAction(seat, 'hit');
        }
        break;
      
      case 'split':
        // For simplicity in this demo, treat split as stand
        // Full split implementation would require more complex state management
        player.isStanding = true;
        break;
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
    
    // No more active players, move to dealer phase
    this.state.currentPlayerIndex = -1;
    this.state.phase = 'dealer';
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
    const results = [];
    
    for (const player of this.state.players) {
      const result = determineHandResult(player.cards, this.state.dealer.cards);
      let payout = 0;
      
      switch (result) {
        case 'win':
          payout = isBlackjack(player.cards) ? player.bet * 1.5 : player.bet;
          player.bankroll += payout;
          break;
        case 'lose':
          payout = -player.bet;
          player.bankroll -= player.bet;
          break;
        case 'push':
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
    
    if (canDouble(player.cards)) {
      actions.push('double');
    }
    
    if (canSplit(player.cards)) {
      actions.push('split');
    }
    
    return actions;
  }
}