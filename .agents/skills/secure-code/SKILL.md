---
name: secure-code
description: >-
  Apply baseline secure coding requirements whenever code is created or modified. Use this to ensure input validation, prevent injections, and follow least privilege.
---

# Secure Code

Apply baseline secure coding requirements whenever code is created or modified.

## Requirements

1. **Input Validation**: Validate all inputs using `class-validator` DTOs. Never trust external input.
2. **Output Exposure**: Never return internal secrets, passwords, or sensitive implementation data in API responses.
3. **Injections**:
   - Parameterize every database query (Prisma does this by default, but avoid unsafe raw queries).
   - Prevent command injection and path traversal when handling files or system commands.
4. **Mass Assignment**: Avoid mass-assignment vulnerabilities. Never spread request body directly into database updates.
5. **Security Controls**: Never disable a security control or weaken validation merely to make development easier.
6. **Hardcoded Secrets**: Never hardcode credentials, secrets, or API keys.

## Actions
- Review created/modified code against these requirements.
- Ensure DTO validation is applied on all new endpoints.
