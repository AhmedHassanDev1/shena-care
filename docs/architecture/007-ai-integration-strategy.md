# ADR-007: AI Integration Strategy

**Status**: Accepted  
**Date**: 2026-09-29

## Context

The Product Workflow requires several AI-powered capabilities:
- Structured data extraction from research sources
- Product content generation (titles, descriptions, benefits)
- Product image generation (hero images, lifestyle visuals)
- Similarity matching for deduplication
- Future: Recommendation engine, conversational assistant

NestJS is our primary backend, but AI workloads have different characteristics:
- GPU requirements for image generation
- Different dependency ecosystem (Python ML libraries)
- Long-running inference requests
- High memory consumption
- Async/streaming response patterns

We need to decide: **Should AI workloads run in NestJS or in a separate service?**

## Decision

We use a **separate FastAPI service** for AI/ML workloads, with NestJS orchestrating and validating.

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Next.js Frontend                                            │
└────────────────────────┬────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│ NestJS Modular Monolith                                     │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │ Catalog  │  │ Commerce │  │ Sourcing │  │Ingestion │  │
│  └──────────┘  └──────────┘  └──────────┘  └────┬─────┘  │
│                                                   │         │
│                                                   ↓         │
│                                          ┌────────────────┐ │
│                                          │   AiClient     │ │
│                                          └────────┬───────┘ │
└───────────────────────────────────────────────────┼─────────┘
                                                    ↓ HTTP
                                          ┌─────────────────┐
                                          │ FastAPI Service │
                                          │                 │
                                          │ • LLM calls     │
                                          │ • Image gen     │
                                          │ • Extraction    │
                                          │ • Embeddings    │
                                          └─────────────────┘
```

### Responsibilities

#### NestJS (Orchestration & Validation)
- **Workflow orchestration**: Control multi-step AI workflows
- **State management**: Track workflow progress in database
- **Validation**: Validate AI outputs before persistence
- **Business rules**: Apply domain logic to AI results
- **Persistence**: Write validated results to PostgreSQL
- **API composition**: Combine AI results with business data

**Example Flow**:
```typescript
// In NestJS Ingestion Module
async enrichCandidate(candidateId: string) {
  const candidate = await this.candidateRepo.findOne(candidateId);
  
  // Call FastAPI for AI work
  const enrichedData = await this.aiClient.extractProductData({
    rawText: candidate.productData,
    imageUrl: candidate.imageUrl
  });
  
  // Validate in NestJS
  if (!this.isValidEnrichment(enrichedData)) {
    throw new ValidationError('AI output failed validation');
  }
  
  // Persist in NestJS
  candidate.productData = enrichedData;
  candidate.workflowStage = 'enriched';
  await this.candidateRepo.save(candidate);
}
```

#### FastAPI (Computation & AI)
- **LLM API calls**: Claude, OpenAI, etc.
- **Structured extraction**: Parse unstructured text into typed JSON
- **Content generation**: Generate product titles, descriptions
- **Image generation**: Create product visuals (future)
- **Embeddings**: Calculate vector representations (future)
- **Similarity matching**: Compare product fingerprints (future)

**Example API**:
```python
# In FastAPI
from pydantic import BaseModel
from anthropic import Anthropic

class ExtractProductDataRequest(BaseModel):
    raw_text: str
    image_url: str | None = None

class ProductData(BaseModel):
    brand: str
    name: str
    description: str
    usage: str
    warnings: list[str]
    ingredients: list[str]

@app.post("/extract-product-data")
async def extract_product_data(
    request: ExtractProductDataRequest
) -> ProductData:
    client = Anthropic()
    
    response = client.messages.create(
        model="claude-sonnet-5-5",
        messages=[{
            "role": "user",
            "content": f"Extract structured product data: {request.raw_text}"
        }]
    )
    
    # Parse response into typed Pydantic model
    return ProductData.model_validate_json(response.content)
