# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.x.x   | :white_check_mark: |

## Reporting a Vulnerability

We take security seriously. If you discover a security vulnerability in Enginehaus, please report it responsibly.

### How to Report

**For sensitive security issues:**
- Email: security@enginehaus.dev
- Include: Description, reproduction steps, potential impact, and any suggested fixes

**For non-sensitive issues:**
- Open a GitHub issue with the `security` label

### What to Expect

1. **Acknowledgment**: We'll respond within 48 hours
2. **Investigation**: We'll investigate and keep you updated
3. **Fix**: We'll work on a fix and coordinate disclosure
4. **Credit**: With your permission, we'll credit you in the release notes

### Scope

This policy covers:
- The Enginehaus MCP server (`enginehaus`)
- The Enginehaus CLI (`enginehaus`)
- The web dashboard (Wheelhaus)
- Official documentation

### Out of Scope

- Third-party dependencies (report to respective maintainers)
- Social engineering attacks
- Issues in forked repositories

## Security Best Practices

When using Enginehaus:

1. **Local-first**: By default, data stays on your machine in SQLite
2. **API keys**: If using the tunnel feature, keep API keys secure
3. **MCP permissions**: Only grant MCP access to trusted AI tools
4. **Updates**: Keep Enginehaus updated to get security patches

## Known Security Considerations

- **Local SQLite storage**: The database at `~/.enginehaus/data/` contains task and decision data. Apply appropriate file permissions.
- **HTTP server**: When running `enginehaus serve`, the API is accessible on localhost. Be cautious when exposing to networks.
- **Cloudflare tunnel**: Temporary public URLs are created. API key authentication is required but treat URLs as sensitive.

---

*Last updated: January 2026*
