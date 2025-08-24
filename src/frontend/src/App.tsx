import { useState, useEffect } from 'react'
import './App.css'
import { backendClient, type BackendState } from './services/backendClient';
import { valuesToCards, calculateHandValue, type Card } from './utils/cardUtils';

// Types for frontend UI
export interface UIPlayer {
  name: string;
  hand: Card[];
  handValue: number;
  isStanding: boolean;
  isBusted: boolean;
  result?: 'win' | 'lose' | 'push';
  bet?: number;
  seat: number;
}

export interface UIDealer {
  name: string;
  hand: Card[];
  visibleHand: Card[]; // What the players can see
  handValue: number;
  visibleValue: number;
  isStanding: boolean;
  isBusted: boolean;
}

export interface UIGameState {
  dealer: UIDealer;
  players: UIPlayer[];
  currentPlayerIndex: number;
  gamePhase: string;
  handNumber: number;
  results: Array<{ seat: number; result: 'win' | 'lose' | 'push'; payout: number }>;
}

// Convert backend state to UI state
function convertBackendState(backendState: BackendState): UIGameState {
  const dealer: UIDealer = {
    name: 'Dealer',
    hand: valuesToCards(backendState.dealer.cards),
    visibleHand: valuesToCards(backendState.dealer.visibleCards),
    handValue: calculateHandValue(backendState.dealer.cards),
    visibleValue: calculateHandValue(backendState.dealer.visibleCards),
    isStanding: backendState.dealer.isStanding,
    isBusted: backendState.dealer.isBusted
  };

  const players: UIPlayer[] = backendState.snap.players.map(p => ({
    name: p.id,
    hand: valuesToCards(p.visibleCards),
    handValue: calculateHandValue(p.visibleCards),
    isStanding: !backendState.seats.find(s => s.seat === p.seat)?.isActive || false,
    isBusted: calculateHandValue(p.visibleCards) > 21,
    result: undefined, // Will be set during settling
    bet: p.bet,
    seat: p.seat
  }));

  return {
    dealer,
    players,
    currentPlayerIndex: backendState.currentPlayerIndex,
    gamePhase: backendState.status,
    handNumber: backendState.snap.handNumber,
    results: []
  };
}

// Components
function PlayingCard({ card, isHidden = false }: { card: Card; isHidden?: boolean }) {
  const suitSymbols = {
    hearts: '♥',
    diamonds: '♦',
    clubs: '♣',
    spades: '♠'
  };

  const isRed = card.suit === 'hearts' || card.suit === 'diamonds';

  if (isHidden) {
    return (
      <div className="playing-card hidden-card">
        <div className="card-back">
          <div className="card-back-pattern"></div>
        </div>
        <div className="card-face">
          <div className={`card-rank ${isRed ? 'red' : 'black'}`}>{card.rank}</div>
          <div className={`card-suit ${isRed ? 'red' : 'black'}`}>{suitSymbols[card.suit]}</div>
        </div>
      </div>
    );
  }

  return (
    <div className={`playing-card ${isRed ? 'red' : 'black'}`}>
      <div className="card-rank">{card.rank}</div>
      <div className="card-suit">{suitSymbols[card.suit]}</div>
    </div>
  );
}

function PlayerHand({ 
  player, 
  isActive, 
  onHit, 
  onStand 
}: { 
  player: UIPlayer;
  isActive: boolean;
  onHit: (seat: number) => void;
  onStand: (seat: number) => void;
}) {
  const canTakeAction = isActive && !player.isStanding && !player.isBusted && player.handValue < 21;

  return (
    <div className={`player-section ${isActive ? 'active-player' : ''} ${player.result ? `result-${player.result}` : ''}`}>
      <h3 className="player-name">{player.name}</h3>
      <div className="hand">
        {player.hand.map((card, index) => (
          <PlayingCard key={card.id || `card-${index}`} card={card} />
        ))}
        {player.hand.length === 0 && <div className="empty-hand">No cards</div>}
      </div>
      {player.hand.length > 0 && (
        <div className="hand-info">
          <div className={`hand-value ${player.isBusted ? 'busted' : ''}`}>
            Value: {player.handValue}
            {player.isBusted && ' (BUST)'}
            {player.isStanding && ' (STAND)'}
          </div>
          {player.result && (
            <div className={`game-result result-${player.result}`}>
              {player.result === 'win' && '🎉 WIN!'}
              {player.result === 'lose' && '💸 LOSE'}
              {player.result === 'push' && '🤝 PUSH'}
            </div>
          )}
        </div>
      )}
      {canTakeAction && (
        <div className="player-actions">
          <button 
            className="action-button hit-button" 
            onClick={() => onHit(player.seat)}
          >
            Hit
          </button>
          <button 
            className="action-button stand-button" 
            onClick={() => onStand(player.seat)}
          >
            Stand
          </button>
        </div>
      )}
    </div>
  );
}

