# TeamForge — Load Test Report

## Environment
- Test date: 2026-11-11
- Environment: Local development, macOS arm64
- Database: PostgreSQL 16 (Docker)
- Users in database: 10,059
- Teams in database: 2,004
- Test tool: Grafana k6

## Test Configuration
- Endpoint: GET /api/board?page=0
- Concurrent virtual users: 100
- Duration: 25 seconds
- Command: k6 run load/board.js

## Actual Results
- Total requests: 61,857
- p95 response time: 58.63 ms
- HTTP failure rate: 0.00%
- Required p95: below 200 ms
- Result: PASS

## Concurrency Correctness
- Automated API tests: 32 passed, 0 failed
- Final-seat test: 50 concurrent users
- Exactly one successful join verified
- Membership count consistency verified

## Conclusion
The locally tested implementation meets the specified
board latency and concurrency targets.

Production performance has not yet been measured.
