import type { TAction } from '@shared/schemas';
import { calculateHandValue } from './rules.js';

// Basic strategy implementation for fallback when agents fail
export function getBasicStrategyAction(
  playerCards: number[], 
  dealerUpcard: number, 
  canSplitOption: boolean = false,
  canDoubleOption: boolean = false
): TAction {
  const playerValue = calculateHandValue(playerCards);
  const isSoft = hasSoftAce(playerCards);
  const isPair = playerCards.length === 2 && playerCards[0] === playerCards[1];
  
  // Splitting strategy (if allowed and is a pair) - SIMPLIFIED FOR CURRENT SCHEMA
  // Note: Since schema only supports 'hit' and 'stand', we convert split/double to hit
  if (canSplitOption && isPair) {
    const pairValue = playerCards[0];
    
    switch (pairValue) {
      case 1: // Aces - would split, but hit for now
      case 8: // Eights - would split, but hit for now
        return 'hit';
      case 2:
      case 3:
      case 7:
        return dealerUpcard <= 7 ? 'hit' : 'hit'; // Would split vs hit
      case 4:
        return dealerUpcard === 5 || dealerUpcard === 6 ? 'hit' : 'hit'; // Would split vs hit
      case 5:
        return 'hit'; // Never split 5s, would double but hit instead
      case 6:
        return dealerUpcard <= 6 ? 'hit' : 'hit'; // Would split vs hit
      case 9:
        return (dealerUpcard <= 6 || (dealerUpcard >= 8 && dealerUpcard <= 9)) ? 'hit' : 'stand'; // Would split vs stand
      case 10:
        return 'stand'; // Never split 10s
    }
  }
  
  // Soft hands (hands with an ace counted as 11)
  if (isSoft && playerValue <= 21) {
    return getSoftHandStrategy(playerValue, dealerUpcard, canDoubleOption);
  }
  
  // Hard hands
  return getHardHandStrategy(playerValue, dealerUpcard, canDoubleOption);
}

function hasSoftAce(cards: number[]): boolean {
  const hasAce = cards.includes(1);
  if (!hasAce) return false;
  
  // Calculate if ace is being used as 11
  let value = 0;
  let aces = 0;
  
  for (const card of cards) {
    if (card === 1) {
      aces++;
      value += 11;
    } else {
      value += card;
    }
  }
  
  // If we don't need to convert any aces to 1, it's soft
  return value <= 21;
}

function getSoftHandStrategy(playerValue: number, dealerUpcard: number, canDouble: boolean): TAction {
  // Soft 20, 21 - always stand
  if (playerValue >= 20) return 'stand';
  
  // Soft 19 (A,8) - would double vs 6, but hit instead since no double in schema
  if (playerValue === 19) {
    return (canDouble && dealerUpcard === 6) ? 'hit' : 'stand'; // Would double but hit
  }
  
  // Soft 18 (A,7)
  if (playerValue === 18) {
    if (dealerUpcard <= 6) {
      return canDouble ? 'hit' : 'stand'; // Would double but hit
    } else if (dealerUpcard <= 8) {
      return 'stand';
    } else {
      return 'hit';
    }
  }
  
  // Soft 17 (A,6) - would double vs 3-6, but hit instead
  if (playerValue === 17) {
    return (canDouble && (dealerUpcard >= 3 && dealerUpcard <= 6)) ? 'hit' : 'hit'; // Would double but hit
  }
  
  // Soft 16 (A,5) - would double vs 4-6, but hit instead
  if (playerValue === 16) {
    return (canDouble && (dealerUpcard >= 4 && dealerUpcard <= 6)) ? 'hit' : 'hit'; // Would double but hit
  }
  
  // Soft 15 (A,4) - would double vs 4-6, but hit instead
  if (playerValue === 15) {
    return (canDouble && (dealerUpcard >= 4 && dealerUpcard <= 6)) ? 'hit' : 'hit'; // Would double but hit
  }
  
  // Soft 14 (A,3) - would double vs 5-6, but hit instead
  if (playerValue === 14) {
    return (canDouble && (dealerUpcard >= 5 && dealerUpcard <= 6)) ? 'hit' : 'hit'; // Would double but hit
  }
  
  // Soft 13 (A,2) - would double vs 5-6, but hit instead
  if (playerValue === 13) {
    return (canDouble && (dealerUpcard >= 5 && dealerUpcard <= 6)) ? 'hit' : 'hit'; // Would double but hit
  }
  
  // Default for other soft hands
  return 'hit';
}

function getHardHandStrategy(playerValue: number, dealerUpcard: number, canDouble: boolean): TAction {
  // 21 - always stand
  if (playerValue >= 21) return 'stand';
  
  // 17-20 - always stand
  if (playerValue >= 17) return 'stand';
  
  // 16
  if (playerValue === 16) {
    return dealerUpcard <= 6 ? 'stand' : 'hit';
  }
  
  // 15
  if (playerValue === 15) {
    return dealerUpcard <= 6 ? 'stand' : 'hit';
  }
  
  // 14
  if (playerValue === 14) {
    return dealerUpcard <= 6 ? 'stand' : 'hit';
  }
  
  // 13
  if (playerValue === 13) {
    return dealerUpcard <= 6 ? 'stand' : 'hit';
  }
  
  // 12
  if (playerValue === 12) {
    return (dealerUpcard >= 4 && dealerUpcard <= 6) ? 'stand' : 'hit';
  }
  
  // 11 - would double but just hit for simplicity
  if (playerValue === 11) {
    return 'hit'; // Would double but keeping it simple
  }
  
  // 10 - would double vs 2-9 but just hit for simplicity
  if (playerValue === 10) {
    return 'hit'; // Would double vs weak dealer cards but keeping it simple
  }
  
  // 9 - would double vs 3-6 but just hit for simplicity
  if (playerValue === 9) {
    return 'hit'; // Would double vs weak dealer cards but keeping it simple
  }
  
  // 8 or less - always hit
  return 'hit';
}