#!/usr/bin/env python3
"""
Pat Python - MCP Server for Blackjack Agent
A funny and lighthearted blackjack agent that can be hosted in an agent runtime
"""

import uvicorn
import json
import os
from typing import Dict, List, Any, Optional

# FastAPI imports
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

# MCP Protocol imports
from mcp.server import Server, NotificationOptions
from mcp.server.models import InitializationOptions
import mcp.types as types

# Azure OpenAI imports
try:
    from openai import AsyncAzureOpenAI
    AZURE_AVAILABLE = True
except ImportError:
    AZURE_AVAILABLE = False
    print("Warning: Azure OpenAI not available. Install with: pip install openai azure-identity")

# Initialize MCP Server
server = Server("pat-python")

# Pat's personality and betting constants
PAT_PERSONALITY = "funny, lighthearted, dramatic, and slightly sarcastic blackjack player"
VALID_ACTIONS = ["hit", "stand"]
MIN_BET = 5
MAX_BET = 100

class AzureAIFoundryClient:
    """Azure AI Foundry LLM integration for Pat Python (Aspire-managed)"""
    
    def __init__(self):
        self.enabled = AZURE_AVAILABLE and self._load_aspire_config()
        
        if self.enabled:
            self._setup_client()
        else:
            print("Azure AI Foundry client disabled - using fallback responses")
    
    def _load_aspire_config(self) -> bool:
        """Load Azure AI Foundry configuration from Aspire environment"""
        try:
            # Aspire will inject these environment variables
            self.endpoint = os.getenv("AZURE_OPENAI_ENDPOINT")
            self.api_key = os.getenv("AZURE_OPENAI_API_KEY")  
            self.deployment_name = os.getenv("AZURE_OPENAI_DEPLOYMENT", "gpt-4o-mini")
            self.api_version = os.getenv("AZURE_OPENAI_API_VERSION", "2024-02-15-preview")
            
            if not self.endpoint:
                print("Info: AZURE_OPENAI_ENDPOINT not provided by Aspire - using fallbacks")
                return False
                
            print(f"Aspire provided Azure config - endpoint: {self.endpoint[:50]}...")
            return True
            
        except Exception as e:
            print(f"Error reading Aspire config: {e}")
            return False
    
    def _setup_client(self):
        """Initialize the Azure OpenAI client with Aspire config"""
        try:
            # Use API key auth (simpler for Aspire-managed scenarios)
            self.client = AsyncAzureOpenAI(
                azure_endpoint=self.endpoint,
                api_key=self.api_key,
                api_version=self.api_version
            )
            print(f"Azure AI Foundry connected via Aspire - deployment: {self.deployment_name}")
        except Exception as e:
            print(f"Failed to initialize Azure client: {e}")
            self.enabled = False
    
    async def generate_talk(self, game_context: dict) -> Optional[str]:
        """Generate table talk using Azure AI Foundry"""
        if not self.enabled:
            return None
            
        try:
            prompt = f"""You are Pat Python, a funny and lighthearted blackjack player known for witty comments.

Current game situation:
- Your hand value: {game_context['my_hand_value']}
- Dealer's upcard: {game_context['dealer_upcard']} 
- Your bankroll: ${game_context['bankroll']}
- Hand #{game_context['hand_number']}

Generate a SHORT, funny comment (max 160 characters) that Pat would say right now. Be:
- Humorous and entertaining
- Slightly dramatic or sarcastic 
- Reactive to the current situation
- Authentic to a blackjack player's mindset

Return ONLY the comment text, no quotes or JSON."""

            response = await self.client.chat.completions.create(
                model=self.deployment_name,
                messages=[
                    {"role": "system", "content": "You are Pat Python, a witty blackjack player. Keep responses under 160 characters."},
                    {"role": "user", "content": prompt}
                ],
                max_tokens=50,
                temperature=0.8,
                timeout=5.0
            )
            
            comment = response.choices[0].message.content.strip()
            return comment[:160]  # Ensure max length
            
        except Exception as e:
            print(f"Azure talk generation failed: {e}")
            return None
    
    async def generate_decision(self, game_context: dict) -> Optional[dict]:
        """Generate blackjack decision using Azure AI Foundry"""
        if not self.enabled:
            return None
            
        try:
            prompt = f"""You are Pat Python making a blackjack decision. You're funny but want to win money.

GAME STATE:
- Your cards: {game_context['my_cards']} (total value: {game_context['my_hand_value']})
- Dealer's upcard: {game_context['dealer_upcard']}
- Your bankroll: ${game_context['bankroll']}

AVAILABLE ACTIONS:
- hit: Take another card
- stand: Keep current hand

BLACKJACK RULES:
- Goal: Get close to 21 without going over
- Dealer hits on 16, stands on 17
- Aces = 1 or 11, face cards = 10

Make a smart decision considering basic blackjack strategy AND Pat's entertaining personality.

Respond with ONLY this JSON format:
{{"action": "hit", "confidence": 0.8, "rationale": "Your funny explanation (max 240 chars)"}}"""

            response = await self.client.chat.completions.create(
                model=self.deployment_name,
                messages=[
                    {"role": "system", "content": "You are Pat Python. Make blackjack decisions with good strategy but entertaining personality. Respond with valid JSON only."},
                    {"role": "user", "content": prompt}
                ],
                max_tokens=120,
                temperature=0.7,
                timeout=5.0
            )
            
            result_text = response.choices[0].message.content.strip()
            
            # Parse and validate JSON response
            result = json.loads(result_text)
            
            # Validate required fields and action
            if not all(key in result for key in ["action", "confidence", "rationale"]):
                raise ValueError("Missing required fields in response")
                
            if result["action"] not in VALID_ACTIONS:
                raise ValueError(f"Invalid action: {result['action']}")
                
            # Ensure rationale length
            result["rationale"] = result["rationale"][:240]
            
            return result
            
        except Exception as e:
            print(f"Azure decision generation failed: {e}")
            return None

    async def generate_bet(self, bankroll: int, hand_number: int) -> Optional[dict]:
        """Generate betting decision using Azure AI Foundry"""
        if not self.enabled:
            return None
            
        try:
            prompt = f"""You are Pat Python deciding how much to bet on blackjack hand #{hand_number}.

BANKROLL: ${bankroll}
BET LIMITS: ${MIN_BET} minimum, ${MAX_BET} maximum

Pat's personality:
- Confident and slightly cocky
- Generally bets 15-25% of bankroll (his "sweet spot")
- More aggressive when bankroll is healthy (75+)
- More conservative when low (25 or less)
- Always has witty reasoning

Generate a betting decision that fits Pat's personality and bankroll situation.

Respond with ONLY this JSON format:
{{"bet_amount": 20, "rationale": "Your funny explanation for the bet size (max 160 chars)"}}"""

            response = await self.client.chat.completions.create(
                model=self.deployment_name,
                messages=[
                    {"role": "system", "content": "You are Pat Python making betting decisions. Be witty but strategic with bankroll management."},
                    {"role": "user", "content": prompt}
                ],
                max_tokens=80,
                temperature=0.8,
                timeout=5.0
            )
            
            result_text = response.choices[0].message.content.strip()
            result = json.loads(result_text)
            
            # Validate and clamp bet amount
            bet_amount = max(MIN_BET, min(result.get("bet_amount", MIN_BET), min(MAX_BET, bankroll)))
            result["bet_amount"] = bet_amount
            result["rationale"] = result.get("rationale", "LLM reasoning failed - going with vibes!")[:160]
            
            return result
            
        except Exception as e:
            print(f"Azure bet generation failed: {e}")
            return None

