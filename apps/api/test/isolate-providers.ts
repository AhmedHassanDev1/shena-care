/**
 * Runs before every test file and before any module reads configuration. External research providers are switched off with defined-but-empty keys:
 * the app's ConfigModule never overrides a variable that is already defined, so a developer's real keys in `.env` cannot leak into a test run.
 * A test that needs a provider sets its own key (or replaces the provider) explicitly.
 */
for (const key of ['EXA_API_KEY', 'FIRECRAWL_API_KEY', 'GROK_API_KEY']) process.env[key] = '';
