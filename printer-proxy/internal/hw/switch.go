package hw

import (
	"context"
	"time"
)

// Watch polls the input and calls onChange with the debounced level: once at
// start, then whenever the line has held a new level for the whole debounce
// period. It returns when ctx is done or a read fails.
func (in *Input) Watch(ctx context.Context, debounce time.Duration, onChange func(high bool)) error {
	stable, err := in.Value()
	if err != nil {
		return err
	}
	onChange(stable)

	tick := time.NewTicker(5 * time.Millisecond)
	defer tick.Stop()
	var changedAt time.Time
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-tick.C:
		}

		v, err := in.Value()
		if err != nil {
			return err
		}
		switch {
		case v == stable:
			changedAt = time.Time{}
		case changedAt.IsZero():
			changedAt = time.Now()
		case time.Since(changedAt) >= debounce:
			stable, changedAt = v, time.Time{}
			onChange(stable)
		}
	}
}
