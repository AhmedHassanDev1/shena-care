import os

# Set before any test imports app.main: settings are read once and cached.
TEST_SERVICE_TOKEN = "test-service-token"
os.environ.setdefault("AI_SERVICE_TOKEN", TEST_SERVICE_TOKEN)
os.environ.setdefault("AI_PROVIDER", "mock")
