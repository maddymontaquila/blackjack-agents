#!/usr/bin/env python3
"""
Pat Python - Agentic API for Blackjack Agent
A funny and lighthearted blackjack agent with direct HTTP API endpoints
"""

import uvicorn
import json
import os
from typing import Dict, List, Any, Optional

# FastAPI imports
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from azure.identity import DefaultAzureCredential
from azure.ai.projects import AIProjectClient

# Pat's personality and betting constants
PAT_PERSONALITY = "funny, lighthearted, dramatic, and slightly sarcastic blackjack player"
VALID_ACTIONS = ["hit", "stand"]
MIN_BET = 5
MAX_BET = 100

# Pydantic models for API input/output (matching shared schemas)
class PublicPlayer(BaseModel):
    id: str
    seat: int
    visibleCards: List[int]
    lastAction: Optional[str] = None
    bet: Optional[int] = None
    balance: Optional[int] = None

class ChatMsg(BaseModel):
    from_: str = Field(alias="from")
    text: str

class PublicSnapshot(BaseModel):
    handNumber: int
    shoePenetration: float
    runningCount: Optional[int] = None
    players: List[PublicPlayer]
    dealerUpcard: int
    chat: List[ChatMsg]

class PrivateInfo(BaseModel):
    myHoleCards: List[int]
    mySeat: int
    bankroll: int

class AgentIO(BaseModel):
    role: str  # "table-talk" or "decision"
    public: PublicSnapshot
    me: PrivateInfo

class BetOut(BaseModel):
    bet_amount: int
    rationale: str

class TalkOut(BaseModel):
    say: str

class DecisionOut(BaseModel):
    action: str
    confidence: float
    rationale: str

