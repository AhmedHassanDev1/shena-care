import asyncio
import os
import sys

# Ensure GROQ_API_KEY is available
api_key = os.getenv("GROQ_API_KEY")
if not api_key:
    # Try reading from apps/api/.env
    env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'apps', 'api', '.env')
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                if line.startswith("GROQ_API_KEY="):
                    os.environ["GROQ_API_KEY"] = line.split("=", 1)[1].strip()
                    break

from app.providers.groq_provider import GroqProvider
from app.contracts.content import ProductContentGenerationRequest
from app.providers.base import ProviderError, ProviderUnavailableError

async def main():
    print("Testing missing credentials...")
    import app.core.config
    
    # Save original from .env if present
    original_key = None
    env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'apps', 'api', '.env')
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                if line.startswith("GROQ_API_KEY="):
                    original_key = line.split("=", 1)[1].strip()
                    break

    os.environ.pop("GROQ_API_KEY", None)
    app.core.config.get_settings.cache_clear()
    
    try:
        from app.core.config import get_settings
        get_settings()
        GroqProvider()
        print("FAIL: GroqProvider initialized without key!")
        sys.exit(1)
    except ProviderUnavailableError:
        print("PASS: Missing credentials safely rejected.")
        
    if original_key:
        print(f"Restoring API key length: {len(original_key)}")
        os.environ["GROQ_API_KEY"] = original_key
    else:
        print("original_key is None")
    app.core.config.get_settings.cache_clear()
    
    try:
        provider = GroqProvider()
    except Exception as e:
        print(f"Failed to initialize provider: {e}")
        sys.exit(1)
        
    print("Testing generate_content...")
    req = ProductContentGenerationRequest(
        candidateId="cand-test-1",
        facts={
            "normalizedTitle": "Hydrating Night Cream 50ml",
            "brand": "ShenaTest",
            "ingredients": ["Hyaluronic Acid", "Vitamin E"],
            "benefits": ["Hydrates skin", "Repairs overnight"]
        },
        researchEvidence=[]
    )
    
    try:
        result = await provider.generate_content(req)
        print("Success! Content generation result:")
        import sys
        sys.stdout.buffer.write(result.model_dump_json(indent=2).encode('utf-8'))
        sys.stdout.buffer.write(b"\n")
        
        content = result.content
        if "Hydrates" not in content.benefitsEn[0]:
            print("WARNING: Might have generated unsupported claims?")
            
    except Exception as e:
        print(f"Generation failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(main())
