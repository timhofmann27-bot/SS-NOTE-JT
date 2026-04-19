# Contributing to SS-Note

Thank you for your interest in contributing to SS-Note! This is a security-critical messaging application, so we have strict contribution guidelines.

## Security-First Development

SS-Note is an end-to-end encrypted messaging app. **Any change to the cryptography, authentication, or data handling code requires:**

1. A detailed security analysis in the PR description
2. At least 2 approvals from maintainers
3. Passing all CI/CD checks including security scans

## Getting Started

### Prerequisites

- Python 3.11+ (backend)
- Node.js 20+ (frontend)
- MongoDB 7+ (local development)
- Docker & Docker Compose (production deployment)

### Development Setup

```bash
# Backend
cd backend
pip install -r requirements.txt
export MONGO_URL=mongodb://localhost:27017
export JWT_SECRET=$(python -c "import secrets; print(secrets.token_hex(64))")
export TESTING=true
uvicorn server:app --reload --port 8001

# Frontend
cd frontend
npm install
npx expo start
```

### Running Tests

```bash
# Backend tests
cd backend
pytest tests/ -v

# Security scan
pip install bandit
bandit -r . -ll

# Frontend type check
cd frontend
npx tsc --noEmit
```

## Pull Request Process

1. **Fork** the repository
2. **Create a feature branch** (`git checkout -b feature/my-feature`)
3. **Write tests** for new functionality
4. **Run the full test suite** locally
5. **Update documentation** if needed
6. **Submit a PR** with a clear description of changes

### PR Requirements

- [ ] Tests pass (`pytest tests/ -v`)
- [ ] Security scan passes (`bandit -r . -ll`)
- [ ] TypeScript compiles (`npx tsc --noEmit`)
- [ ] Docker build succeeds (`docker build .`)
- [ ] No hardcoded secrets or credentials
- [ ] No new dependencies without justification

### Crypto Changes

Changes to `crypto.ts`, `server.py` (key management, encryption endpoints), or any cryptographic protocol require:

- [ ] Mathematical proof or reference to established protocol
- [ ] Test vectors with known-good implementations
- [ ] Threat model update
- [ ] Security review from at least 2 maintainers

## Code Style

### Python (Backend)

- Follow PEP 8
- Use type hints
- Maximum line length: 120 characters
- German comments are acceptable (codebase is German)

### TypeScript (Frontend)

- Strict mode enabled
- No `any` types without justification
- Functional components with hooks
- German UI text, English code comments

## Security Guidelines

### DO

- Use `Storage` wrapper instead of direct `SecureStore` (web compatibility)
- Use `Platform.OS === 'web'` guards for native modules
- Validate all user input (Pydantic models on backend)
- Use parameterized queries (MongoDB driver handles this)
- Log security events via `audit_log()`

### DON'T

- Store plaintext passwords or keys
- Log sensitive data (IPs, message content, keys)
- Use `eval()` or `exec()`
- Hardcode secrets or API keys
- Disable security headers or CORS without justification
- Commit `.env` files or credentials

## Reporting Security Issues

See [SECURITY.md](./SECURITY.md) for our security policy and bug bounty program.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
