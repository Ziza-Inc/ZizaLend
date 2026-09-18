---
title: "Add Docker healthcheck configuration for Redis service"
area: infrastructure
difficulty: beginner
labels: ["docker", "good first issue", "help wanted", "infrastructure"]
---


## Description

The `docker-compose.yml` file defines healthchecks for the PostgreSQL and backend services but is missing a healthcheck for the **Redis** service. Adding a Redis healthcheck improves service reliability and ensures the backend doesn't start before Redis is ready.

## Background

Current `docker-compose.yml` Redis service:
```yaml
redis:
  image: redis:alpine
  restart: always
  ports:
    - "6380:6379"
```

Compare with the DB service that has a healthcheck:
```yaml
db:
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U postgres -d ZizaLend"]
    interval: 5s
    timeout: 5s
    retries: 5
```

## Requirements

- Add a healthcheck to the Redis service using `redis-cli ping`
- The backend service should `depends_on` Redis with `condition: service_healthy`
- Use reasonable healthcheck parameters (interval: 5s, timeout: 3s, retries: 5)
- Also update `docker-compose.staging.yml` to include the same healthcheck

## Definition of Done

- `docker compose up` starts Redis before the backend
- Backend waits for Redis to be healthy before starting
- `docker compose ps` shows Redis as healthy
- Both `docker-compose.yml` and `docker-compose.staging.yml` are updated
