---
name: dependency-and-supply-chain-security
description: >-
  Use this when installing or changing dependencies to prevent supply chain attacks and unnecessary bloat.
---

# Dependency and Supply Chain Security

When installing or changing dependencies, evaluate the security impact.

## Requirements

1. **Minimize Dependencies**: Prefer existing dependencies where possible. Do not install packages for trivial functionality. Never solve a simple problem by adding a large dependency unnecessarily.
2. **Quality Checks**: Prefer actively maintained packages and avoid suspicious packages.
3. **Vulnerabilities**: Check dependency vulnerabilities (`npm audit`).
4. **Execution Risks**: Avoid unnecessary lifecycle scripts and unpinned arbitrary external scripts.
5. **Justification**: Explain why a new security-sensitive dependency is needed.
