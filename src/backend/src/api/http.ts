import express from 'express';
import { TableState } from '../engine/state.js';
import { eventsBroadcaster } from './ws.js';

const router = express.Router();

// Global table state (in production this would be more sophisticated)
const tableState = new TableState();

// GET /state - Get current table state
router.get('/state', (req, res) => {
  try {
    const state = tableState.getState();
    res.json(state);
  } catch (error) {
    console.error('Error getting state:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /next - Start next hand
router.post('/next', (req, res) => {
  try {
    console.log('Starting new hand (betting phase)...');
    tableState.startNewHand();
    const state = tableState.getState();
    console.log('New hand started, handNumber:', state.snap.handNumber, 'phase:', state.status);
    eventsBroadcaster.broadcastState(); // Broadcast updated state
    res.json({ startedHand: state.snap.handNumber });
  } catch (error) {
    console.error('Error starting next hand:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /bet - Place a bet
router.post('/bet', (req, res) => {
  try {
    const { seat, amount } = req.body;
    
    if (typeof seat !== 'number' || typeof amount !== 'number') {
      return res.status(400).json({ error: 'Invalid seat or amount' });
    }
    
    const success = tableState.placeBet(seat, amount);
    if (!success) {
      return res.status(400).json({ error: 'Invalid bet amount or game phase' });
    }
    
    const state = tableState.getState();
    eventsBroadcaster.broadcastState(); // Broadcast updated state
    res.json({ success: true, state });
  } catch (error) {
    console.error('Error placing bet:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /start-dealing - Start dealing cards (after betting phase)
router.post('/start-dealing', (req, res) => {
  try {
    tableState.startDealing();
    const state = tableState.getState();
    console.log('Cards dealt, handNumber:', state.snap.handNumber, 'phase:', state.status);
    console.log('Players have cards:', state.snap.players.map(p => ({ id: p.id, cardCount: p.visibleCards.length, bet: p.bet })));
    console.log('Dealer has cards:', state.dealer.cards.length);
    eventsBroadcaster.broadcastDeal(state.snap); // Broadcast deal event
    res.json({ ok: true, state });
  } catch (error) {
    console.error('Error starting dealing:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal server error' });
  }
});

// POST /start-decisions - Move to decision phase (for manual play)
router.post('/start-decisions', (req, res) => {
  try {
    tableState.startDecisionPhase();
    eventsBroadcaster.broadcastState(); // Broadcast updated state
    res.json({ ok: true });
  } catch (error) {
    console.error('Error starting decisions:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /action - Manual player action
router.post('/action', (req, res) => {
  try {
    const { seat, action } = req.body;
    
    if (typeof seat !== 'number' || !['hit', 'stand', 'double', 'split'].includes(action)) {
      return res.status(400).json({ error: 'Invalid seat or action' });
    }
    
    const success = tableState.applyPlayerAction(seat, action);
    if (!success) {
      return res.status(400).json({ error: 'Action not allowed' });
    }
    
    const state = tableState.getState();
    eventsBroadcaster.broadcastState(); // Broadcast updated state
    res.json({ success: true, state });
  } catch (error) {
    console.error('Error applying action:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /dealer-play - Make dealer play (for manual mode)
router.post('/dealer-play', (req, res) => {
  try {
    tableState.playDealerHand();
    const results = tableState.settleHands();
    const state = tableState.getState();
    
    res.json({ results, state });
  } catch (error) {
    console.error('Error playing dealer hand:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /health - Health check
router.get('/health', (req, res) => {
  res.json({ ok: true, service: 'blackjack-backend' });
});

// POST /reset - Reset entire game state
router.post('/reset', (req, res) => {
  try {
    console.log('Resetting entire game state...');
    tableState.resetEntireGame();
    const state = tableState.getState();
    console.log('Game state reset, handNumber:', state.snap.handNumber, 'phase:', state.status);
    eventsBroadcaster.broadcastState(); // Broadcast updated state
    res.json({ success: true, message: 'Game state reset to initial conditions', state });
  } catch (error) {
    console.error('Error resetting game state:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export { router as httpRouter, tableState };