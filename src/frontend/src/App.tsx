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
  bet: number;
  balance: number;
  seat: number;
  hasBet: boolean;
  currentMessage?: string;
  isTyping: boolean;
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
  chatMessages: Array<{ from: string; text: string }>;
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

  const players: UIPlayer[] = backendState.snap.players.map(p => {
    // Find the current message for this player from recent chat
    const recentMessage = backendState.snap.chat
      .filter(msg => msg.from === p.id)
      .slice(-1)[0]; // Get the most recent message from this player
    
    return {
      name: p.id,
      hand: valuesToCards(p.visibleCards),
      handValue: calculateHandValue(p.visibleCards),
      isStanding: !backendState.seats.find(s => s.seat === p.seat)?.isActive || false,
      isBusted: calculateHandValue(p.visibleCards) > 21,
      result: undefined, // Will be set during settling
      bet: p.bet || 0, // Backend now manages bets
      balance: p.balance || 100, // Backend now manages balance
      seat: p.seat,
      hasBet: (p.bet || 0) >= 5, // Minimum $5 bet required
      currentMessage: recentMessage?.text,
      isTyping: false // Will be updated by WebSocket events
    };
  });

  return {
    dealer,
    players,
    currentPlayerIndex: backendState.currentPlayerIndex,
    gamePhase: backendState.status,
    handNumber: backendState.snap.handNumber,
    results: [],
    chatMessages: backendState.snap.chat
  };
}

// Components

function ChatBubble({ 
  message, 
  isTyping = false, 
  playerName 
}: { 
  message?: string; 
  isTyping?: boolean;
  playerName: string;
}) {
  const [displayText, setDisplayText] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);

  // Typewriter effect for streaming messages
  useEffect(() => {
    if (!message) {
      setDisplayText('');
      setCurrentIndex(0);
      return;
    }

    if (currentIndex < message.length) {
      const timer = setTimeout(() => {
        setDisplayText(message.slice(0, currentIndex + 1));
        setCurrentIndex(currentIndex + 1);
      }, 30); // Adjust speed here (ms per character)
      
      return () => clearTimeout(timer);
    }
  }, [message, currentIndex]);

  // Reset when message changes
  useEffect(() => {
    setCurrentIndex(0);
    setDisplayText('');
  }, [message]);

  if (!message && !isTyping) return null;

  return (
    <div className="chat-bubble-container">
      <div className={`chat-bubble ${isTyping ? 'typing' : 'message'}`}>
        {isTyping ? (
          <div className="typing-indicator">
            <span className="typing-dots">
              <span></span>
              <span></span>
              <span></span>
            </span>
          </div>
        ) : (
          <>
            <div className="chat-text">{displayText}</div>
            {currentIndex < (message?.length || 0) && (
              <span className="cursor">|</span>
            )}
          </>
        )}
      </div>
      <div className="chat-bubble-tail"></div>
    </div>
  );
}

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

function Chip({ value, onClick, count = 1 }: { value: number; onClick?: () => void; count?: number }) {
  const getChipColor = (value: number) => {
    switch (value) {
      case 1: return 'chip-white';
      case 5: return 'chip-red';
      case 25: return 'chip-green';
      case 100: return 'chip-black';
      default: return 'chip-blue';
    }
  };

  return (
    <div 
      className={`chip ${getChipColor(value)} ${onClick ? 'chip-clickable' : ''}`}
      onClick={onClick}
    >
      <div className="chip-value">${value}</div>
      {count > 1 && <div className="chip-count">{count}</div>}
    </div>
  );
}

