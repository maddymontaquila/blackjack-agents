// Utility functions to convert between backend card values (1-10) and frontend card objects

export type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades';
export type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';

export interface Card {
  suit: Suit;
  rank: Rank;
  id: string;
}

const suits: Suit[] = ['hearts', 'diamonds', 'clubs', 'spades'];

// Convert backend card value to frontend Card object
export function valueToCard(value: number, index: number = 0): Card {
  let rank: Rank;
  
  if (value === 1) {
    rank = 'A';
  } else if (value === 10) {
    // Randomly assign 10, J, Q, K for display purposes
    const tenValues: Rank[] = ['10', 'J', 'Q', 'K'];
    rank = tenValues[index % 4];
  } else {
    rank = value.toString() as Rank;
  }
  
  const suit = suits[index % 4];
  
  return {
    suit,
    rank,
    id: `${suit}-${rank}-${index}`
  };
}

// Convert array of backend card values to frontend Card objects
export function valuesToCards(values: number[]): Card[] {
  return values.map((value, index) => valueToCard(value, index));
}

// Calculate hand value from backend values
export function calculateHandValue(values: number[]): number {
  let value = 0;
  let aces = 0;
  
  for (const cardValue of values) {
    if (cardValue === 1) {
      aces++;
      value += 11; // Initially count aces as 11
    } else {
      value += cardValue;
    }
  }
  
  // Convert aces from 11 to 1 if hand would bust
  while (value > 21 && aces > 0) {
    value -= 10;
    aces--;
  }
  
  return value;
}