# Token Cost Breakdown (Weighted Forecast)

## How to Calculate Weighted Burn Rate

### Step 1 – Pull Raw Numbers
```bash
python3 /projects/dashboard/backend/ollama-usage/scripts/ollama-usage.py \
  --output-file /projects/dashboard/data/ollama-usage.json
```

### Step 2 – Compute Per‑Type Costs
```python
# Example (inline in your pipeline)
import json
with open("/projects/dashboard/data/ollama-usage.json") as f:
    data = json.load(f)

# Weighted cost = sum(type_cost * type_spend)
type_costs = {
    "input":  0.015,   # $ per million input tokens
    "output": 0.008,   # $ per million output tokens
    "cache":  0.004,   # $ per million cached tokens
}
weighted = sum(cost * data["usage"]["models"][m]["cost_usd"] 
              for m, cost in type_costs.items())
print(f"Weighted burn: ${weighted:.2f}/day")
```

### Step 3 – Project Future Consumption
```python
def project_spend(daily_rate, days_ahead):
    return daily_rate * days_ahead

# Example: 11.54% of $60/month = $5.74/month
# Monthly rate ≈ $5.74 / 30 ≈ $0.191 per day
```

## Why This Works
- **Absolute spend** (`used`/`limit` from Ollama settings) is exact.
- **Percentage** (`percent`) is rounded to 0.1% → ±40% error at cycle start.
- **Weighted approach** uses real dollar amounts → accurate depletion prediction.

## Pitfall
Using `percent` alone ignores peak‑hour surcharges (12:00‑18:00 UTC Mon‑Fri). Multiply peak‑hour weight (≈30/168 ≈ 0.18) into the calculation to get realistic peak‑time consumption.