```

### Why Separate Service?

**Runtime Requirements**:
- Python ecosystem for AI/ML libraries
- Potential GPU access for image generation
- Different scaling characteristics (CPU vs GPU)
- Async/streaming patterns native to Python

**Isolation Benefits**:
- NestJS doesn't need Python dependencies
- AI service can scale independently
- Easier to swap AI providers/models
- Clear cost accounting per AI operation

**Development Velocity**:
- AI team works in Python (faster iteration)
- Backend team works in TypeScript (type safety)
- Independent deployment of AI improvements

### When to Use FastAPI

✅ **Use FastAPI for**:
- LLM API calls (Claude, GPT, etc.)
- Structured extraction from unstructured text
- Content generation (titles, descriptions, benefits)
- Image generation (hero images, lifestyle visuals)
- Embedding calculations
- Similarity/matching computations
- Future: Recommendation scoring
- Future: Conversational AI

❌ **Do NOT use FastAPI for**:
- CRUD operations
- Business logic validation
- Workflow state management
- Database writes (except caching)
- Authentication/authorization
- Order processing
- Payment handling

### Communication Protocol

**Request/Response Pattern** (Synchronous):
```typescript
// NestJS calls FastAPI
const response = await this.httpService.post<ProductData>(
  'http://fastapi:8000/extract-product-data',
  { raw_text: input }
);
```

**Streaming Pattern** (for long content generation):
```typescript
// Future: Server-Sent Events for streaming
const stream = await this.aiClient.generateContentStream({
  product: candidate.productData
});

for await (const chunk of stream) {
  // Stream to frontend or accumulate
}
```

**No Event Bus** (for MVP):
- Direct HTTP calls
- No Kafka/RabbitMQ/Redis Streams
- Add async messaging only when needed (e.g., batch processing)

### Data Flow Examples

#### Example 1: Product Content Generation

```
┌─────────────────┐
│ NestJS          │
│ Ingestion       │
└────────┬────────┘
         │ 1. Get candidate
         ↓
┌─────────────────┐
│ PostgreSQL      │
│ candidates      │
└────────┬────────┘
         │ 2. Extract canonical facts
         ↓
┌─────────────────┐
│ NestJS          │
│ AiClient        │
└────────┬────────┘
         │ 3. HTTP POST /generate-content
         ↓
┌─────────────────┐
│ FastAPI         │
│ Claude API      │
└────────┬────────┘
         │ 4. Generated content (JSON)
         ↓
┌─────────────────┐
│ NestJS          │
│ Validation      │
└────────┬────────┘
         │ 5. Validate structure/safety
         ↓
┌─────────────────┐
│ NestJS          │
│ Persistence     │
└────────┬────────┘
         │ 6. Save GeneratedContentVersion
         ↓
┌─────────────────┐
│ PostgreSQL      │
│ generated_      │
│ content_        │
│ versions        │
└─────────────────┘
```

#### Example 2: Structured Extraction

```
┌─────────────────┐
│ Supplier CSV    │
└────────┬────────┘
         │ Raw text: "Cerave Foaming Cleanser 236 ML"
         ↓
┌─────────────────┐
│ NestJS          │
│ Normalization   │
└────────┬────────┘
         │ Send to AI for extraction
         ↓
┌─────────────────┐
│ FastAPI         │
│ /extract        │
└────────┬────────┘
         │ Return structured:
         │ { brand: "CeraVe",
         │   name: "Foaming Cleanser",
         │   size: 236,
         │   unit: "ml" }
         ↓
┌─────────────────┐
│ NestJS          │
│ Validation      │
└────────┬────────┘
         │ Validate extracted data
         ↓
┌─────────────────┐
│ PostgreSQL      │
│ candidates      │
└─────────────────┘
```

### Security & Validation

**Never Trust AI Output**:
```typescript
// WRONG: Directly persist AI output
const data = await this.aiClient.extract(input);
await this.repo.save(data); // ❌ No validation!

// RIGHT: Validate before persistence
const data = await this.aiClient.extract(input);

if (!this.validator.validate(data)) {
  throw new ValidationError('AI output invalid');
}

// Additional business rules
if (data.warnings.length === 0 && data.category === 'retinol') {
  throw new BusinessRuleViolation('Retinol products must have warnings');
}

await this.repo.save(data);
```

**FastAPI Should NOT**:
- Write to PostgreSQL directly (NestJS owns schema)
- Make decisions about workflow state
- Apply business rules (NestJS owns)
- Access Catalog/Commerce/Sourcing entities

**FastAPI CAN**:
- Cache embeddings in Redis (future)
- Store temporary processing artifacts
- Log AI requests/responses

### Error Handling

**NestJS handles errors**:
```typescript
try {
  const result = await this.aiClient.generateContent(input);
  return result;
} catch (error) {
  if (error instanceof AiServiceTimeout) {
    // Retry with exponential backoff
  } else if (error instanceof AiServiceRateLimited) {
    // Queue for later retry
  } else {
    // Log and notify
    throw new WorkflowError('AI enrichment failed');
  }
}
```

### Cost Tracking

**Track AI costs in NestJS**:
```typescript
const startTime = Date.now();
const result = await this.aiClient.generateContent(input);
const duration = Date.now() - startTime;

