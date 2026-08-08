# syntax=docker/dockerfile:1

FROM node:22-alpine AS frontend

WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build


FROM golang:1.24-alpine AS builder

WORKDIR /src
COPY go.mod ./
COPY cmd/ ./cmd/
COPY internal/ ./internal/
COPY web/assets.go ./web/assets.go
COPY --from=frontend /src/web/dist ./web/dist
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/tmux-webui ./cmd/tmux-webui


FROM alpine:3.22

RUN apk add --no-cache ca-certificates util-linux

COPY --from=builder /out/tmux-webui /usr/local/bin/tmux-webui
COPY host-tmux /usr/local/bin/host-tmux
RUN chmod 755 /usr/local/bin/host-tmux

ENV HOME=/tmp \
    HOST_UID=0 \
    HOST_GID=0 \
    HOST_TMUX_BIN=/usr/bin/tmux
WORKDIR /tmp

EXPOSE 7681

ENTRYPOINT ["/usr/local/bin/tmux-webui"]
CMD ["--listen=0.0.0.0:7681", "--allow-remote", "--tmux=/usr/local/bin/host-tmux"]
