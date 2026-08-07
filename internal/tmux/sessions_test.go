package tmux

import (
	"testing"
	"time"
)

func TestParseSessions(t *testing.T) {
	input := "$1\x1fwork\x1f/srv/work tree\x1f3\x1f2\x1f1723000000\x1f1723000100\n" +
		"$2\x1fnotes with spaces\x1f/root/notes\x1f1\x1f0\x1f1723000200\x1f1723000300\n"

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
	if _, err := parseSessions("$1\x1fmissing"); err == nil {
		t.Fatal("expected an error")
	}
}

func TestCaptureArgumentsKeepSessionAsOneArgument(t *testing.T) {
	args := captureArguments("work; kill-server")
	if args[len(args)-1] != "work; kill-server" {
		t.Fatalf("session name was not preserved as one argument: %#v", args)
	}
}
