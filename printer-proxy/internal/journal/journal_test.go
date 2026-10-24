package journal

import (
	"os"
	"testing"
)

func TestSaveLoadClear(t *testing.T) {
	d, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if e, err := d.Load("D8J235104976"); e != nil || err != nil {
		t.Fatalf("empty journal: %v, %v", e, err)
	}

	intent := Entry{JobID: "j1", LeaseID: "l1", Phase: PhaseIntent, CounterBefore: 18234}
	if err := d.Save("D8J235104976", intent); err != nil {
		t.Fatal(err)
	}
	result := intent
	result.Phase, result.Outcome = PhaseResult, "printed"
	if err := d.Save("D8J235104976", result); err != nil {
		t.Fatal(err)
	}
	if e, _ := d.Load("D8J235104976"); e == nil || *e != result {
		t.Fatalf("Load = %+v, want %+v", e, result)
	}

	// A late ack for another job leaves the entry alone.
	d.Clear("D8J235104976", "j0")
	if e, _ := d.Load("D8J235104976"); e == nil {
		t.Fatal("Clear removed another job's entry")
	}
	if all, err := d.List(); err != nil || len(all) != 1 || all["D8J235104976"] != result {
		t.Fatalf("List = %v, %v", all, err)
	}
	if err := d.Clear("D8J235104976", "j1"); err != nil {
		t.Fatal(err)
	}
	if e, _ := d.Load("D8J235104976"); e != nil {
		t.Fatalf("entry left after Clear: %+v", e)
	}

	files, _ := os.ReadDir(d.path)
	if len(files) != 0 {
		t.Errorf("leftover files: %v", files)
	}
}

func TestRejectsPathSerial(t *testing.T) {
	d, _ := Open(t.TempDir())
	if err := d.Save("../x", Entry{}); err == nil {
		t.Error("Save accepted a path as serial")
	}
}
