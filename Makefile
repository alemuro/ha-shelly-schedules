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
	PYTHONPATH=. uv run pytest -v tests/

.PHONY: test-local
test-local: ## Run Home Assistant container locally for testing
	docker run -d \
		--rm \
		--name homeassistant-test \
		-v $(shell pwd)/.config:/config \
		-v $(shell pwd)/custom_components:/config/custom_components \
		-p 8123:8123 \
		homeassistant/home-assistant:stable

.PHONY: test-local-stop
test-local-stop: ## Stop local Home Assistant test container
	docker stop homeassistant-test