await this.metricsService.recordAiUsage({
  operation: 'content_generation',
  model: 'claude-sonnet-5-5',
  tokensUsed: result.metadata.tokensUsed,
  durationMs: duration,
  candidateId: candidate.id
});
```

### Model Selection

**Current (2026)**:
- **Structured Extraction**: Claude Sonnet 5.5 (high accuracy)
- **Content Generation**: Claude Sonnet 5.5 (quality writing)
- **Fast Operations**: Claude Haiku 4.5 (classification, simple extraction)

**Future**:
- **Image Generation**: DALL-E 3 or Stable Diffusion
- **Embeddings**: OpenAI text-embedding-3 or custom model

**FastAPI abstracts model selection**:
```python
# NestJS requests a capability, not a specific model
POST /generate-content
{ "task": "product_description", "data": {...} }

# FastAPI selects model internally
# Can swap models without NestJS changes
```

## Consequences

### Positive

- **Right tool for the job**: Python for AI, TypeScript for backend
- **Independent scaling**: Scale AI service separately
- **Cost isolation**: Clear AI cost accounting
- **Team velocity**: AI and backend teams work independently
- **Easier testing**: Mock AI service for backend tests
- **Model flexibility**: Swap AI providers without backend changes

### Negative

- **Network latency**: HTTP calls add ~10-50ms overhead
- **Operational complexity**: Two services to deploy/monitor
- **Deployment coordination**: Must deploy both services
- **No shared types**: Request/response schemas must stay in sync

### Risks

1. **FastAPI downtime blocks workflow**
   - *Mitigation*: Graceful degradation, queue failed requests for retry

2. **Schema drift between NestJS and FastAPI**
   - *Mitigation*: OpenAPI spec generation, contract tests

3. **AI costs spiral**
   - *Mitigation*: Cost tracking, rate limiting, caching

## Alternatives Considered

### AI in NestJS Directly

**Rejected**: Call Claude/OpenAI APIs from NestJS.

**Why**: 
- TypeScript AI libraries less mature than Python
- Mixing TypeScript and Python dependencies is awkward
- AI workloads have different scaling needs
- Harder to isolate AI costs

### Separate Microservices for Each AI Task

**Rejected**: One service per AI capability (extraction service, generation service, etc.)

**Why**: Premature. Consolidate in one FastAPI service until traffic justifies splitting.

### Event-Driven with Message Queue

**Rejected**: NestJS publishes events, FastAPI consumes from Kafka/RabbitMQ.

**Why**: Unnecessary complexity for MVP. Direct HTTP calls are simpler and sufficient.

### Embeddings/Vector Database Now

**Rejected**: Build semantic search and similarity matching immediately.

**Why**: Not needed for first 20 products. Add when product catalog exceeds 100+ items.

## Implementation Plan

### Phase 1: Basic FastAPI Service

**MVP Endpoints**:
```
POST /extract-product-data
  • Input: Raw supplier text
  • Output: Structured product data (brand, name, size, etc.)

POST /generate-content
  • Input: Canonical product facts
  • Output: Customer-facing content (title, description, benefits)

POST /normalize-text
  • Input: Raw text (brand name, product name)
  • Output: Normalized text (lowercase, special chars removed)

GET /health
  • Health check endpoint
```

**Duration**: 3-5 days

### Phase 2: Content Versioning

- Track model name, prompt version in responses
- Enable content regeneration when prompts improve

**Duration**: 2 days

### Phase 3: Image Generation (Future)

```
POST /generate-product-image
  • Input: Product data + reference image
  • Output: Generated hero image
```

**Duration**: 1 week

### Phase 4: Semantic Search (Future)

```
POST /calculate-embeddings
  • Input: Product text
  • Output: Vector embedding

POST /find-similar
  • Input: Product embedding
  • Output: Similar product IDs + scores
```

**Duration**: 1 week

## Success Criteria

1. **<100ms p95 latency** for structured extraction
2. **<2s p95 latency** for content generation
3. **Zero database writes** from FastAPI to PostgreSQL
4. **100% schema validation** of AI outputs in NestJS
5. **Cost tracking** for all AI operations

## References

- ADR-006: Product Workflow Architecture
- ER_MODEL.md: Data model
- ARCHITECTURE_REVIEW.md: Module boundaries
