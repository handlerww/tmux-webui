//go:build linux

package terminal

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestWithTerminalEnvironment(t *testing.T) {
	got := withTerminalEnvironment([]string{"PATH=/bin", "TERM=old", "COLORTERM=old", "HOME=/tmp"})
	want := map[string]bool{
		"PATH=/bin": true, "HOME=/tmp": true, "TERM=xterm-256color": true,
		"COLORTERM=truecolor": true, "TERM_PROGRAM=tmux-webui": true,
	}
	if len(got) != len(want) {
		t.Fatalf("got %#v", got)
	}
	for _, item := range got {
		if !want[item] {
			t.Fatalf("unexpected environment item %q", item)
		}
	}
}

func TestAttachArgumentsKeepSessionAsOneArgument(t *testing.T) {
	args := attachArguments("work; kill-server")
	if args[3] != "work; kill-server" || args[9] != "work; kill-server" {
		t.Fatalf("session name was not preserved as one argument: %#v", args)
	}
}

func TestAttachProvidesInteractivePTY(t *testing.T) {
	script := filepath.Join(t.TempDir(), "fake-tmux")
	contents := "#!/bin/sh\nprintf 'READY:%s\\n' \"$TERM\"\nstty size\nIFS= read -r line\nprintf 'ECHO:%s\\n' \"$line\"\n"
	if err := os.WriteFile(script, []byte(contents), 0o700); err != nil {
		t.Fatal(err)
	}

	pty, err := Attach(script, "test", 101, 37)
	if err != nil {
		t.Fatal(err)
	}
	defer pty.Close()

	result := make(chan string, 1)
	go func() {
		var output bytes.Buffer
		buffer := make([]byte, 1024)
		for {
			count, readErr := pty.Read(buffer)
			output.Write(buffer[:count])
			if strings.Contains(output.String(), "ECHO:hello") || readErr != nil {
				result <- output.String()
				return
			}
		}
	}()
	if _, err := pty.Write([]byte("hello\n")); err != nil {
		t.Fatal(err)
	}

	select {
	case output := <-result:
		for _, expected := range []string{"READY:xterm-256color", "37 101", "ECHO:hello"} {
			if !strings.Contains(output, expected) {
				t.Fatalf("PTY output %q does not contain %q", output, expected)
			}
		}
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for PTY output")
	}
}
