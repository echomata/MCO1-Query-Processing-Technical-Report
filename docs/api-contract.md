# Dashboard API contract — proposal for the team

This is a frontend proposal, not an existing backend endpoint or finalized SQL requirement. Confirm field names and supported dimensions with the warehouse/SQL teammate before integration.

## Request

Suggested endpoint: `GET /api/reports/{report}`.

Reports: `overview`, `time`, `locations`, `payments`.

| Parameter | Example | Meaning |
| --- | --- | --- |
| year | 2025 | Dataset year |
| startMonth | 1 | First month, inclusive |
| endMonth | 12 | Last month, inclusive |
| borough | all or Queens | Pickup borough filter |
| paymentType | all, card, cash, other | UI payment category |
| granularity | month, quarter, year | Time grouping for overview/time |

The month range includes the complete months selected. The proposed time zone is NYC local trip time. Payment categories require an explicit mapping to the final warehouse's payment codes; the current demo categories are temporary.

## Response

```json
{
  "report": "time",
  "filters": {
    "year": 2025,
    "startMonth": 1,
    "endMonth": 12,
    "borough": "all",
    "paymentType": "all",
    "granularity": "month"
  },
  "summary": {
    "totalTrips": 100,
    "totalRevenue": 3450,
    "averageFare": 28.5,
    "averageDistance": 4.2,
    "averageDuration": 23
  },
  "series": [
    {
      "key": 1,
      "label": "Jan",
      "trips": 100,
      "revenue": 3450,
      "averageFare": 28.5,
      "share": 100
    }
  ],
  "boroughs": [
    {
      "key": "Queens",
      "label": "Queens",
      "trips": 100,
      "revenue": 3450,
      "averageFare": 28.5,
      "share": 100
    }
  ],
  "meta": { "source": "warehouse", "currency": "USD", "year": 2025 }
}
```

Example numbers above demonstrate structure only.

- Revenue is the sum of the agreed total-charge measure; average fare uses the base-fare measure. Confirm treatment of refunds, tips, fees, nulls, and excluded records.
- Distance is in miles; duration is in minutes; share is a percentage from 0 to 100.
- Averages must be calculated over trips, not by averaging averages from groups.
- All summary and series values must apply the same filters.
- Numeric measures should be JSON numbers. If the database driver returns DECIMAL as strings, normalize them in the API or service.
- Overview/time rows are chronologically ordered. Location/payment rows are ordered by trip count descending.
- Empty results return zero summary measures, an empty `series`, and an empty `boroughs` array.

## Errors and integration

Suggested error response:

```json
{ "error": { "code": "INVALID_FILTERS", "message": "The starting month must come before the ending month." } }
```

Use HTTP 400 for invalid parameters and an appropriate 5xx response for server failures. The frontend should display a safe message and offer retry. Configure CORS for the frontend origin during local development, or serve the API under the same origin.

Use parameterized queries on the backend and allow-list report IDs and granularity values. Return aggregate results rather than millions of raw trip rows.

## Outstanding decisions

- Final report list and business questions.
- Warehouse dimensions, column names, hierarchy levels, and rate/vendor/payment mappings.
- How pickup and drop-off location filters are exposed.
- Daily drill-down and zone drill-down response shapes.
- Pivot row/column dimensions and response format.
- Data-quality rules and treatment of unknown values.
- API base URL, error mapping, and deployment location.

The service currently always returns mock data. There is no automatic database connection or configured live API mode.