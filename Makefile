# Dashboard Makefile
.PHONY: rebuild up down logs backend-logs frontend-logs status

rebuild:
	@./rebuild.sh

up:
	docker compose up -d

down:
	docker compose down

logs:
	docker compose logs -f

backend-logs:
	docker compose logs -f backend

frontend-logs:
	docker compose logs -f frontend

status:
	docker compose ps
