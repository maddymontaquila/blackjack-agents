// Blackjack rules and hand value calculations
export function calculateHandValue(cards: number[]): number {
  let value = 0;
  let aces = 0;
  
  for (const card of cards) {
    if (card === 1) {
      aces++;
      value += 11; // Initially count aces as 11
    } else {
      value += card;
    }
  }
  
  // Convert aces from 11 to 1 if hand would bust
  while (value > 21 && aces > 0) {
    value -= 10;
    aces--;
  }
  
  return value;
}

export function isBlackjack(cards: number[]): boolean {
  return cards.length === 2 && calculateHandValue(cards) === 21;
}

export function isBust(cards: number[]): boolean {
  return calculateHandValue(cards) > 21;
}

export function canSplit(cards: number[]): boolean {
  return cards.length === 2 && cards[0] === cards[1];
}

export function canDouble(cards: number[]): boolean {
  return cards.length === 2;
}

export function shouldDealerHit(dealerCards: number[]): boolean {
  const value = calculateHandValue(dealerCards);
  
  // Dealer hits on soft 17 in most casinos
  if (value === 17) {
    // Check if it's a soft 17 (contains an ace counted as 11)
    let hasAceAsEleven = false;
    let tempValue = 0;
    let aces = 0;
    
    for (const card of dealerCards) {
      if (card === 1) {
        aces++;
        tempValue += 11;
      } else {
        tempValue += card;
      }
    }
    
    // If we had to convert an ace to avoid busting, it's soft
    while (tempValue > 21 && aces > 0) {
      tempValue -= 10;
      aces--;
      if (tempValue === 17) {
        hasAceAsEleven = true;
      }
    }
    
    return hasAceAsEleven; // Hit on soft 17, stand on hard 17
  }
  
  return value < 17;
}

export type HandResult = 'win' | 'lose' | 'push';

export function determineHandResult(playerCards: number[], dealerCards: number[]): HandResult {
  const playerValue = calculateHandValue(playerCards);
  const dealerValue = calculateHandValue(dealerCards);
  const playerBlackjack = isBlackjack(playerCards);
  const dealerBlackjack = isBlackjack(dealerCards);
  
  // Player busted
  if (isBust(playerCards)) {
    return 'lose';
  }
  
  // Dealer busted, player didn't
  if (isBust(dealerCards)) {
    return 'win';
  }
  
  // Both have blackjack
  if (playerBlackjack && dealerBlackjack) {
    return 'push';
  }
  
  // Player has blackjack, dealer doesn't
  if (playerBlackjack && !dealerBlackjack) {
    return 'win';
  }
  
  // Dealer has blackjack, player doesn't
  if (!playerBlackjack && dealerBlackjack) {
    return 'lose';
  }
  
  // Neither has blackjack, compare values
  if (playerValue > dealerValue) {
    return 'win';
  } else if (playerValue < dealerValue) {
    return 'lose';
  } else {
    return 'push';
  }
}