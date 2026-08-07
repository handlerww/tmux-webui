package server

import (
	"net/http/httptest"
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