function BettingControls({ 
  player, 
  onBetChange, 
  minBet = 5,
  isActive = false 
}: { 
  player: UIPlayer;
  onBetChange: (seat: number, newBet: number) => void;
  minBet?: number;
  isActive?: boolean;
}) {
  const chipValues = [5, 25, 100];
  // Available balance is current balance + current bet (since bet will be replaced)
  const availableBalance = player.balance + player.bet;
  
  const increaseBet = (amount: number) => {
    const newBet = Math.min(player.bet + amount, availableBalance);
    onBetChange(player.seat, newBet);
  };

  const decreaseBet = (amount: number) => {
    const newBet = Math.max(player.bet - amount, 0);
    onBetChange(player.seat, newBet);
  };

  const setBet = (amount: number) => {
    const newBet = Math.min(amount, availableBalance);
    onBetChange(player.seat, newBet);
  };

  const canBet = isActive && availableBalance >= minBet;
  const canIncrease = canBet && player.bet < availableBalance;
  const canDecrease = canBet && player.bet > 0;

  return (
    <div className="betting-controls">
      <div className="current-bet">
        <h4>Current Bet</h4>
        <div className="bet-chips">
          {player.bet > 0 ? (
            <div className="bet-display">
              <Chip value={player.bet} />
            </div>
          ) : (
            <div className="no-bet">No bet placed</div>
          )}
        </div>
      </div>
      
      {canBet && (
        <div className="betting-actions">
          <div className="bet-adjustments">
            <button 
              className="bet-button decrease" 
              onClick={() => decreaseBet(5)}
              disabled={!canDecrease}
            >
              -$5
            </button>
            <button 
              className="bet-button increase" 
              onClick={() => increaseBet(5)}
              disabled={!canIncrease}
            >
              +$5
            </button>
          </div>
          
          <div className="chip-selection">
            <h5>Quick Bet</h5>
            <div className="chips">
              {chipValues.map(value => (
                <Chip 
                  key={value} 
                  value={value} 
                  onClick={() => setBet(value)}
                />
              ))}
            </div>
          </div>
          
          <div className="bet-actions">
            <button 
              className="bet-button clear" 
              onClick={() => setBet(0)}
              disabled={player.bet === 0}
            >
              Clear Bet
            </button>
            <button 
              className="bet-button max" 
              onClick={() => setBet(availableBalance)}
              disabled={player.bet >= availableBalance}
            >
              Max Bet
            </button>
          </div>
        </div>
      )}
      
      {!canBet && availableBalance < minBet && (
        <div className="insufficient-funds">
          Insufficient funds (Need ${minBet})
        </div>
      )}
    </div>
  );
}

