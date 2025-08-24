# Copilot Instructions for Blackjack Agents Project

## Project Overview

This is a **blackjack game application** featuring **multiple AI agents** implemented in different programming languages, orchestrated using **Aspire**. The system consists of:

### Architecture Components

1. **AppHost** (`/.aspire/`) - Aspire orchestration host
2. **Frontend** (`/src/frontend/`) - React + TypeScript + Vite web interface
3. **AI Agents**:
   - **Pat** (`/src/pat-python/`) - Python-based blackjack agent
   - **Dee** (`/src/dee-dotnet/`) - .NET-based blackjack agent  
   - **Tom** (`/src/tom-typescript/`) - TypeScript/Node.js-based blackjack agent
4. **Dealer, Game Engine, and Shoe** (`/src/backend/`) - Game management service

A full spec is in `../blackjack-aspire-spec.md`.

## Development Guidelines

You can use the integrated VS Code terminal.

### Aspire-Specific Development

When working with this project, remember that running this app is orchestrated through Aspire. Use the Microsoft Docs MCP for guidance on how to use aspire for development ("aspire run" etc).

