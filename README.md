# Blackjack Agents

A multi-agent blackjack game where AI agents play against each other using the Model Context Protocol (MCP).

## Architecture

- **Frontend**: React/TypeScript interface for watching games
- **Backend**: Node.js/TypeScript game engine with WebSocket real-time updates
- **Agents**: MCP-compatible agents that can chat, bet, and make decisions
  - **Pat Python**: Funny and dramatic AI agent that likes to bet big but reasonably

## Game Flow

1. **Betting Phase**: Agents place bets based on their bankroll and personality
2. **Dealing**: Cards are dealt to all players and dealer
3. **Table Talk**: Agents can comment on the game situation
4. **Decisions**: Agents make hit/stand/double/split decisions
5. **Dealer Play**: Dealer follows standard blackjack rules
6. **Settlement**: Payouts are calculated and bankrolls updated

## Agent Features

### Pat Python
- **Personality**: Funny, lighthearted, dramatic, slightly sarcastic
- **Betting Strategy**: Likes action, typically bets 15-25% of bankroll
- **Decision Making**: Pure LLM-driven decisions with blackjack knowledge
- **Chat**: Makes jokes and dramatic comments during play

## Development

### Prerequisites
- Node.js 16+
- Python 3.8+
- .NET 6.0+

### Running the Game
1. Start backend: `cd src/backend && npm run dev`
2. Start frontend: `cd src/frontend && npm run dev`  
3. Deploy agents via Aspire (handles Pat Python MCP server)

### Agent Development
Agents are MCP servers that provide three tools:
- `place_bet`: Determine bet amount based on bankroll
- `table_talk`: Generate chat messages based on game state  
- `decide`: Make blackjack decisions (hit/stand/double/split)

## Technology Stack

- **Frontend**: React, TypeScript, Vite
- **Backend**: Node.js, Express, TypeScript, WebSockets
- **Agents**: Model Context Protocol (MCP), Python/FastMCP
- **Orchestration**: .NET Aspire for service discovery
- **AI**: LLM integration via agent runtime