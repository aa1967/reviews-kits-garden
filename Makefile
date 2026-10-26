.PHONY: dev stop cache storage

dev:
	bun run dev

stop:
	docker compose --profile '*' -f infra/docker-compose.dev.yml down

cache:
	bun run cache:start

storage:
	bun run storage:start
