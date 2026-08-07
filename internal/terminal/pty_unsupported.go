//go:build !linux

package terminal

import "fmt"

type PTY struct{}

func Attach(tmuxBinary, session string, columns, rows uint16) (*PTY, error) {
	return nil, fmt.Errorf("tmux-webui currently supports Linux hosts only")
}

func (p *PTY) Read(buffer []byte) (int, error)   { return 0, fmt.Errorf("unsupported") }
func (p *PTY) Write(data []byte) (int, error)    { return 0, fmt.Errorf("unsupported") }
func (p *PTY) Resize(columns, rows uint16) error { return fmt.Errorf("unsupported") }
func (p *PTY) Close() error                      { return nil }
