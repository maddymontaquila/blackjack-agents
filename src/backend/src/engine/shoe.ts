// Shoe management - seeded shoe, draw, penetration calculation
export class Shoe {
  private cards: number[] = [];
  private dealt: number = 0;
  private seed: number;

  constructor(seed: number, decks: number = 4) {
    this.seed = seed;
    this.reset(decks);
  }

  reset(decks: number = 4): void {
    this.cards = [];
    this.dealt = 0;
    
    // Create multiple decks with card values 1-10 (A=1, J/Q/K=10)
    for (let deck = 0; deck < decks; deck++) {
      // 4 Aces (value 1)
      for (let i = 0; i < 4; i++) {
        this.cards.push(1);
      }
      
      // Cards 2-9 (4 of each)
      for (let value = 2; value <= 9; value++) {
        for (let i = 0; i < 4; i++) {
          this.cards.push(value);
        }
      }
      
      // 16 ten-value cards (10, J, Q, K)
      for (let i = 0; i < 16; i++) {
        this.cards.push(10);
      }
    }

    this.shuffle();
  }

  private shuffle(): void {
    // Seeded Fisher-Yates shuffle for deterministic results
    let rng = this.mulberry32(this.seed);
    
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
    }
  }

  // Simple seeded RNG based on mulberry32
  private mulberry32(seed: number): () => number {
    return function() {
      let t = seed += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
  }

  draw(): number | null {
    if (this.dealt >= this.cards.length) {
      return null; // Shoe exhausted
    }
    
    const card = this.cards[this.dealt];
    this.dealt++;
    return card;
  }

  getPenetration(): number {
    if (this.cards.length === 0) return 0;
    return this.dealt / this.cards.length;
  }

  getCardsRemaining(): number {
    return this.cards.length - this.dealt;
  }

  // For basic card counting - returns running count
  getRunningCount(): number {
    let count = 0;
    for (let i = 0; i < this.dealt; i++) {
      const card = this.cards[i];
      if (card >= 2 && card <= 6) {
        count += 1; // Low cards
      } else if (card === 10 || card === 1) {
        count -= 1; // High cards and Aces
      }
      // 7, 8, 9 are neutral (count += 0)
    }
    return count;
  }
}