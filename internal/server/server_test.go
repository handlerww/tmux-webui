package server

import (
	"bytes"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDimensions(t *testing.T) {
	request := httptest.NewRequest("GET", "/ws?cols=160&rows=48", nil)
	columns, rows := dimensions(request.URL.Query())
	if columns != 160 || rows != 48 {
		t.Fatalf("got %dx%d", columns, rows)
	}

	request = httptest.NewRequest("GET", "/ws?cols=9999&rows=nope", nil)
	columns, rows = dimensions(request.URL.Query())
	if columns != 120 || rows != 32 {
		t.Fatalf("got fallback %dx%d", columns, rows)
	}
}

func TestSameOrigin(t *testing.T) {
	request := httptest.NewRequest("GET", "http://127.0.0.1:7681/ws", nil)
	request.Host = "127.0.0.1:7681"
	request.Header.Set("Origin", "http://127.0.0.1:7681")
	if !sameOrigin(request) {
		t.Fatal("expected matching origin")
	}
	request.Header.Set("Origin", "https://example.com")
	if sameOrigin(request) {
		t.Fatal("expected cross-origin request to be rejected")
	}
}

func TestValidateSessionName(t *testing.T) {
	tests := []struct {
		name string
		want string
	}{
		{name: "work"},
		{name: "work tree"},
		{name: "", want: "A session name is required"},
		{name: " work", want: "Session names cannot start or end with whitespace"},
		{name: "work\nnext", want: "Session names cannot contain control characters"},
		{name: strings.Repeat("x", 101), want: "Session names must be at most 100 characters"},
	}
	for _, test := range tests {
		if got := validateSessionName(test.name); got != test.want {
			t.Errorf("validateSessionName(%q) = %q, want %q", test.name, got, test.want)
		}
	}
}

func TestRenameSession(t *testing.T) {
	temporaryDirectory := t.TempDir()
	logPath := filepath.Join(temporaryDirectory, "arguments")
	tmuxBinary := filepath.Join(temporaryDirectory, "fake-tmux")
	script := fmt.Sprintf(`#!/bin/sh
if [ "$1" = "list-sessions" ]; then
  printf '%%s\n' '$7<<<tmux-webui-field>>>old name<<<tmux-webui-field>>>/srv/work<<<tmux-webui-field>>>1<<<tmux-webui-field>>>0<<<tmux-webui-field>>>1723000000<<<tmux-webui-field>>>1723000100'
  exit 0
fi
if [ "$1" = "rename-session" ]; then
  printf '%%s\n' "$2|$3|$4" > %q
  exit 0
fi
exit 1
`, logPath)
	if err := os.WriteFile(tmuxBinary, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	handler := New(tmuxBinary, logger)
	request := httptest.NewRequest(http.MethodPatch, "http://127.0.0.1/api/sessions/rename", bytes.NewBufferString(`{"id":"$7","name":"new work"}`))
	request.Header.Set("Origin", "http://127.0.0.1")
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("got status %d with body %s", response.Code, response.Body.String())
	}
	arguments, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatal(err)
	}
	if got, want := strings.TrimSpace(string(arguments)), "-t|$7|new work"; got != want {
		t.Fatalf("rename arguments = %q, want %q", got, want)
	}
}

func TestCreateSession(t *testing.T) {
	temporaryDirectory := t.TempDir()
	logPath := filepath.Join(temporaryDirectory, "arguments")
	tmuxBinary := filepath.Join(temporaryDirectory, "fake-tmux")
	script := fmt.Sprintf(`#!/bin/sh
if [ "$1" = "new-session" ]; then
  printf '%%s\n' "$2|$3|$4|$6|$7" > %q
  printf '%%s\n' '$9<<<tmux-webui-field>>>new work<<<tmux-webui-field>>>/tmp<<<tmux-webui-field>>>1<<<tmux-webui-field>>>0<<<tmux-webui-field>>>1723000000<<<tmux-webui-field>>>1723000000'
  exit 0
fi
exit 1
`, logPath)
	if err := os.WriteFile(tmuxBinary, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	handler := New(tmuxBinary, logger)
	request := httptest.NewRequest(http.MethodPost, "http://127.0.0.1/api/sessions", bytes.NewBufferString(`{"name":"new work"}`))
	request.Header.Set("Origin", "http://127.0.0.1")
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusCreated {
		t.Fatalf("got status %d with body %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"id":"$9"`) || !strings.Contains(response.Body.String(), `"name":"new work"`) {
		t.Fatalf("unexpected response body %s", response.Body.String())
	}
	arguments, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatal(err)
	}
	if got, want := strings.TrimSpace(string(arguments)), "-d|-P|-F|-s|new work"; got != want {
		t.Fatalf("create arguments = %q, want %q", got, want)
	}
}

func TestRenameSessionRejectsCrossOriginRequest(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	handler := New("unused", logger)
	request := httptest.NewRequest(http.MethodPatch, "http://127.0.0.1/api/sessions/rename", bytes.NewBufferString(`{"id":"$7","name":"new work"}`))
	request.Header.Set("Origin", "https://example.com")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusForbidden {
		t.Fatalf("got status %d, want %d", response.Code, http.StatusForbidden)
	}
}
