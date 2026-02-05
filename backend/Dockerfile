# Build stage
FROM golang:1.24-alpine AS builder

WORKDIR /app

# Install dependencies
RUN apk add --no-cache gcc musl-dev sqlite-dev git

# Copy everything and build in one step
COPY . .

# Download and build
RUN go mod download && \
    CGO_ENABLED=1 GOOS=linux go build -a -ldflags '-linkmode external -extldflags "-static"' -o orchestrator ./cmd/orchestrator

# Runtime stage
FROM alpine:3.19

WORKDIR /app

# Install runtime dependencies
RUN apk add --no-cache ca-certificates tzdata

# Create non-root user
RUN adduser -D -g '' appuser

# Create data directory
RUN mkdir -p /app/data && chown appuser:appuser /app/data

# Copy binary and config
COPY --from=builder /app/orchestrator .
COPY --from=builder /app/config.yaml* ./

# Switch to non-root user
USER appuser

# Expose API port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/api/v1/health || exit 1

# Run
ENTRYPOINT ["./orchestrator"]
CMD ["-config", "config.yaml"]
