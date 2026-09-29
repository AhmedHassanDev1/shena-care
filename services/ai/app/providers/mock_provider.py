import re

from app.contracts.enrichment import (
    ProductEnrichmentRequest,
    ProductEnrichmentResult,
    ProductEnrichmentSuggestions,
    SizeSuggestion,
)
from app.providers.base import ProviderUnavailableError


_SIZE_PATTERN = re.compile(r"(\d+(?:[.,]\d+)?)\s*(ml|l|g|kg|oz)\b", re.IGNORECASE)


class MockProductEnrichmentProvider:
    """Deterministic rule-based provider for local development and tests."""

    name = "mock"

    async def enrich(self, request: ProductEnrichmentRequest) -> ProductEnrichmentResult:
        if request.rawTitle == "__UNAVAILABLE__":
            raise ProviderUnavailableError("Mock provider simulated unavailability")

        normalized_title = self._normalize_title(request.rawTitle)
        package_text = request.packageText or ""
        combined_text = " ".join(part for part in [request.rawTitle, package_text, request.description] if part)

        size = self._extract_size(combined_text)
        barcode = request.barcode or self._extract_barcode(combined_text)

        return ProductEnrichmentResult(
            schemaVersion="1",
            suggestions=ProductEnrichmentSuggestions(
                normalizedTitle=normalized_title,
                brand=request.brand or self._titlecase_first_word(normalized_title),
                description=self._build_description(normalized_title),
                size=size,
                barcode=barcode,
                ingredients=self._tokenize_field(combined_text, "ingredients"),
                benefits=[],
                usage=["Apply to clean skin once or twice daily."],
                warnings=["For external use only. Discontinue if irritation occurs."],
            ),
            confidence={
                "normalizedTitle": 0.9,
                "brand": 0.9 if request.brand else 0.5,
                "description": 0.8,
                "size": 0.85 if size else 0.0,
                "barcode": 1.0 if request.barcode else 0.4 if barcode else 0.0,
            },
            warnings=[] if size else ["No package size detected in source text."],
            providerMetadata={
                "provider": self.name,
                "strategy": "rule-based-mock",
            },
        )

    def _normalize_title(self, raw_title: str) -> str:
        collapsed = re.sub(r"\s+", " ", raw_title).strip()
        return collapsed[:255]

    def _titlecase_first_word(self, title: str) -> str | None:
        if not title:
            return None
        return title.split(" ", 1)[0].capitalize()

    def _build_description(self, title: str) -> str:
        return f"{title} is a personal care product suggested for catalog review."

    def _extract_size(self, text: str) -> SizeSuggestion | None:
        match = _SIZE_PATTERN.search(text)
        if not match:
            return None
        value = float(match.group(1).replace(",", "."))
        unit = match.group(2).lower()
        if value <= 0:
            return None
        return SizeSuggestion(value=value, unit=unit)

    def _extract_barcode(self, text: str) -> str | None:
        match = re.search(r"\b\d{8,14}\b", text)
        return match.group(0) if match else None

    def _tokenize_field(self, text: str, _field: str) -> list[str]:
        # The mock does not attempt real ingredient extraction.
        return []
