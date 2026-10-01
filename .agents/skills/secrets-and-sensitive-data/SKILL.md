---
name: secrets-and-sensitive-data
description: >-
  Protect passwords, tokens, API keys, and sensitive data from leaking into source code, logs, or API responses. Use this when handling secrets or sensitive customer/supplier data.
---

# Secrets and Sensitive Data

Protect all passwords, JWT secrets, API keys, database credentials, AWS/payment credentials, webhook secrets, tokens, cookies, session identifiers, and sensitive customer/supplier data (PII).

## Requirements

1. **Source of Secrets**: Secrets must come from environment, configuration, or a secrets manager.
2. **No Commits**: `.env` values and production credentials must never be committed. Example environment files may contain variable names but never real values.
3. **Logging**: 
   - Never print secrets in logs. 
   - Never include secrets in exceptions.
   - Avoid logging complete customer objects. Prefer structured redaction for sensitive logs.
4. **API Responses**: Never expose secrets in API responses.
5. **Code Review**: Flag suspicious literals that resemble secrets.