function PlayerHand({ 
  player, 
  isActive, 
  onHit, 
  onStand,
  onBetChange,
  gamePhase,
  isBettingPhase = false
}: { 
  player: UIPlayer;
  isActive: boolean;
  onHit: (seat: number) => void;
  onStand: (seat: number) => void;
  onBetChange?: (seat: number, newBet: number) => void;
  gamePhase: string;
  isBettingPhase?: boolean;
}) {
  const canTakeAction = isActive && !player.isStanding && !player.isBusted && player.handValue < 21 && gamePhase === 'decisions';
  const showBettingControls = isBettingPhase && onBetChange && (player.balance + player.bet) >= 5; // Show if in betting phase and has funds

  return (
    <div className={`player-section ${isActive ? 'active-player' : ''} ${player.result ? `result-${player.result}` : ''} ${isBettingPhase ? 'betting-phase' : ''}`}>
      <div className="player-header">
        <h3 className="player-name">{player.name}</h3>
        <div className="balance-display">
          <strong>${player.balance}</strong>
        </div>
      </div>
      
      {/* Chat bubble for player messages */}
      <ChatBubble 
        message={player.currentMessage}
        isTyping={player.isTyping}
        playerName={player.name}
      />
      
      {player.bet > 0 && !isBettingPhase && (
        <div className="bet-display">
          <span>Bet: </span>
          <Chip value={player.bet} />
        </div>
      )}

      {showBettingControls && (
        <BettingControls
          player={player}
          onBetChange={onBetChange}
          isActive={true}
        />
      )}

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

function DealerSection({ dealer, gamePhase, handNumber, connectionStatus }: { dealer: UIDealer; gamePhase: string; handNumber: number; connectionStatus: 'disconnected' | 'connecting' | 'connected' }) {
  const showFullValue = gamePhase === 'dealer' || gamePhase === 'settling' || gamePhase === 'finished';
  const displayValue = showFullValue ? dealer.handValue : dealer.visibleValue;
  
  return (
    <div className="dealer-section">
      <div className="dealer-left">
        <h2 className="dealer-name">{dealer.name}</h2>
        <div className="hand">
          {dealer.hand.map((card, index) => (
            <PlayingCard 
              key={card.id || `dealer-card-${index}`} 
              card={card} 
              isHidden={!showFullValue && index === 1 && dealer.hand.length >= 2} 
            />
          ))}
          {dealer.hand.length === 0 && <div className="empty-hand">No cards</div>}
        </div>
        {dealer.hand.length > 0 && (
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
      <div className="dealer-right">
        <div className="game-status-info">
          <div className="status-item">
            <span className="status-label">Status</span>
            <span className={`status-value status-${connectionStatus}`}>{connectionStatus}</span>
          </div>
          <div className="status-item">
            <span className="status-label">Hand #</span>
            <span className="status-value">{handNumber}</span>
          </div>
          <div className="status-item">
            <span className="status-label">Phase</span>
            <span className="status-value">{gamePhase}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function App() {
  const [gameState, setGameState] = useState<UIGameState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [playerTypingStates, setPlayerTypingStates] = useState<Record<string, boolean>>({});
  const [streamingMessages, setStreamingMessages] = useState<Record<string, string>>({});

  // Helper to update player typing state
  const setPlayerTyping = (playerId: string, isTyping: boolean) => {
    setPlayerTypingStates(prev => ({ ...prev, [playerId]: isTyping }));
  };

  // Helper to update streaming message for a player
  const setPlayerMessage = (playerId: string, message: string) => {
    setStreamingMessages(prev => ({ ...prev, [playerId]: message }));
  };

  // Convert backend state to UI state, incorporating streaming states
  const convertBackendStateWithStreaming = (backendState: BackendState): UIGameState => {
    const convertedState = convertBackendState(backendState);
    
    // Update players with streaming states
    const playersWithStreaming = convertedState.players.map(player => ({
      ...player,
      isTyping: playerTypingStates[player.name] || false,
      currentMessage: streamingMessages[player.name] || player.currentMessage
    }));
    
    return {
      ...convertedState,
      players: playersWithStreaming
    };
  };
  useEffect(() => {
    const initialize = async () => {
      try {
        setConnectionStatus('connecting');
        setIsLoading(true);
        
        // Get initial state
        const backendState = await backendClient.getState();
        setGameState(convertBackendStateWithStreaming(backendState));
        
        // Connect to WebSocket for real-time updates
        await backendClient.connectWebSocket();
        setConnectionStatus('connected');
        
        // Listen for state updates
        backendClient.addEventListener('state', (data) => {
          if (data.state) {
            setGameState(convertBackendStateWithStreaming(data.state));
          }
        });

        // Listen for chat typing indicators
        backendClient.addEventListener('player-typing', (data) => {
          if (data.playerId) {
            setPlayerTyping(data.playerId, data.isTyping);
          }
        });

        // Listen for streaming chat messages
        backendClient.addEventListener('chat-stream', (data) => {
          if (data.playerId && data.text !== undefined) {
            setPlayerMessage(data.playerId, data.text);
            // If message is complete, stop typing indicator
            if (data.complete) {
              setPlayerTyping(data.playerId, false);
            }
          }
        });

        // Listen for new complete chat messages
        backendClient.addEventListener('chat-message', (data) => {
          if (data.from && data.text) {
            setPlayerTyping(data.from, false);
            // Update the game state to include the new message
            setGameState(prev => {
              if (!prev) return prev;
              const newChatMessages = [...prev.chatMessages, { from: data.from, text: data.text }];
              return { ...prev, chatMessages: newChatMessages };
            });
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

  // Auto-play dealer when game phase becomes 'dealer'
  useEffect(() => {
    if (gameState?.gamePhase === 'dealer' && !isLoading) {
      const autoPlayDealer = async () => {
        try {
          setIsLoading(true);
          // Add a small delay for better UX
          setTimeout(async () => {
            try {
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
              setError(err instanceof Error ? err.message : 'Failed to auto-play dealer hand');
            } finally {
              setIsLoading(false);
            }
          }, 1500); // 1.5 second delay to show "Dealer is playing..." message
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to auto-play dealer hand');
          setIsLoading(false);
        }
      };
      
      autoPlayDealer();
    }
  }, [gameState?.gamePhase, isLoading]);

  const startNewHand = async () => {
    try {
      setIsLoading(true);
      // Start betting phase in backend
      await backendClient.startNextHand();
      // Fetch updated state after starting betting phase
      const backendState = await backendClient.getState();
      setGameState(convertBackendState(backendState));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start betting phase');
    } finally {
      setIsLoading(false);
    }
  };

  const placeAgentBets = async () => {
    try {
      setIsLoading(true);
      const result = await backendClient.placeAgentBets();
      setGameState(convertBackendState(result.state));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to place agent bets');
    } finally {
      setIsLoading(false);
    }
  };

  const proceedToDeal = async () => {
    try {
      setIsLoading(true);
      // Start dealing cards after betting phase
      const result = await backendClient.startDealing();
      setGameState(convertBackendState(result.state));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start dealing');
    } finally {
      setIsLoading(false);
    }
  };

  const startDecisions = async () => {
    try {
      setIsLoading(true);
      await backendClient.startDecisions();
      // Fetch updated state after starting decisions
      const backendState = await backendClient.getState();
      setGameState(convertBackendState(backendState));
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

  const handleBetChange = async (seat: number, newBet: number) => {
    try {
      setIsLoading(true);
      const result = await backendClient.placeBet(seat, newBet);
      setGameState(convertBackendState(result.state));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to place bet');
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
  const canPlayDealer = gameState.gamePhase === 'dealer' || (gameState.gamePhase === 'decisions' && gameState.currentPlayerIndex === -1);
  const isBettingPhase = gameState.gamePhase === 'betting';
  const allPlayersBet = gameState.players.every(player => player.bet >= 5); // Minimum bet requirement
  const canStartDealing = gameState.gamePhase === 'betting' && allPlayersBet;

  return (
    <div className="blackjack-table">
      <div className="game-header">
        <h1>Blackjack Table</h1>
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
          {canStartDealing && (
            <button 
              className="proceed-betting-button" 
              onClick={proceedToDeal}
              disabled={isLoading}
            >
              Deal Cards
            </button>
          )}
        </div>
        {isBettingPhase && (
          <div className="betting-phase-controls">
            <button 
              className="agent-bet-button" 
              onClick={placeAgentBets}
              disabled={isLoading}
            >
              🤖 Place AI Agent Bets
            </button>
          </div>
        )}
      </div>

      <DealerSection dealer={gameState.dealer} gamePhase={gameState.gamePhase} handNumber={gameState.handNumber} connectionStatus={connectionStatus} />
      
      <div className="players-section">
        {gameState.players.map((player) => (
          <PlayerHand 
            key={player.seat} 
            player={player}
            isActive={gameState.currentPlayerIndex === player.seat && gameState.gamePhase === 'decisions'}
            onHit={handleHit}
            onStand={handleStand}
            onBetChange={handleBetChange}
            gamePhase={gameState.gamePhase}
            isBettingPhase={isBettingPhase}
          />
        ))}
      </div>
    </div>
  );
}

export default App
