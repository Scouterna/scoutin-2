// Package cloud is the relay's side of the /ws/print-relay protocol (spec §13).
package cloud

import "encoding/json"

// Envelope is the message format shared with the kiosk WebSocket.
type Envelope struct {
	Name string          `json:"name"`
	Data json.RawMessage `json:"data,omitempty"`
}

// Relay → cloud.

type Hello struct {
	Version  string         `json:"version"`
	Hostname string         `json:"hostname"`
	Printers []PrinterInfo  `json:"printers"`
	Journal  []JournalEntry `json:"journal"`
}

type PrinterInfo struct {
	Serial  string `json:"serial"`
	Product string `json:"product,omitempty"`
	Port    int    `json:"port,omitempty"` // 1-based desk port, 0 if unknown
}

type JournalEntry struct {
	Serial        string `json:"serial"`
	JobID         string `json:"jobId"`
	LeaseID       string `json:"leaseId"`
	Phase         string `json:"phase"`
	CounterBefore int64  `json:"counterBefore"`
	Outcome       string `json:"outcome,omitempty"`
}

type PrinterStatus struct {
	Serial     string `json:"serial"`
	Seq        int64  `json:"seq"`
	State      string `json:"state"`
	Detail     string `json:"detail,omitempty"`
	DPI        int    `json:"dpi,omitempty"`
	WidthDots  int    `json:"widthDots,omitempty"`
	LengthDots int    `json:"lengthDots,omitempty"`
}

type PrinterRef struct {
	Serial string `json:"serial"`
}

type JobBegin struct {
	JobID   string `json:"jobId"`
	LeaseID string `json:"leaseId"`
}

type JobRelease struct {
	JobID   string `json:"jobId"`
	LeaseID string `json:"leaseId"`
	Reason  string `json:"reason"`
}

type JobResult struct {
	JobID   string `json:"jobId"`
	LeaseID string `json:"leaseId"`
	Outcome string `json:"outcome"`
	Reason  string `json:"reason,omitempty"`
}

type PrinterConfig struct {
	Serial   string            `json:"serial"`
	Settings map[string]string `json:"settings"`
}

type SettingResult struct {
	Applied bool   `json:"applied"`
	Value   string `json:"value"`
}

type PrinterActionResult struct {
	ActionID string                   `json:"actionId"`
	Serial   string                   `json:"serial"`
	OK       bool                     `json:"ok"`
	Results  map[string]SettingResult `json:"results,omitempty"`
	Restart  bool                     `json:"restart,omitempty"`
	Error    string                   `json:"error,omitempty"`
}

type RelayActionResult struct {
	ActionID string `json:"actionId"`
	OK       bool   `json:"ok"`
	Error    string `json:"error,omitempty"`
}

// Cloud → relay.

type Welcome struct {
	RelayID string `json:"relayId"`
	Epoch   int64  `json:"epoch"`
}

type JobOffer struct {
	JobID      string `json:"jobId"`
	LeaseID    string `json:"leaseId"`
	Serial     string `json:"serial"`
	PNG        []byte `json:"png"` // base64 in JSON
	WidthDots  int    `json:"widthDots"`
	HeightDots int    `json:"heightDots"`
}

type JobBeginAck struct {
	JobID   string `json:"jobId"`
	LeaseID string `json:"leaseId"`
	OK      bool   `json:"ok"`
}

type JobResultAck struct {
	JobID   string `json:"jobId"`
	LeaseID string `json:"leaseId"`
}

type PrinterAction struct {
	ActionID string            `json:"actionId"`
	Serial   string            `json:"serial"`
	Kind     string            `json:"kind"` // applyProfile | calibrate | cancelBuffer
	Settings map[string]string `json:"settings,omitempty"`
}

// RelayAction is about the Pi itself, not a printer.
type RelayAction struct {
	ActionID string `json:"actionId"`
	Kind     string `json:"kind"` // reboot | poweroff
}

// Message names.
const (
	MsgHello           = "hello"
	MsgPrinterStatus   = "printer:status"
	MsgPrinterAttached = "printer:attached"
	MsgPrinterDetached = "printer:detached"
	MsgPrinterReady    = "printer:ready"
	MsgJobBegin        = "job:begin"
	MsgJobRelease      = "job:release"
	MsgJobResult       = "job:result"
	MsgPrinterConfig   = "printer:config"
	MsgActionResult    = "printer:actionResult"
	MsgRelayResult     = "relay:actionResult"

	MsgWelcome       = "welcome"
	MsgJobOffer      = "job:offer"
	MsgJobBeginAck   = "job:beginAck"
	MsgJobResultAck  = "job:resultAck"
	MsgPrinterAction = "printer:action"
	MsgRelayAction   = "relay:action"
)

// Encode wraps data in an envelope.
func Encode(name string, data any) ([]byte, error) {
	raw, err := json.Marshal(data)
	if err != nil {
		return nil, err
	}
	return json.Marshal(Envelope{Name: name, Data: raw})
}