# Initialize Azure AI Foundry client
azure_client = AzureAIFoundryClient()

def calculate_hand_value(cards: List[int]) -> int:
    """Calculate the value of a blackjack hand"""
    value = sum(cards)
    num_aces = cards.count(1)  # Assuming 1 represents Ace
    
    # Handle Aces - make them 11 if it doesn't bust
    while num_aces > 0 and value + 10 <= 21:
        value += 10
        num_aces -= 1
        
    return value

# Common schema for game state tools
GAME_STATE_SCHEMA = {
    "type": "object",
    "properties": {
        "role": {"type": "string", "enum": ["table-talk", "decision"]},
        "public": {
            "type": "object",
            "properties": {
                "handNumber": {"type": "integer"},
                "shoePenetration": {"type": "number"},
                "runningCount": {"type": "integer"},
                "players": {"type": "array"},
                "dealerUpcard": {"type": "integer"},
                "chat": {"type": "array"}
            }
        },
        "me": {
            "type": "object",
            "properties": {
                "myHoleCards": {"type": "array"},
                "mySeat": {"type": "integer"},
                "bankroll": {"type": "integer"}
            }
        }
    },
    "required": ["role", "public", "me"]
}

@server.list_tools()
async def handle_list_tools() -> List[types.Tool]:
    """List available MCP tools for Pat Python"""
    return [
        types.Tool(
            name="place_bet",
            description="Place a bet for the upcoming blackjack hand",
            inputSchema={
                "type": "object",
                "properties": {
                    "bankroll": {"type": "integer", "minimum": 0},
                    "handNumber": {"type": "integer", "minimum": 1}
                },
                "required": ["bankroll", "handNumber"]
            }
        ),
        types.Tool(
            name="table_talk",
            description="""Generate Pat Python's table talk/chatter based on current game state. 
            Pat is funny, lighthearted, dramatic, and slightly sarcastic. He should react to the 
            dealer's upcard, his own hand value, and game situation with humor and personality. 
            Max 160 characters. Return JSON: {"say": "your comment"}""",
            inputSchema=GAME_STATE_SCHEMA
        ),
        types.Tool(
            name="decide",
            description="""Make Pat Python's blackjack decision based on game state. 
            Pat is entertaining but wants to win - balance good blackjack strategy with his 
            funny, dramatic personality. Consider dealer upcard, hand value, and available actions.
            Return JSON: {"action": "hit/stand", "confidence": 0.0-1.0, "rationale": "funny explanation (max 240 chars)"}""",
            inputSchema=GAME_STATE_SCHEMA
        )
    ]

