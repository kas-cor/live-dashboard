# Filtering Strategy: first_seen vs last_seen

## The Problem

Both `session_model_usage` and `session_model_usage` are aggregated per **(session, model)**. If you filter by `last_seen` you inadvertently include a whole month‑old session's total because its `last_seen` timestamp is newer than the current cycle's cutoff.

## Correct Approach

**Always filter by `first_seen`** (the moment the session was opened). This guarantees you only count activity from the current cycle.

```python
# WRONG – includes old session totals
rows = df[df['last_seen'] > now]

# RIGHT – only current cycle
rows = df[df['first_seen'] >= now - DAYS_IN_CYCLE]
```

## Why

- `first_seen` marks when the session was created.
- `last_seen` is the most recent activity timestamp (could be weeks ago if the session was idle).
- Using `last_seen` breaks the “current cycle” assumption and inflates usage.

## Pitfall
Confusing `last_seen` with `first_seen` leads to **over‑projection** by 1.5–2× in the first cycle after a long idle period.
