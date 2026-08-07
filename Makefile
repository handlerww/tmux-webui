.PHONY: build frontend test clean

BIN := bin/tmux-webui

build: frontend
	go build -trimpath -o $(BIN) ./cmd/tmux-webui

frontend:
	npm --prefix frontend ci
	npm --prefix frontend run build

test:
	go test ./...
	npm --prefix frontend run build

clean:
	rm -rf bin

run:
	go run ./cmd/tmux-webui