@server.call_tool()
async def handle_call_tool(name: str, arguments: Dict[str, Any]) -> List[types.TextContent]:
    """Handle MCP tool calls"""
    if name == "place_bet":
        return await handle_place_bet(arguments)
    elif name == "table_talk":
        return await handle_table_talk(arguments)
    elif name == "decide":
        return await handle_decide(arguments)
    else:
        raise ValueError(f"Unknown tool: {name}")

async def handle_place_bet(args: Dict[str, Any]) -> List[types.TextContent]:
    """Determine Pat's bet amount using LLM-driven personality logic"""
    try:
        bankroll = args["bankroll"]
        hand_number = args["handNumber"]
        
        # Try Azure AI Foundry for betting decision
        azure_response = await azure_client.generate_bet(bankroll, hand_number)
        
        if azure_response and isinstance(azure_response, dict):
            response = azure_response
        else:
            # Fallback to Pat's default personality betting (around 20% of bankroll)
            target_bet = max(MIN_BET, min(int(bankroll * 0.20), min(MAX_BET, bankroll)))
            response = {
                "bet_amount": target_bet,
                "rationale": f"${target_bet} it is! My lucky algorithm says go for it!"
            }
        
        return [types.TextContent(type="text", text=json.dumps(response))]
        
    except Exception:
        # Pat's betting personality even when everything fails
        safe_bet = max(MIN_BET, min(args.get("bankroll", 100) // 10, MAX_BET))
        return [types.TextContent(type="text", text=json.dumps({
            "bet_amount": safe_bet,
            "rationale": "System crashed - betting with pure Python intuition!"
        }))]

async def handle_table_talk(args: Dict[str, Any]) -> List[types.TextContent]:
    """Generate Pat's table talk using Azure AI Foundry when available"""
    try:
        public_data = args["public"]
        private_data = args["me"]
        
        my_hand_value = calculate_hand_value(private_data["myHoleCards"])
        dealer_upcard = public_data["dealerUpcard"]
        
        # Try Azure AI Foundry generation first
        game_context = {
            "my_hand_value": my_hand_value,
            "dealer_upcard": dealer_upcard,
            "bankroll": private_data["bankroll"],
            "hand_number": public_data["handNumber"]
        }
        
        azure_response = await azure_client.generate_talk(game_context)
        response = {"say": (azure_response or f"Dealer's got a {dealer_upcard}? My {my_hand_value} is ready!")[:160]}
        
        return [types.TextContent(type="text", text=json.dumps(response))]
        
    except Exception as e:
        print(f"Error in handle_table_talk: {e}")
        return [types.TextContent(type="text", text=json.dumps({
            "say": "Oops, my comedy circuits short-circuited!"
        }))]

async def handle_decide(args: Dict[str, Any]) -> List[types.TextContent]:
    """Make Pat's blackjack decision using Azure AI Foundry when available"""
    try:
        public_data = args["public"]
        private_data = args["me"]
        
        my_cards = private_data["myHoleCards"]
        my_hand_value = calculate_hand_value(my_cards)
        dealer_upcard = public_data["dealerUpcard"]
        
        # Try Azure AI Foundry generation first
        game_context = {
            "my_cards": my_cards,
            "my_hand_value": my_hand_value,
            "dealer_upcard": dealer_upcard,
            "bankroll": private_data["bankroll"]
        }
        
        azure_response = await azure_client.generate_decision(game_context)
        if azure_response and isinstance(azure_response, dict) and azure_response.get("action") in VALID_ACTIONS:
            response = azure_response
        else:
            # Simple fallback - Pat's personality-driven default
            response = {
                "action": "stand",
                "confidence": 0.6,
                "rationale": "When in doubt, stand your ground! That's the Pat way!"
            }
        
        return [types.TextContent(type="text", text=json.dumps(response))]
        
    except Exception as e:
        print(f"Error in handle_decide: {e}")
        # Pat's personality shines through even in errors
        return [types.TextContent(type="text", text=json.dumps({
            "action": "stand",
            "confidence": 0.4,
            "rationale": "My Python circuits are sparking - better play it safe!"
        }))]

# Create FastAPI app at module level
print("Creating FastAPI application for Pat Python MCP Agent")
app = FastAPI(title="Pat Python MCP Server")
print("FastAPI application created, setting up MCP endpoints")

# MCP over HTTP endpoints
@app.post("/mcp/initialize")
async def mcp_initialize(request: Request):
    return JSONResponse({
        "protocolVersion": "2024-11-05",
        "capabilities": {
            "tools": {}
        },
        "serverInfo": {
            "name": "pat-python",
            "version": "1.0.0"
        }
    })

@app.post("/mcp/tools/list")
async def mcp_list_tools():
    tools = await handle_list_tools()
    return JSONResponse({
        "tools": [
            {
                "name": tool.name,
                "description": tool.description,
                "inputSchema": tool.inputSchema
            }
            for tool in tools
        ]
    })

@app.post("/mcp/tools/call")
async def mcp_call_tool(request: Request):
    body = await request.json()
    tool_name = body.get("name")
    arguments = body.get("arguments", {})
    
    try:
        result = await handle_call_tool(tool_name, arguments)
        return JSONResponse({
            "content": [
                {
                    "type": content.type,
                    "text": content.text
                }
                for content in result
            ]
        })
    except Exception as e:
        return JSONResponse(
            {"error": str(e)},
            status_code=400
        )

# Health check endpoint for Aspire
@app.get("/health")
async def health():
    return {"ok": True, "service": "pat-python", "status": "ready"}

# Root endpoint
@app.get("/")
async def root():
    return {
        "service": "Pat Python MCP Server",
        "version": "1.0.0",
        "mcp_endpoints": {
            "initialize": "/mcp/initialize",
            "list_tools": "/mcp/tools/list", 
            "call_tool": "/mcp/tools/call"
        },
        "health": "/health"
    }

print("FastAPI app setup complete")

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    
    print("Pat Python MCP Server starting up!")
    print("Ready to deal some cards and crack some jokes!")
    print("Running in Aspire environment with HTTP transport")
    print(f"Pat Python MCP Server starting on port {port}!")
    print(f"MCP endpoints available at http://0.0.0.0:{port}/mcp/")
    
    # Run with uvicorn
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=port,
        log_level="info"
    )
