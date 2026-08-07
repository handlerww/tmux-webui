package websocket

import (
	"bufio"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
)

const (
	OpText   byte = 0x1
	OpBinary byte = 0x2
	opClose  byte = 0x8
	opPing   byte = 0x9
	opPong   byte = 0xa

	maxMessageSize = 1 << 20
)

var ErrClosed = errors.New("websocket closed")

type Conn struct {
	connection net.Conn
	reader     *bufio.Reader
	writeMu    sync.Mutex
	closeOnce  sync.Once
}

func Upgrade(writer http.ResponseWriter, request *http.Request) (*Conn, error) {
	if !headerContains(request.Header, "Connection", "upgrade") ||
		!strings.EqualFold(request.Header.Get("Upgrade"), "websocket") {
		return nil, errors.New("request is not a websocket upgrade")
	}
	if request.Header.Get("Sec-WebSocket-Version") != "13" {
		return nil, errors.New("unsupported websocket version")
	}
	key := request.Header.Get("Sec-WebSocket-Key")
	decoded, err := base64.StdEncoding.DecodeString(key)
	if err != nil || len(decoded) != 16 {
		return nil, errors.New("invalid websocket key")
	}

	hijacker, ok := writer.(http.Hijacker)
	if !ok {
		return nil, errors.New("http server does not support connection hijacking")
	}
	connection, buffer, err := hijacker.Hijack()
	if err != nil {
		return nil, fmt.Errorf("hijack websocket connection: %w", err)
	}

	accept := websocketAccept(key)
	if _, err := fmt.Fprintf(buffer, "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: %s\r\n\r\n", accept); err != nil {
		_ = connection.Close()
		return nil, err
	}
	if err := buffer.Flush(); err != nil {
		_ = connection.Close()
		return nil, err
	}
	return &Conn{connection: connection, reader: buffer.Reader}, nil
}

func (c *Conn) ReadMessage() (byte, []byte, error) {
	for {
		opcode, payload, err := c.readFrame()
		if err != nil {
			return 0, nil, err
		}
		switch opcode {
		case OpText, OpBinary:
			return opcode, payload, nil
		case opPing:
			if err := c.WriteMessage(opPong, payload); err != nil {
				return 0, nil, err
			}
		case opPong:
			continue
		case opClose:
			_ = c.WriteMessage(opClose, payload)
			return 0, nil, ErrClosed
		default:
			return 0, nil, fmt.Errorf("unsupported websocket opcode %d", opcode)
		}
	}
}

func (c *Conn) WriteMessage(opcode byte, payload []byte) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()

	header := []byte{0x80 | opcode}
	switch length := len(payload); {
	case length < 126:
		header = append(header, byte(length))
	case uint64(length) <= uint64(^uint16(0)):
		header = append(header, 126, byte(length>>8), byte(length))
	default:
		header = append(header, 127, 0, 0, 0, 0, byte(uint64(length)>>24), byte(length>>16), byte(length>>8), byte(length))
	}
	if _, err := c.connection.Write(header); err != nil {
		return err
	}
	_, err := c.connection.Write(payload)
	return err
}

func (c *Conn) Close() error {
	var err error
	c.closeOnce.Do(func() {
		err = c.connection.Close()
	})
	return err
}

func (c *Conn) readFrame() (byte, []byte, error) {
	first, err := c.reader.ReadByte()
	if err != nil {
		return 0, nil, err
	}
	second, err := c.reader.ReadByte()
	if err != nil {
		return 0, nil, err
	}
	if first&0x80 == 0 {
		return 0, nil, errors.New("fragmented websocket messages are not supported")
	}
	if second&0x80 == 0 {
		return 0, nil, errors.New("client websocket frames must be masked")
	}
	opcode := first & 0x0f
	length := uint64(second & 0x7f)
	switch length {
	case 126:
		var value uint16
		if err := binary.Read(c.reader, binary.BigEndian, &value); err != nil {
			return 0, nil, err
		}
		length = uint64(value)
	case 127:
		if err := binary.Read(c.reader, binary.BigEndian, &length); err != nil {
			return 0, nil, err
		}
	}
	if length > maxMessageSize {
		return 0, nil, errors.New("websocket message is too large")
	}
	mask := make([]byte, 4)
	if _, err := io.ReadFull(c.reader, mask); err != nil {
		return 0, nil, err
	}
	payload := make([]byte, int(length))
	if _, err := io.ReadFull(c.reader, payload); err != nil {
		return 0, nil, err
	}
	for index := range payload {
		payload[index] ^= mask[index%4]
	}
	return opcode, payload, nil
}

func websocketAccept(key string) string {
	hash := sha1.Sum([]byte(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))
	return base64.StdEncoding.EncodeToString(hash[:])
}

func headerContains(header http.Header, name, value string) bool {
	for _, line := range header.Values(name) {
		for _, part := range strings.Split(line, ",") {
			if strings.EqualFold(strings.TrimSpace(part), value) {
				return true
			}
		}
	}
	return false
}
