package tmux

import (
	"context"
	"errors"
	"fmt"
	"os/exec"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Keep the separator printable: host-management containers may invoke tmux
// through nsenter, which sanitizes control characters in command arguments.
const fieldSeparator = "<<<tmux-webui-field>>>"

var (
	ErrSessionExists   = errors.New("tmux session already exists")
	ErrSessionNotFound = errors.New("tmux session not found")
)

type Session struct {
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	Path         string    `json:"path"`
	Windows      int       `json:"windows"`
	Attached     int       `json:"attached"`
	CreatedAt    time.Time `json:"createdAt"`
	LastActivity time.Time `json:"lastActivity"`
}

type Client struct {
	Binary string
}

func (c Client) List(ctx context.Context) ([]Session, error) {
	format := strings.Join([]string{
		"#{session_id}",
		"#{session_name}",
		"#{session_path}",
		"#{session_windows}",
		"#{session_attached}",
		"#{session_created}",
		"#{session_activity}",
	}, fieldSeparator)
	cmd := exec.CommandContext(ctx, c.Binary, "list-sessions", "-F", format)
	output, err := cmd.CombinedOutput()
	if err != nil {
		if isNoServerError(err, string(output)) {
			return []Session{}, nil
		}
		return nil, fmt.Errorf("list tmux sessions: %w: %s", err, strings.TrimSpace(string(output)))
	}

	sessions, err := parseSessions(string(output))
	if err != nil {
		return nil, err
	}
	sort.Slice(sessions, func(i, j int) bool {
		if sessions[i].LastActivity.Equal(sessions[j].LastActivity) {
			return sessions[i].Name < sessions[j].Name
		}
		return sessions[i].LastActivity.After(sessions[j].LastActivity)
	})
	return sessions, nil
}

func (c Client) Has(ctx context.Context, name string) (bool, error) {
	sessions, err := c.List(ctx)
	if err != nil {
		return false, err
	}
	for _, session := range sessions {
		if session.Name == name {
			return true, nil
		}
	}
	return false, nil
}

// Capture returns the active pane's rendered history and visible content. tmux
// performs the terminal-state rendering; -J joins soft-wrapped rows so a web
// reader can apply its own wrapping without changing hard line breaks.
func (c Client) Capture(ctx context.Context, name string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, c.Binary, captureArguments(name)...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("capture tmux pane: %w: %s", err, strings.TrimSpace(string(output)))
	}
	return output, nil
}

// Rename changes a session name without invoking a shell. Callers should use
// the stable tmux session ID as target so names containing target separators do
// not become ambiguous.
func (c Client) Rename(ctx context.Context, target, name string) error {
	cmd := exec.CommandContext(ctx, c.Binary, renameArguments(target, name)...)
	output, err := cmd.CombinedOutput()
	if err == nil {
		return nil
	}

	message := strings.ToLower(string(output))
	switch {
	case strings.Contains(message, "duplicate session"):
		return fmt.Errorf("%w: %s", ErrSessionExists, strings.TrimSpace(string(output)))
	case strings.Contains(message, "can't find session"),
		strings.Contains(message, "no server running"),
		strings.Contains(message, "no sessions"):
		return fmt.Errorf("%w: %s", ErrSessionNotFound, strings.TrimSpace(string(output)))
	default:
		return fmt.Errorf("rename tmux session: %w: %s", err, strings.TrimSpace(string(output)))
	}
}

func captureArguments(name string) []string {
	return []string{"capture-pane", "-p", "-J", "-S", "-", "-t", name}
}

func renameArguments(target, name string) []string {
	return []string{"rename-session", "-t", target, name}
}

func parseSessions(output string) ([]Session, error) {
	output = strings.TrimSpace(output)
	if output == "" {
		return []Session{}, nil
	}
	lines := strings.Split(output, "\n")
	sessions := make([]Session, 0, len(lines))
	for lineNumber, line := range lines {
		fields := strings.Split(strings.TrimSuffix(line, "\r"), fieldSeparator)
		if len(fields) != 7 {
			return nil, fmt.Errorf("parse tmux sessions: line %d has %d fields", lineNumber+1, len(fields))
		}
		windows, err := strconv.Atoi(fields[3])
		if err != nil {
			return nil, fmt.Errorf("parse tmux window count on line %d: %w", lineNumber+1, err)
		}
		attached, err := strconv.Atoi(fields[4])
		if err != nil {
			return nil, fmt.Errorf("parse tmux attached count on line %d: %w", lineNumber+1, err)
		}
		created, err := parseUnixTime(fields[5])
		if err != nil {
			return nil, fmt.Errorf("parse tmux created time on line %d: %w", lineNumber+1, err)
		}
		activity, err := parseUnixTime(fields[6])
		if err != nil {
			return nil, fmt.Errorf("parse tmux activity time on line %d: %w", lineNumber+1, err)
		}
		sessions = append(sessions, Session{
			ID:           fields[0],
			Name:         fields[1],
			Path:         fields[2],
			Windows:      windows,
			Attached:     attached,
			CreatedAt:    created,
			LastActivity: activity,
		})
	}
	return sessions, nil
}

func parseUnixTime(value string) (time.Time, error) {
	seconds, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return time.Time{}, err
	}
	return time.Unix(seconds, 0).UTC(), nil
}

func isNoServerError(err error, output string) bool {
	var exitErr *exec.ExitError
	if !errors.As(err, &exitErr) {
		return false
	}
	message := strings.ToLower(output)
	return strings.Contains(message, "no server running") || strings.Contains(message, "no sessions")
}
