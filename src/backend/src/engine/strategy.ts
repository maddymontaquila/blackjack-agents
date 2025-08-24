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
  
  // Splitting strategy (if allowed and is a pair)
  if (canSplitOption && isPair) {
    const pairValue = playerCards[0];
    
    switch (pairValue) {
      case 1: // Aces
      case 8: // Eights
        return 'split';
      case 2:
      case 3:
      case 7:
        return dealerUpcard <= 7 ? 'split' : 'hit';
      case 4:
        return dealerUpcard === 5 || dealerUpcard === 6 ? 'split' : 'hit';
      case 5:
        return 'double'; // Never split 5s, treat as 10
      case 6:
        return dealerUpcard <= 6 ? 'split' : 'hit';
      case 9:
        return (dealerUpcard <= 6 || (dealerUpcard >= 8 && dealerUpcard <= 9)) ? 'split' : 'stand';
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
  
  // Soft 19 (A,8)
  if (playerValue === 19) {
    return (canDouble && dealerUpcard === 6) ? 'double' : 'stand';
  }
  
  // Soft 18 (A,7)
  if (playerValue === 18) {
    if (dealerUpcard <= 6) {
      return canDouble ? 'double' : 'stand';
    } else if (dealerUpcard <= 8) {
      return 'stand';
    } else {
      return 'hit';
    }
  }
  
  // Soft 17 (A,6)
  if (playerValue === 17) {
    return (canDouble && (dealerUpcard >= 3 && dealerUpcard <= 6)) ? 'double' : 'hit';
  }
  
  // Soft 16 (A,5)
  if (playerValue === 16) {
    return (canDouble && (dealerUpcard >= 4 && dealerUpcard <= 6)) ? 'double' : 'hit';
  }
  
  // Soft 15 (A,4)
  if (playerValue === 15) {
    return (canDouble && (dealerUpcard >= 4 && dealerUpcard <= 6)) ? 'double' : 'hit';
  }
  
  // Soft 14 (A,3)
  if (playerValue === 14) {
    return (canDouble && (dealerUpcard >= 5 && dealerUpcard <= 6)) ? 'double' : 'hit';
  }
  
  // Soft 13 (A,2)
  if (playerValue === 13) {
    return (canDouble && (dealerUpcard >= 5 && dealerUpcard <= 6)) ? 'double' : 'hit';
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
  
  // 11
  if (playerValue === 11) {
    return canDouble ? 'double' : 'hit';
  }
  
  // 10
  if (playerValue === 10) {
    return (canDouble && dealerUpcard <= 9) ? 'double' : 'hit';
  }
  
  // 9
  if (playerValue === 9) {
    return (canDouble && (dealerUpcard >= 3 && dealerUpcard <= 6)) ? 'double' : 'hit';
  }
  
  // 8 or less - always hit
  return 'hit';
}