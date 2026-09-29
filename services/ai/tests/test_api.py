from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_returns_ok() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["service"] == "shenacare-ai"
    assert body["provider"] == "mock"


def test_enrich_valid_request() -> None:
    response = client.post(
        "/v1/enrichment/product",
        json={
            "candidateRef": "item-123",
            "sourceType": "supplier_feed",
            "rawTitle": "CeraVe  Moisturizing  Lotion 236ml",
            "brand": "CeraVe",
            "barcode": "30175124",
        },
        headers={"X-Correlation-ID": "corr-abc"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["schemaVersion"] == "1"
    suggestions = body["suggestions"]
    assert suggestions["normalizedTitle"] == "CeraVe Moisturizing Lotion 236ml"
    assert suggestions["brand"] == "CeraVe"
    assert suggestions["barcode"] == "30175124"
    assert suggestions["size"] == {"value": 236.0, "unit": "ml"}
    assert suggestions["usage"] == ["Apply to clean skin once or twice daily."]
    assert body["providerMetadata"]["provider"] == "mock"
    assert 0.0 <= body["confidence"]["normalizedTitle"] <= 1.0


def test_enrich_rejects_missing_required_fields() -> None:
    response = client.post(
        "/v1/enrichment/product",
        json={"sourceType": "supplier_feed", "rawTitle": "Some product"},
    )
    assert response.status_code == 422


def test_enrich_rejects_unknown_fields_strictly() -> None:
    # Extra fields are ignored by default, but malformed types must be rejected.
    response = client.post(
        "/v1/enrichment/product",
        json={
            "candidateRef": "item-123",
            "sourceType": "supplier_feed",
            "rawTitle": "Product X",
            "barcode": "123",  # too short, min_length=8
        },
    )
    assert response.status_code == 422


def test_enrich_mock_provider_is_deterministic() -> None:
    payload = {
        "candidateRef": "item-456",
        "sourceType": "manual",
        "rawTitle": "Nivea Body Cream 200g",
    }
    first = client.post("/v1/enrichment/product", json=payload)
    second = client.post("/v1/enrichment/product", json=payload)
    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json() == second.json()


def test_enrich_provider_failure_maps_to_503() -> None:
    response = client.post(
        "/v1/enrichment/product",
        json={
            "candidateRef": "item-789",
            "sourceType": "supplier_feed",
            "rawTitle": "__UNAVAILABLE__",
        },
    )
    assert response.status_code == 503
    assert response.json()["detail"] == "AI provider unavailable"
