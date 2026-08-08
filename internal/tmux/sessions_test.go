package tmux

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestParseSessions(t *testing.T) {
	input := "$1" + fieldSeparator + "work" + fieldSeparator + "/srv/work tree" + fieldSeparator + "3" + fieldSeparator + "2" + fieldSeparator + "1723000000" + fieldSeparator + "1723000100\n" +
		"$2" + fieldSeparator + "notes with spaces" + fieldSeparator + "/root/notes" + fieldSeparator + "1" + fieldSeparator + "0" + fieldSeparator + "1723000200" + fieldSeparator + "1723000300\n"

	sessions, err := parseSessions(input)
	if err != nil {
		t.Fatal(err)
	}
	if len(sessions) != 2 {
		t.Fatalf("got %d sessions, want 2", len(sessions))
	}
	if sessions[0].Name != "work" || sessions[0].Path != "/srv/work tree" || sessions[0].Windows != 3 || sessions[0].Attached != 2 {
		t.Fatalf("unexpected first session: %#v", sessions[0])
	}
	want := time.Unix(1723000100, 0).UTC()
	if !sessions[0].LastActivity.Equal(want) {
		t.Fatalf("got activity %v, want %v", sessions[0].LastActivity, want)
	}
}

func TestParseSessionsRejectsMalformedLine(t *testing.T) {
	if _, err := parseSessions("$1" + fieldSeparator + "missing"); err == nil {
		t.Fatal("expected an error")
	}
}

func TestCaptureArgumentsKeepSessionAsOneArgument(t *testing.T) {
	args := captureArguments("work; kill-server")
	if args[len(args)-1] != "work; kill-server" {
		t.Fatalf("session name was not preserved as one argument: %#v", args)
	}
}

func TestRenameArgumentsKeepValuesAsSingleArguments(t *testing.T) {
	args := renameArguments("$4", "work; kill-server")
	if len(args) != 4 || args[2] != "$4" || args[3] != "work; kill-server" {
		t.Fatalf("rename values were not preserved as individual arguments: %#v", args)
	}
}

func TestRenameClassifiesKnownErrors(t *testing.T) {
	tests := []struct {
		name   string
		output string
		want   error
	}{
		{name: "duplicate", output: "duplicate session: work", want: ErrSessionExists},
		{name: "missing", output: "can't find session: $4", want: ErrSessionNotFound},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			script := filepath.Join(t.TempDir(), "fake-tmux")
			contents := fmt.Sprintf("#!/bin/sh\nprintf '%%s\\n' %q >&2\nexit 1\n", test.output)
			if err := os.WriteFile(script, []byte(contents), 0o700); err != nil {
				t.Fatal(err)
			}
			err := (Client{Binary: script}).Rename(context.Background(), "$4", "work")
			if !errors.Is(err, test.want) {
				t.Fatalf("got error %v, want %v", err, test.want)
			}
		})
	}
}
