.PHONY: build frontend test clean run docker-build docker-run

BIN := bin/tmux-webui
IMAGE ?= tmux-webui:local
CONTAINER ?= tmux-webui
HOST_UID := $(shell id -u)
HOST_GID := $(shell id -g)
HOST_TMUX_BIN ?= $(shell command -v tmux)

build: frontend
	go build -trimpath -o $(BIN) ./cmd/tmux-webui

frontend:
	npm --prefix frontend ci
	npm --prefix frontend run build

test:
	go test ./...
	npm --prefix frontend test
	npm --prefix frontend run build

clean:
	rm -rf bin

run:
	go run ./cmd/tmux-webui

docker-build:
	docker build -t $(IMAGE) .

docker-run: docker-build
	@if docker container inspect $(CONTAINER) >/dev/null 2>&1; then \
		echo "Replacing existing container $(CONTAINER)"; \
		docker container rm --force $(CONTAINER); \
	fi
	docker run --detach --rm --name $(CONTAINER) \
		-p 127.0.0.1:7681:7681 \
		--pid=host \
		--userns=host \
		--privileged \
		-e HOST_UID="$(HOST_UID)" \
		-e HOST_GID="$(HOST_GID)" \
		-e HOST_TMUX_BIN="$(HOST_TMUX_BIN)" \
		-e TMUX \
		-e TMUX_TMPDIR \
		$(IMAGE)
