# Golden route regression corpus (Phase 5 / Phase 14)

Each file holds known-restriction cases: an origin/destination/truck profile plus the outcome
the safety layer **must** produce (e.g. "a 13'6\" rig must never be routed under bridge X").

Format — `{ "routes": GoldenRoute[] }`:

```jsonc
{
  "id": "nyc-example-low-bridge",
  "description": "What this case protects against",
  "origin": { "lng": 0, "lat": 0 },
  "destination": { "lng": 0, "lat": 0 },
  "profile": { /* TruckProfile */ },
  "expect": {
    "mustAvoidHazardIds": ["restriction-id"],
    "status": "pass"            // or "fail" for cases that must be rejected
  },
  "provenance": { "addedBy": "name", "addedAt": "YYYY-MM-DD", "reason": "incident / survey ref" }
}
```

`test/golden-routes.test.ts` validates every file here. Once Valhalla tiles exist (Phase 4) the
same corpus runs against the live router (`make golden`). The Phase 14 gate requires the corpus
to be populated and 100 % passing.
