# tmux-webui

A lightweight Go WebUI for viewing and controlling tmux sessions on the local Linux machine.

The project preserves the existing tmux + Codex workflow and flexibility while providing a more comfortable interface for reading and input. It does not depend on Codex protocols or take ownership of processes. To the backend, Codex is simply another terminal program running inside a tmux pane.

Reader is the default view. tmux interprets the terminal state, and the browser renders the pane history as normal DOM text. You can scroll, select, and copy it like a document, then continue interacting through a separate input box. Terminal connects to a real PTY and remains available for Vim, shells, full-screen TUIs, and complex keyboard shortcuts.

## Features

- Automatically lists local tmux sessions with their window count, attached clients, path, and recent activity.
- Shows the complete pane history in Reader with native browser scrolling, selection, and copy.
- Provides a separate Reader input box with Esc, Ctrl C, and Tab controls.
- Switches to Terminal at any time for direct keyboard and terminal mouse input.
- Supports mouse clicks, dragging, scrolling, and tmux pane or TUI mouse modes.
- Supports text selection, `Ctrl/Cmd+C` to copy, and `Ctrl/Cmd+V` or the toolbar button to paste.
- Resizes the PTY with the browser so tmux and its applications receive real resize events.
- Detaches only the browser's tmux client when the page disconnects; the session keeps running.

> When tmux or an application captures the mouse, hold `Shift` while dragging to force text selection. This matches tmux mouse-mode behavior in a local terminal.

## Quick Start

Requirements: Linux, Go 1.24+, and tmux. Built frontend assets are included, so Node.js is not required to run the server.

```bash
go run ./cmd/tmux-webui
```

Open <http://127.0.0.1:7681> in a browser.

You can also build a single executable:

```bash
go build -trimpath -o bin/tmux-webui ./cmd/tmux-webui
./bin/tmux-webui
```

If no session exists yet:

```bash
tmux new-session -s work
```

## Security Boundary

This WebUI has the same effective access as an interactive shell owned by the current Unix user. By default, the server accepts only `127.0.0.1` and `::1` listen addresses and validates same-origin WebSocket requests.

To access it from another machine, use SSH forwarding. Do not expose the unauthenticated service directly to a LAN or the public internet:

```bash
ssh -L 7681:127.0.0.1:7681 user@server
```

Then open <http://127.0.0.1:7681> in your local browser.

`--allow-remote` permits non-loopback listen addresses, but the project does not include authentication. Use it only behind a trusted authentication layer and TLS reverse proxy:

```bash
./bin/tmux-webui --listen 0.0.0.0:7681 --allow-remote
```

Available options:

```text
--listen string    HTTP listen address (default 127.0.0.1:7681)
--tmux string      Path to the tmux executable (default tmux)
--allow-remote     Allow non-loopback listen addresses
```

## Development

The frontend uses the official `@xterm/xterm` and `@xterm/addon-fit` packages. Go embeds the production build into the executable.

```bash
# Install frontend dependencies and rebuild web/dist
npm --prefix frontend ci
npm --prefix frontend run build

# Run the backend development server
go run ./cmd/tmux-webui

# Or run the frontend with hot reload and a proxy to :7681
npm --prefix frontend run dev
```

Run the checks:

```bash
go test ./...
npm --prefix frontend run build
```

## Implementation

```text
Reader  ── capture API ── tmux capture-pane ── selected session
Input   ── WebSocket ──── Linux PTY ── tmux client ─┘
Terminal + xterm.js ──────┘
```

The backend accepts only session names that exactly match the output of `tmux list-sessions`. Browser input is never passed through a local shell. On connection, it enables `mouse on` for the selected tmux session so panes and full-screen applications can receive mouse events.

The xterm.js frontend dependencies use the MIT License. Their copyright and license details are available in the corresponding npm packages.

See [Reader Mode Technical Design](docs/reader-mode-design.md) for the complete design.
