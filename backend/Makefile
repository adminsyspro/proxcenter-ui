.PHONY: build run test clean docker-build docker-run lint fmt deps

# Variables
BINARY_NAME=orchestrator
MAIN_PATH=./cmd/orchestrator
DOCKER_IMAGE=proxcenter-orchestrator
VERSION?=dev

# Go parameters
GOCMD=go
GOBUILD=$(GOCMD) build
GOTEST=$(GOCMD) test
GOGET=$(GOCMD) get
GOMOD=$(GOCMD) mod
GOFMT=gofmt
GOLINT=golangci-lint

# Build the application
build:
	@echo "Building $(BINARY_NAME)..."
	CGO_ENABLED=1 $(GOBUILD) -o $(BINARY_NAME) -ldflags "-X main.Version=$(VERSION)" $(MAIN_PATH)

# Run the application
run: build
	./$(BINARY_NAME) -config config.yaml

# Run in development mode with hot reload (requires air)
dev:
	air -c .air.toml

# Run tests
test:
	$(GOTEST) -v -race -cover ./...

# Run tests with coverage report
test-coverage:
	$(GOTEST) -v -race -coverprofile=coverage.out ./...
	$(GOCMD) tool cover -html=coverage.out -o coverage.html

# Clean build artifacts
clean:
	@echo "Cleaning..."
	rm -f $(BINARY_NAME)
	rm -f coverage.out coverage.html
	rm -rf data/*.db

# Download dependencies
deps:
	$(GOMOD) download
	$(GOMOD) tidy

# Format code
fmt:
	$(GOFMT) -s -w .

# Run linter
lint:
	$(GOLINT) run ./...

# Build Docker image
docker-build:
	docker build -t $(DOCKER_IMAGE):$(VERSION) .
	docker tag $(DOCKER_IMAGE):$(VERSION) $(DOCKER_IMAGE):latest

# Run with Docker Compose
docker-run:
	docker-compose up -d

# Stop Docker Compose
docker-stop:
	docker-compose down

# View logs
docker-logs:
	docker-compose logs -f orchestrator

# Run with monitoring stack
docker-run-full:
	docker-compose --profile monitoring up -d

# Generate API documentation (requires swag)
docs:
	swag init -g cmd/orchestrator/main.go -o docs

# Install development tools
tools:
	go install github.com/air-verse/air@latest
	go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest
	go install github.com/swaggo/swag/cmd/swag@latest

# Initialize project (first time setup)
init: deps
	mkdir -p data
	cp config.yaml.example config.yaml 2>/dev/null || cp config.yaml config.yaml.example

# Help
help:
	@echo "ProxCenter Orchestrator - Available commands:"
	@echo ""
	@echo "  build          Build the binary"
	@echo "  run            Build and run the application"
	@echo "  dev            Run with hot reload (requires air)"
	@echo "  test           Run tests"
	@echo "  test-coverage  Run tests with coverage report"
	@echo "  clean          Clean build artifacts"
	@echo "  deps           Download dependencies"
	@echo "  fmt            Format code"
	@echo "  lint           Run linter"
	@echo "  docker-build   Build Docker image"
	@echo "  docker-run     Run with Docker Compose"
	@echo "  docker-stop    Stop Docker Compose"
	@echo "  docker-logs    View Docker logs"
	@echo "  docker-run-full Run with monitoring stack"
	@echo "  docs           Generate API documentation"
	@echo "  tools          Install development tools"
	@echo "  init           Initialize project"
	@echo "  help           Show this help"
