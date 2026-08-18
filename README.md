# tmux-webui

A lightweight Go WebUI for viewing and controlling tmux sessions on the local Linux machine.

The project preserves the existing tmux + Codex workflow and flexibility while providing a more comfortable interface for reading and input. It does not depend on Codex protocols or take ownership of processes. To the backend, Codex is simply another terminal program running inside a tmux pane.

Reader is the default view. tmux interprets the terminal state, and the browser renders the pane history as normal DOM text. You can scroll, select, and copy it like a document, then continue interacting through a separate input box. Terminal connects to a real PTY and remains available for Vim, shells, full-screen TUIs, and complex keyboard shortcuts.

## Features

- Automatically lists local tmux sessions with their window count, attached clients, path, and recent activity.
- Opens each tmux session once as a tab; choosing an already-open session focuses its existing tab.
- Creates detached tmux sessions from the sidebar and opens them immediately in the active editor group.
- Closes tabs without terminating their tmux sessions, reorders tabs by dragging, and moves tabs between editor groups.
- Drags sessions directly from the sidebar into an editor group or onto an edge to create a split, without duplicating an already-open session.
- Splits any editor group right or down, supports nested layouts, and resizes split dividers by pointer or keyboard.
- Creates a split by dragging a tab to an editor edge; dropping in the center moves it into that editor group.
- Automatically closes open tabs after a successful refresh confirms that their tmux session ended, and discards ended sessions when restoring a saved layout.
- Renames the active tmux session directly from the workspace toolbar.
- Shows the complete pane history in Reader with ANSI text and background colors, native browser scrolling, selection, and copy.
- Renders safe HTTP and HTTPS OSC 8 terminal hyperlinks as clickable Reader links.
- Opens Reader at the latest output without following later updates unless the persistent Auto-follow option is enabled.
- Provides a separate Reader input box with Esc, Ctrl C, and Tab controls.
- Switches to Terminal at any time for direct keyboard and terminal mouse input.
- Supports mouse clicks, dragging, scrolling, and tmux pane or TUI mouse modes.
- Supports text selection, `Ctrl/Cmd+C` to copy, and `Ctrl/Cmd+V` or the toolbar button to paste.
- Resizes the PTY with the browser so tmux and its applications receive real resize events.
- Detaches only the browser's tmux client when the page disconnects; the session keeps running.

The tab shortcuts follow the familiar editor conventions: `Ctrl/Cmd+W` closes
the active tab, `Ctrl/Cmd+Tab` cycles tabs in the active group, and
`Ctrl/Cmd+\` splits the active tab to the right. The split buttons in each tab
bar also support right and down splits. An explicit split may show the same
session in two groups; normal sidebar opening still de-duplicates globally.

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

If no session exists yet, use the `+` button next to Sessions or run:

```bash
tmux new-session -s work
```

## Docker

On a Linux host, the container can control existing host tmux sessions without
shipping a second tmux client. It enters the host mount namespace and executes
the host's own tmux binary:

```bash
docker build -t tmux-webui:local .
docker run --detach --rm --name tmux-webui \
  -p 127.0.0.1:7681:7681 \
  --pid=host \
  --userns=host \
  --privileged \
  -e HOST_UID="$(id -u)" \
  -e HOST_GID="$(id -g)" \
  -e HOST_TMUX_BIN="$(command -v tmux)" \
  -e TMUX \
  -e TMUX_TMPDIR \
  tmux-webui:local
```

Then open <http://127.0.0.1:7681>. The WebUI lists and attaches to the host's
existing tmux sessions. Stopping the container does not stop those sessions.

The same flow is available as:

```bash
make docker-run
```

This rebuilds the image, replaces an existing `tmux-webui` container if one is
present, and starts the new container in the background. Use
`docker logs -f tmux-webui` to follow its logs and `docker stop tmux-webui` to
stop and remove it. Set `CONTAINER=name` when invoking `make docker-run` to use
a different container name.

`HOST_TMUX_BIN` may point to any absolute tmux path on the host. Because the
host binary runs inside the host mount namespace, its version, libraries,
configuration, and socket always match the running server. No host filesystem
or socket bind mount is needed.

> **Danger:** `--privileged --pid=host --userns=host` makes this a host
> management container, comparable to a system service rather than a sandboxed
> application. A container escape or command execution vulnerability can lead
> to full host compromise. Use only a trusted local image, never add untrusted
> code, and keep the host-side port bound to `127.0.0.1`. Publishing it on all
> interfaces would expose an unauthenticated interface with control of the
> host's tmux sessions.

## Security Boundary

This WebUI has the same effective access as an interactive shell owned by the current Unix user. By default, the server accepts only `127.0.0.1` and `::1` listen addresses and validates same-origin WebSocket requests.

The privileged Docker mode is an explicit exception to this boundary: the
container itself has host-level privileges even though `host-tmux` switches to
the selected host UID/GID before invoking tmux.

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
npm --prefix frontend test
npm --prefix frontend run build
```

## Implementation

```text
Visible tab Reader  ── capture API ── tmux capture-pane ── session
Visible tab Input   ── WebSocket ──── Linux PTY ── tmux client ─┘
Visible tab Terminal + xterm.js ──────┘
```

The backend accepts only sessions that exactly match the output of `tmux list-sessions`, and rename operations target the stable tmux session ID. New sessions are created detached with validated names. Browser input and session names are never passed through a local shell. On connection, it enables `mouse on` for the selected tmux session so panes and full-screen applications can receive mouse events.

Each visible editor group owns its own PTY/WebSocket and fast Reader refresh
loop. Inactive open Reader tabs disconnect their PTY/WebSocket but refresh at a
lower frequency, keeping a recent browser-side snapshot ready for tab switches
without creating an extra tmux client per tab. Closing a tab affects only the
browser workspace and does not send a tmux kill command.

The xterm.js frontend dependencies use the MIT License. Their copyright and license details are available in the corresponding npm packages.

See [Reader Mode Technical Design](docs/reader-mode-design.md) for the complete design.
