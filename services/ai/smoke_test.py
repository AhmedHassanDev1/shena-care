import asyncio
import os
import sys

# Ensure GROQ_API_KEY is available
api_key = os.getenv("GROQ_API_KEY")
if not api_key:
    # Try reading from apps/api/.env
    env_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'apps', 'api', '.env')
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                if line.startswith("GROQ_API_KEY="):
                    os.environ["GROQ_API_KEY"] = line.split("=", 1)[1].strip()
                    break

from app.providers.groq_provider import GroqProvider
from app.contracts.enrichment import ProductEnrichmentRequest

async def main():
    try:
        provider = GroqProvider()
    except Exception as e:
        print(f"Failed to initialize provider: {e}")
        sys.exit(1)
        
    print(f"Initialized GroqProvider with model: {provider.model}")
    print("Running smoke test for enrich_product...")
    
    req = ProductEnrichmentRequest(
        candidateRef="test-smoke-1",
        sourceType="supplier",
        rawTitle="Hydrating Night Cream 50ml",
        brand="TestBrand",
        barcode="1234567890123"
    )
    
    try:
        result = await provider.enrich_product(req)
        print("Success! Enrichment result:")
        print(result.model_dump_json(indent=2))
    except Exception as e:
        print(f"Enrichment failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(main())
