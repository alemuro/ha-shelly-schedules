.DEFAULT_GOAL := help

.PHONY: help
help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

.PHONY: install
install: ## Install development dependencies with uv
	uv venv
	uv pip install -e ".[dev]"

.PHONY: lint
lint: ## Run linter and code formatting checks
	uv run ruff check .
	uv run ruff format --check .

.PHONY: format
format: ## Format code with ruff
	uv run ruff check --fix .
	uv run ruff format .

.PHONY: test
test: ## Run unit tests
	uv run pytest -v tests/

.PHONY: validate-hacs
validate-hacs: ## Validate repository with HACS action locally (using docker)
	docker run --rm -v $(PWD):/workdir ghcr.io/hacs/action/validate:latest integration