class AzureAIFoundryClient:
    """Azure AI Foundry LLM integration for Pat Python (Aspire-managed)"""
    
    def __init__(self):
        self.enabled = self._load_aspire_config()
        
        if self.enabled:
            self.project_client = AIProjectClient(
                endpoint=self.endpoint,
                credential=DefaultAzureCredential()
            )
            # Get an authenticated OpenAI client from the project
            self.openai_client = self.project_client.get_openai_client(api_version="2024-10-21")
        else:
            print("Azure AI Foundry client disabled - using fallback responses")
    
    def _load_aspire_config(self) -> bool:
        """Load Azure AI Foundry configuration from Aspire connection string"""
        try:
            # Parse connection string from Aspire
            connection_string = os.getenv("ConnectionStrings__patLLM")
            if not connection_string:
                print("Info: ConnectionStrings__patLLM not provided by Aspire - using fallbacks")
                return False
            
            # Parse connection string: Endpoint=...;EndpointAIInference=...;DeploymentId=...;Model=...
            parts = {}
            for part in connection_string.split(';'):
                if '=' in part:
                    key, value = part.split('=', 1)
                    parts[key.strip()] = value.strip()
            
            # Extract required values
            # For AI Foundry project endpoint, we need the project endpoint URL format:
            # https://<resource-name>.services.ai.azure.com/api/projects/<project-name>
            endpoint_ai = parts.get('EndpointAIInference')
            if endpoint_ai and '/models' in endpoint_ai:
                # Convert from inference endpoint to project endpoint
                base_endpoint = endpoint_ai.replace('/models', '')
                # We need the project name - this might need to be configured separately
                project_name = os.getenv("FOUNDRY_PROJECT_NAME", "default")
                self.endpoint = f"{base_endpoint}/api/projects/{project_name}"
            else:
                self.endpoint = parts.get('Endpoint')
                
            self.deployment_name = parts.get('DeploymentId') or parts.get('Model', 'gpt-4o-mini')
            
            if not self.endpoint:
                print("Error: No endpoint found in connection string")
                return False
                
            print(f"Parsed Aspire connection string - endpoint: {self.endpoint[:50]}...")
            print(f"Using deployment: {self.deployment_name}")
            return True
            
        except Exception as e:
            print(f"Error parsing connection string: {e}")
            return False
    
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

            response = self.openai_client.chat.completions.create(
                model=self.deployment_name,
                messages=[
                    {"role": "system", "content": "You are Pat Python, a witty blackjack player. Keep responses under 160 characters."},
                    {"role": "user", "content": prompt}
                ],
                max_tokens=50,
                temperature=0.8
            )
            
            comment = response.choices[0].message.content.strip()
            return comment[:160]  # Ensure max length
            
        except Exception as e:
            print(f"Azure talk generation failed (this is normal): {e}")
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

            response = self.openai_client.chat.completions.create(
                model=self.deployment_name,
                messages=[
                    {"role": "system", "content": "You are Pat Python. Make blackjack decisions with good strategy but entertaining personality. Respond with valid JSON only."},
                    {"role": "user", "content": prompt}
                ],
                max_tokens=120,
                temperature=0.7
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
            print(f"Azure decision generation failed (this is normal): {e}")
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

            response = self.openai_client.chat.completions.create(
                model=self.deployment_name,
                messages=[
                    {"role": "system", "content": "You are Pat Python making betting decisions. Be witty but strategic with bankroll management."},
                    {"role": "user", "content": prompt}
                ],
                max_tokens=80,
                temperature=0.8
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

def calculate_hand_value(cards: List[int]) -> int:
    """Calculate the value of a blackjack hand"""
    value = sum(cards)
    num_aces = cards.count(1)  # Assuming 1 represents Ace
    
    # Handle Aces - make them 11 if it doesn't bust
    while num_aces > 0 and value + 10 <= 21:
        value += 10
        num_aces -= 1
        
    return value

# Create FastAPI app
print("Creating FastAPI application for Pat Python Agent")
app = FastAPI(title="Pat Python Agent API")
print("FastAPI application created, setting up agent endpoints")

# Initialize Azure AI Foundry client
azure_client = AzureAIFoundryClient()

# Agentic API endpoints

@app.post("/place_bet", response_model=BetOut)
async def place_bet(request: dict):
    """Place a bet for the upcoming blackjack hand"""
    try:
        print(f"DEBUG: place_bet() called with request: {request}")
        
        bankroll = request.get("bankroll", 100)
        # Handle both handNumber and hand_number for backwards compatibility
        hand_number = request.get("handNumber", request.get("hand_number", 1))
        
        print(f"DEBUG: Parsed - bankroll: {bankroll}, hand_number: {hand_number}")
        
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
        
        print(f"DEBUG: Final betting response: {response}")
        return BetOut(**response)
        
    except Exception as e:
        print(f"Error in place_bet: {e}")
        print(f"Error type: {type(e).__name__}")
        print(f"Error details: {str(e)}")
        import traceback
        print(f"Stack trace: {traceback.format_exc()}")
        # Pat's betting personality even when everything fails
        safe_bet = max(MIN_BET, min(request.get("bankroll", 100) // 10, MAX_BET))
        return BetOut(
            bet_amount=safe_bet,
            rationale="System crashed - betting with pure Python intuition!"
        )

@app.post("/table_talk", response_model=TalkOut)
async def table_talk(agent_io: AgentIO):
    """Generate Pat Python's table talk based on current game state"""
    try:
        print(f"DEBUG: table_talk() called with role: {agent_io.role}")
        print(f"DEBUG: agent_io data: {agent_io.model_dump()}")
        
        if agent_io.role != "table-talk":
            raise HTTPException(status_code=400, detail="Expected role 'table-talk'")
            
        my_hand_value = calculate_hand_value(agent_io.me.myHoleCards)
        dealer_upcard = agent_io.public.dealerUpcard
        
        print(f"DEBUG: My hand value: {my_hand_value}, dealer upcard: {dealer_upcard}")
        
        # Try Azure AI Foundry generation first
        game_context = {
            "my_hand_value": my_hand_value,
            "dealer_upcard": dealer_upcard,
            "bankroll": agent_io.me.bankroll,
            "hand_number": agent_io.public.handNumber
        }
        
        print(f"DEBUG: Calling Azure AI Foundry for table talk with context: {game_context}")
        azure_response = await azure_client.generate_talk(game_context)
        print(f"DEBUG: Azure table talk response: {azure_response}")
        
        comment = azure_response or f"Dealer's got a {dealer_upcard}? My {my_hand_value} is ready!"
        print(f"DEBUG: Final comment: {comment}")
        
        return TalkOut(say=comment[:160])
        
    except Exception as e:
        print(f"Error in table_talk: {e}")
        print(f"Error type: {type(e).__name__}")
        print(f"Error details: {str(e)}")
        import traceback
        print(f"Stack trace: {traceback.format_exc()}")
        return TalkOut(say="Oops, my comedy circuits short-circuited!")

@app.post("/decide", response_model=DecisionOut)
async def decide(agent_io: AgentIO):
    """Make Pat Python's blackjack decision based on game state"""
    try:
        print(f"DEBUG: decide() called with role: {agent_io.role}")
        print(f"DEBUG: agent_io data: {agent_io.model_dump()}")
        
        if agent_io.role != "decision":
            raise HTTPException(status_code=400, detail="Expected role 'decision'")
            
        my_cards = agent_io.me.myHoleCards
        my_hand_value = calculate_hand_value(my_cards)
        dealer_upcard = agent_io.public.dealerUpcard
        
        print(f"DEBUG: My cards: {my_cards}, value: {my_hand_value}, dealer upcard: {dealer_upcard}")
        
        # Try Azure AI Foundry generation first
        game_context = {
            "my_cards": my_cards,
            "my_hand_value": my_hand_value,
            "dealer_upcard": dealer_upcard,
            "bankroll": agent_io.me.bankroll
        }
        
        print(f"DEBUG: Calling Azure AI Foundry with context: {game_context}")
        azure_response = await azure_client.generate_decision(game_context)
        print(f"DEBUG: Azure response: {azure_response}")
        
        if azure_response and isinstance(azure_response, dict) and azure_response.get("action") in VALID_ACTIONS:
            response = azure_response
            print(f"DEBUG: Using Azure response: {response}")
        else:
            # Simple fallback - Pat's personality-driven default logic
            if my_hand_value < 17:
                action = "hit"
                rationale = "Under 17? Hit me! That's the Pat way!"
            else:
                action = "stand"
                rationale = "I'm staying put - let's see what the dealer's got!"
            
            response = {
                "action": action,
                "confidence": 0.6,
                "rationale": rationale
            }
            print(f"DEBUG: Using fallback response: {response}")
        
        return DecisionOut(**response)
        
    except Exception as e:
        print(f"Error in decide: {e}")
        print(f"Error type: {type(e).__name__}")
        print(f"Error details: {str(e)}")
        import traceback
        print(f"Stack trace: {traceback.format_exc()}")
        # Pat's personality shines through even in errors
        return DecisionOut(
            action="stand",
            confidence=0.4,
            rationale="My Python circuits are sparking - better play it safe!"
        )

# Health check endpoint for Aspire
@app.get("/health")
async def health():
    return {"ok": True, "service": "pat-python", "status": "ready"}

# Root endpoint
@app.get("/")
async def root():
    return {
        "service": "Pat Python Agent API",
        "version": "1.0.0",
        "endpoints": {
            "place_bet": "/place_bet",
            "table_talk": "/table_talk", 
            "decide": "/decide"
        },
        "health": "/health"
    }

print("FastAPI app setup complete - Pure Agent API mode")

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    
    print("Pat Python Agent API starting up!")
    print("Ready to deal some cards and crack some jokes!")
    print("Running in Aspire environment with pure HTTP agent API")
    print(f"Pat Python Agent API starting on port {port}!")
    print(f"Agent endpoints available at http://0.0.0.0:{port}/")
    
    # Run with uvicorn
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=port,
        log_level="info"
    )