function DealerSection({ dealer, gamePhase }: { dealer: UIDealer; gamePhase: string }) {
  const showFullValue = gamePhase === 'dealer' || gamePhase === 'settling' || gamePhase === 'finished';
  const displayHand = showFullValue ? dealer.hand : dealer.visibleHand;
  const displayValue = showFullValue ? dealer.handValue : dealer.visibleValue;
  
  return (
    <div className="dealer-section">
      <h2 className="dealer-name">{dealer.name}</h2>
      <div className="hand">
        {displayHand.map((card, index) => (
          <PlayingCard 
            key={card.id || `dealer-card-${index}`} 
            card={card} 
            isHidden={!showFullValue && index === 1 && dealer.hand.length >= 2} 
          />
        ))}
        {displayHand.length === 0 && <div className="empty-hand">No cards</div>}
      </div>
      {displayHand.length > 0 && (
        <div className="hand-info">
          <div className={`hand-value ${dealer.isBusted ? 'busted' : ''}`}>
            {showFullValue ? (
              <>
                Value: {displayValue}
                {dealer.isBusted && ' (BUST)'}
                {dealer.isStanding && !dealer.isBusted && ' (STAND)'}
              </>
            ) : (
              `Showing: ${displayValue}`
            )}
          </div>
        </div>
      )}
      {gamePhase === 'dealer' && !dealer.isStanding && !dealer.isBusted && (
        <div className="dealer-status">
          <p>Dealer is playing...</p>
        </div>
      )}
    </div>
  );
}

function App() {
  const [gameState, setGameState] = useState<UIGameState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');

  // Load initial state and connect to WebSocket
  useEffect(() => {
    const initialize = async () => {
      try {
        setConnectionStatus('connecting');
        setIsLoading(true);
        
        // Get initial state
        const backendState = await backendClient.getState();
        setGameState(convertBackendState(backendState));
        
        // Connect to WebSocket for real-time updates
        await backendClient.connectWebSocket();
        setConnectionStatus('connected');
        
        // Listen for state updates
        backendClient.addEventListener('state', (data) => {
          if (data.state) {
            setGameState(convertBackendState(data.state));
          }
        });
        
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to connect to backend');
        setConnectionStatus('disconnected');
      } finally {
        setIsLoading(false);
      }
    };

    initialize();

    // Cleanup
    return () => {
      backendClient.disconnectWebSocket();
    };
  }, []);

  const startNewHand = async () => {
    try {
      setIsLoading(true);
      await backendClient.startNextHand();
      // State will be updated via WebSocket
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start new hand');
    } finally {
      setIsLoading(false);
    }
  };

  const startDecisions = async () => {
    try {
      setIsLoading(true);
      await backendClient.startDecisions();
      // State will be updated via WebSocket
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start decisions');
    } finally {
      setIsLoading(false);
    }
  };

  const handleHit = async (seat: number) => {
    try {
      setIsLoading(true);
      const result = await backendClient.playerAction(seat, 'hit');
      setGameState(convertBackendState(result.state));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to hit');
    } finally {
      setIsLoading(false);
    }
  };

  const handleStand = async (seat: number) => {
    try {
      setIsLoading(true);
      const result = await backendClient.playerAction(seat, 'stand');
      setGameState(convertBackendState(result.state));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stand');
    } finally {
      setIsLoading(false);
    }
  };

  const playDealerHand = async () => {
    try {
      setIsLoading(true);
      const result = await backendClient.dealerPlay();
      const newState = convertBackendState(result.state);
      // Apply results to players
      result.results.forEach(r => {
        const player = newState.players.find(p => p.seat === r.seat);
        if (player) {
          player.result = r.result;
        }
      });
      setGameState(newState);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to play dealer hand');
    } finally {
      setIsLoading(false);
    }
  };

  const clearError = () => setError(null);

  if (isLoading && !gameState) {
    return (
      <div className="blackjack-table">
        <div className="game-header">
          <h1>Blackjack Table</h1>
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  if (error && !gameState) {
    return (
      <div className="blackjack-table">
        <div className="game-header">
          <h1>Blackjack Table</h1>
          <div className="error-message">
            <p>Error: {error}</p>
            <button onClick={() => window.location.reload()}>Retry</button>
          </div>
        </div>
      </div>
    );
  }

  if (!gameState) {
    return null;
  }

  const canDeal = gameState.gamePhase === 'waiting' || gameState.gamePhase === 'finished';
  const canStartDecisions = gameState.gamePhase === 'dealing' || gameState.gamePhase === 'table-talk';
  const canPlayDealer = gameState.gamePhase === 'decisions' && gameState.currentPlayerIndex === -1;

  return (
    <div className="blackjack-table">
      <div className="game-header">
        <h1>Blackjack Table</h1>
        <div className="connection-status">
          Status: <span className={`status-${connectionStatus}`}>{connectionStatus}</span>
        </div>
        {error && (
          <div className="error-banner">
            {error}
            <button onClick={clearError}>×</button>
          </div>
        )}
        <div className="controls">
          <button 
            className="deal-button" 
            onClick={startNewHand}
            disabled={!canDeal || isLoading}
          >
            Deal New Hand
          </button>
          {canStartDecisions && (
            <button 
              className="start-decisions-button" 
              onClick={startDecisions}
              disabled={isLoading}
            >
              Start Decisions
            </button>
          )}
          {canPlayDealer && (
            <button 
              className="dealer-play-button" 
              onClick={playDealerHand}
              disabled={isLoading}
            >
              Play Dealer Hand
            </button>
          )}
        </div>
        <div className="game-info">
          <p>Hand Number: {gameState.handNumber}</p>
          <p>Phase: {gameState.gamePhase}</p>
          {gameState.currentPlayerIndex >= 0 && (
            <p>Current Player: {gameState.players[gameState.currentPlayerIndex]?.name}</p>
          )}
        </div>
      </div>

      <DealerSection dealer={gameState.dealer} gamePhase={gameState.gamePhase} />
      
      <div className="players-section">
        {gameState.players.map((player, index) => (
          <PlayerHand 
            key={player.seat} 
            player={player}
            isActive={gameState.currentPlayerIndex === player.seat && gameState.gamePhase === 'decisions'}
            onHit={handleHit}
            onStand={handleStand}
          />
        ))}
      </div>
    </div>
  );
}

export default App
