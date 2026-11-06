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
  "profile": {                // a COMPLETE rig — never a guessed or default profile
    "height_m": 4.11, "weight_kg": 36287, "length_m": 21.03, "width_m": 2.59,
    "axle_count": 5, "hazmat": { "carrying": false, "classes": [] }
  },
  "expect": {
    "must_avoid_hazard_ids": ["restriction-id"],
    "status": "PASS"            // or "FAIL" for cases that must be rejected
  },
  "provenance": { "added_by": "name", "added_at": "YYYY-MM-DD", "reason": "incident / survey ref" }
}
```

`test/scaffold.test.ts` validates every file here against the shared schemas. Once Valhalla tiles exist (Phase 4) the
same corpus runs against the live router (`make golden`). The Phase 14 gate requires the corpus
to be populated and 100 % passing.
