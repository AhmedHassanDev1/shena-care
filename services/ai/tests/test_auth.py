"""The /v1 routes accept only the ShenaCare API's service token; /health stays open."""

import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.main import app
from tests.conftest import TEST_SERVICE_TOKEN

client = TestClient(app)

GUIDANCE_BODY = {"customerId": "subj_0123456789abcdef0123456789abcdef", "profile": {"concerns": []}}
V1_ROUTES = [
    ("/v1/guidance/recommend", GUIDANCE_BODY),
    ("/v1/enrichment/product", {"candidateRef": "item-1", "sourceType": "supplier_feed", "rawTitle": "Product"}),
    ("/v1/content/generate", {"candidateId": "cand-1", "facts": {}}),
]


@pytest.mark.parametrize("path,body", V1_ROUTES)
def test_v1_route_rejects_missing_token(path: str, body: dict) -> None:
    response = client.post(path, json=body)
    assert response.status_code == 401


@pytest.mark.parametrize("path,body", V1_ROUTES)
def test_v1_route_rejects_wrong_token(path: str, body: dict) -> None:
    response = client.post(path, json=body, headers={"Authorization": "Bearer not-the-token"})
    assert response.status_code == 401


def test_v1_route_rejects_non_bearer_scheme() -> None:
    response = client.post(
        "/v1/guidance/recommend", json=GUIDANCE_BODY, headers={"Authorization": f"Basic {TEST_SERVICE_TOKEN}"}
    )
    assert response.status_code == 401


def test_v1_route_accepts_the_service_token() -> None:
    response = client.post(
        "/v1/guidance/recommend", json=GUIDANCE_BODY, headers={"Authorization": f"Bearer {TEST_SERVICE_TOKEN}"}
    )
    assert response.status_code == 200


def test_unconfigured_token_fails_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "service_token", None)
    monkeypatch.setattr(get_settings(), "allow_unauthenticated", False)
    response = client.post(
        "/v1/guidance/recommend", json=GUIDANCE_BODY, headers={"Authorization": f"Bearer {TEST_SERVICE_TOKEN}"}
    )
    assert response.status_code == 503


def test_local_development_switch_allows_unauthenticated(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "service_token", None)
    monkeypatch.setattr(get_settings(), "allow_unauthenticated", True)
    response = client.post("/v1/guidance/recommend", json=GUIDANCE_BODY)
    assert response.status_code == 200


def test_health_needs_no_token() -> None:
    assert client.get("/health").status_code == 200
