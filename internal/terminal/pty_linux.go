//go:build linux

package terminal

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"unsafe"
)

const (
	ioctlGetPTNumber = 0x80045430
	ioctlUnlockPT    = 0x40045431
	ioctlSetWinsize  = 0x5414
)

type winsize struct {
	Rows    uint16
	Columns uint16
	X       uint16
	Y       uint16
}

type PTY struct {
	master    *os.File
	command   *exec.Cmd
	closeOnce sync.Once
}

func Attach(tmuxBinary, session string, columns, rows uint16) (*PTY, error) {
	master, slave, err := openPTY(columns, rows)
	if err != nil {
		return nil, err
	}

	// Mouse mode belongs to the selected tmux session. Enabling it here lets tmux
	// and full-screen applications receive browser mouse events. Users can still
	// hold Shift while dragging to force local text selection in xterm.js.
	command := exec.Command(tmuxBinary, attachArguments(session)...)
	command.Stdin = slave
	command.Stdout = slave
	command.Stderr = slave
	command.Env = withTerminalEnvironment(os.Environ())
	command.SysProcAttr = &syscall.SysProcAttr{
		Setsid:  true,
		Setctty: true,
		Ctty:    0,
	}
	if err := command.Start(); err != nil {
		_ = master.Close()
		_ = slave.Close()
		return nil, fmt.Errorf("start tmux client: %w", err)
	}
	_ = slave.Close()

	return &PTY{master: master, command: command}, nil
}

func attachArguments(session string) []string {
	return []string{"-u", "set-option", "-t", session, "mouse", "on", ";", "attach-session", "-t", session}
}

func (p *PTY) Read(buffer []byte) (int, error) {
	return p.master.Read(buffer)
}

func (p *PTY) Write(data []byte) (int, error) {
	return p.master.Write(data)
}

func (p *PTY) Resize(columns, rows uint16) error {
	if columns == 0 || rows == 0 {
		return errors.New("terminal dimensions must be positive")
	}
	size := winsize{Rows: rows, Columns: columns}
	if err := ioctl(p.master.Fd(), ioctlSetWinsize, unsafe.Pointer(&size)); err != nil {
		return fmt.Errorf("resize pty: %w", err)
	}
	return nil
}

func (p *PTY) Close() error {
	var closeErr error
	p.closeOnce.Do(func() {
		closeErr = p.master.Close()
		if p.command.Process != nil {
			_ = syscall.Kill(-p.command.Process.Pid, syscall.SIGHUP)
		}
		_ = p.command.Wait()
	})
	return closeErr
}

func openPTY(columns, rows uint16) (*os.File, *os.File, error) {
	master, err := os.OpenFile("/dev/ptmx", os.O_RDWR|syscall.O_NOCTTY, 0)
	if err != nil {
		return nil, nil, fmt.Errorf("open /dev/ptmx: %w", err)
	}

	locked := int32(0)
	if err := ioctl(master.Fd(), ioctlUnlockPT, unsafe.Pointer(&locked)); err != nil {
		_ = master.Close()
		return nil, nil, fmt.Errorf("unlock pty: %w", err)
	}
	var number uint32
	if err := ioctl(master.Fd(), ioctlGetPTNumber, unsafe.Pointer(&number)); err != nil {
		_ = master.Close()
		return nil, nil, fmt.Errorf("get pty number: %w", err)
	}
	if columns == 0 {
		columns = 120
	}
	if rows == 0 {
		rows = 32
	}
	size := winsize{Rows: rows, Columns: columns}
	if err := ioctl(master.Fd(), ioctlSetWinsize, unsafe.Pointer(&size)); err != nil {
		_ = master.Close()
		return nil, nil, fmt.Errorf("set initial pty size: %w", err)
	}

	slavePath := "/dev/pts/" + strconv.FormatUint(uint64(number), 10)
	slave, err := os.OpenFile(slavePath, os.O_RDWR|syscall.O_NOCTTY, 0)
	if err != nil {
		_ = master.Close()
		return nil, nil, fmt.Errorf("open pty slave: %w", err)
	}
	return master, slave, nil
}

func ioctl(fd uintptr, request uintptr, pointer unsafe.Pointer) error {
	_, _, errno := syscall.Syscall(syscall.SYS_IOCTL, fd, request, uintptr(pointer))
	if errno != 0 {
		return errno
	}
	return nil
}

func withTerminalEnvironment(environment []string) []string {
	result := make([]string, 0, len(environment)+3)
	for _, item := range environment {
		key := item
		if index := strings.IndexByte(item, '='); index >= 0 {
			key = item[:index]
		}
		switch key {
		case "TERM", "COLORTERM", "TERM_PROGRAM":
			continue
		default:
			result = append(result, item)
		}
	}
	return append(result, "TERM=xterm-256color", "COLORTERM=truecolor", "TERM_PROGRAM=tmux-webui")
}
