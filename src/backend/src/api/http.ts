import express from 'express';
import { TableState } from '../engine/state.js';
import { eventsBroadcaster } from './ws.js';
import { AgentClient } from '../mcp/httpClient.js';
import { loadConfig } from '../config.js';

const router = express.Router();

// Initialize agent clients from configuration
const config = loadConfig();
const agentClients = new Map<number, AgentClient>();

// Set up Pat Python on seat 0
agentClients.set(0, new AgentClient(config.agents.pat.url, config.agents.pat.timeouts, 'Pat Python'));

// TODO: Add other agents when ready
// agentClients.set(1, new AgentClient(config.agents.dee.url, config.agents.dee.timeouts, 'Dee DotNet'));
// agentClients.set(2, new AgentClient(config.agents.tom.url, config.agents.tom.timeouts, 'Tom TypeScript'));

// Global table state with agent clients
const tableState = new TableState(agentClients);

// GET /state - Get current table state
router.get('/state', (req, res) => {
  try {
    const state = tableState.getState();
    res.json(state);
  } catch (error) {
    console.error('Error getting state:', error);
    console.error('Stack trace:', error instanceof Error ? error.stack : 'No stack trace available');
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
    console.error('Stack trace:', error instanceof Error ? error.stack : 'No stack trace available');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /bet - Place a bet (manual)
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
    return res.json({ success: true, state });
  } catch (error) {
    console.error('Error placing bet:', error);
    console.error('Stack trace:', error instanceof Error ? error.stack : 'No stack trace available');
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /agent-bets - Place bets for all agents - ENHANCED WITH DEBUG INFO
router.post('/agent-bets', async (req, res) => {
  console.log('DEBUG: /agent-bets endpoint called');
  try {
    const startTime = Date.now();
    
    // IMMEDIATELY set the flag and broadcast so button disappears
    console.log('DEBUG: Setting agentBettingInitiated flag and broadcasting state');
    tableState.markAgentBettingInitiated();
    
    // Verify the flag is set in the state
    const immediateState = tableState.getState();
    console.log('DEBUG: State after setting flag:');
    console.log('  - phase:', immediateState.status);
    console.log('  - agentBettingInitiated:', immediateState.debug?.agentBettingInitiated);
    console.log('  - debug object keys:', Object.keys(immediateState.debug || {}));
    
    eventsBroadcaster.broadcastState(); // Broadcast immediately so button disappears
    
    // Broadcast that betting process is starting
    eventsBroadcaster.broadcastDebug({
      operation: 'agent-betting',
      status: 'starting',
      timestamp: startTime,
      phase: tableState.getState().status
    });
    
    await tableState.placeBetsForAllAgents();
    const endTime = Date.now();
    console.log(`DEBUG: placeBetsForAllAgents completed in ${endTime - startTime}ms`);
    
    const state = tableState.getState();
    eventsBroadcaster.broadcastState(); // Broadcast updated state again after completion
    
    // Broadcast completion status
    eventsBroadcaster.broadcastDebug({
      operation: 'agent-betting',
      status: 'completed',
      duration: endTime - startTime,
      timestamp: endTime,
      bettingCompletion: state.debug?.bettingCompletion
    });
    
    console.log('DEBUG: Broadcasting state and returning response');
    return res.json({ success: true, state, debug: { duration: endTime - startTime } });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error placing agent bets:', error);
    console.error('Stack trace:', error instanceof Error ? error.stack : 'No stack trace available');
    
    // Broadcast error with context
    eventsBroadcaster.broadcastErrorWithContext('Agent betting failed', {
      phase: tableState.getState().status,
      operation: 'agent-betting'
    });
    
    return res.status(500).json({ error: 'Agent betting failed', details: errorMsg });
  }
});

// POST /start-dealing - Start dealing cards (after betting phase) - ENHANCED
router.post('/start-dealing', async (req, res) => {
  try {
    const startTime = Date.now();
    
    eventsBroadcaster.broadcastDebug({
      operation: 'start-dealing',
      status: 'starting',
      timestamp: startTime
    });
    
    await tableState.startDealing();
    const state = tableState.getState();
    const endTime = Date.now();
    
    console.log('Cards dealt and full automation completed, handNumber:', state.snap.handNumber, 'phase:', state.status);
    console.log('Players have cards:', state.snap.players.map(p => ({ id: p.id, cardCount: p.visibleCards.length, bet: p.bet })));
    console.log('Dealer has cards:', state.dealer.cards.length);
    
    eventsBroadcaster.broadcastDeal(state.snap); // Broadcast deal event
    eventsBroadcaster.broadcastDebug({
      operation: 'start-dealing',
      status: 'completed',
      duration: endTime - startTime,
      timestamp: endTime,
      cardsDealt: state.snap.players.reduce((sum, p) => sum + p.visibleCards.length, 0) + state.dealer.cards.length
    });
    
    res.json({ ok: true, state, debug: { duration: endTime - startTime } });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error starting dealing:', error);
    console.error('Stack trace:', error instanceof Error ? error.stack : 'No stack trace available');
    
    eventsBroadcaster.broadcastErrorWithContext('Dealing failed', {
      phase: tableState.getState().status,
      operation: 'start-dealing'
    });
    
    res.status(500).json({ error: 'Dealing failed', details: errorMsg });
  }
});

// POST /start-decisions - Start decision phase after cards are dealt
router.post('/start-decisions', async (req, res) => {
  try {
    const startTime = Date.now();
    
    eventsBroadcaster.broadcastDebug({
      operation: 'start-decisions',
      status: 'starting',
      timestamp: startTime
    });
    
    await tableState.startDecisionPhase();
    const state = tableState.getState();
    const endTime = Date.now();
    
    console.log('Decision phase started, handNumber:', state.snap.handNumber, 'phase:', state.status);
    console.log('Current player index:', state.currentPlayerIndex);
    
    eventsBroadcaster.broadcastState(); // Broadcast updated state
    eventsBroadcaster.broadcastDebug({
      operation: 'start-decisions',
      status: 'completed',
      duration: endTime - startTime,
      timestamp: endTime,
      currentPlayer: state.currentPlayerIndex
    });
    
    res.json({ ok: true, state, debug: { duration: endTime - startTime } });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error starting decisions:', error);
    console.error('Stack trace:', error instanceof Error ? error.stack : 'No stack trace available');
    
    eventsBroadcaster.broadcastErrorWithContext('Decision phase failed to start', {
      phase: tableState.getState().status,
      operation: 'start-decisions'
    });
    
    res.status(500).json({ error: 'Decision phase failed to start', details: errorMsg });
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
    return res.json({ success: true, state });
  } catch (error) {
    console.error('Error applying action:', error);
    console.error('Stack trace:', error instanceof Error ? error.stack : 'No stack trace available');
    return res.status(500).json({ error: 'Internal server error' });
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
    console.error('Stack trace:', error instanceof Error ? error.stack : 'No stack trace available');
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
    console.error('Stack trace:', error instanceof Error ? error.stack : 'No stack trace available');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Table talk endpoint removed - agents chat during betting and decisions now

// POST /agent-decisions - Process all agent decisions automatically
router.post('/agent-decisions', async (req, res) => {
  try {
    // Check if decision processing is already in progress
    const state = tableState.getState();
    if (state.debug?.decisionProcessingInProgress) {
      return res.status(409).json({ error: 'Agent decisions are already being processed' });
    }
    
    await tableState.processAllAgentDecisions();
    const finalState = tableState.getState();
    eventsBroadcaster.broadcastState(); // Broadcast updated state
    return res.json({ success: true, state: finalState });
  } catch (error) {
    console.error('Error processing agent decisions:', error);
    console.error('Stack trace:', error instanceof Error ? error.stack : 'No stack trace available');
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /play-full-hand - Automated full hand: bet -> deal -> talk -> decide -> dealer -> settle
router.post('/play-full-hand', async (req, res) => {
  try {
    console.log('Starting automated full hand...');
    
    // Start new hand (betting phase)
    tableState.startNewHand();
    eventsBroadcaster.broadcastState();
    
    // Place bets for all agents
    await tableState.placeBetsForAllAgents();
    eventsBroadcaster.broadcastState();
    
    // Start dealing (this will automatically trigger table talk -> decisions -> dealer -> settle)
    await tableState.startDealing();
    eventsBroadcaster.broadcastDeal(tableState.getState().snap);
    
    const state = tableState.getState();
    res.json({ success: true, message: 'Full hand automation completed', state });
  } catch (error) {
    console.error('Error in automated full hand:', error);
    console.error('Stack trace:', error instanceof Error ? error.stack : 'No stack trace available');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export { router as httpRouter, tableState };