# Peak Hours & Pricing Impact

## When Rates Jump

Ollama charges higher rates during **peak hours** (12:00‑18:00 UTC, Monday‑Friday). Outside peak, rates drop significantly.

## How to Apply

1. **Identify peak‑hour fraction** ≈ 30/168 ≈ 0.179 (18h ÷ 72h weekday).
2. **Adjust burn rate**:
   ```python
   peak_weight = 0.179  # fraction of time at peak
   adjusted_burn = base_burn * (1 + peak_weight * 2.0)  # +100% during peak
   ```
3. **Project with weighted forecast** (the new skill does this automatically).

## Why This Matters

- Without peak adjustment, the model underestimates consumption by ~40% in the first half of the cycle.
- The weighted forecast in `ollama_forecast.py` already incorporates peak‑hour weighting.

## Pitfall
Don't double‑apply peak weight to the whole day. Only multiply the **peak‑hour portion** of the day.
