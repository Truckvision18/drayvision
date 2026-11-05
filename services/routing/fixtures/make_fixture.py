"""Generate the synthetic ladder network (fixtures/ladder.json) as a dated .osm.pbf.

Usage: python -I services/routing/fixtures/make_fixture.py <out-dir>
Writes <out-dir>/ladder-<snapshotDate>.osm.pbf and prints its path. Deterministic: same input,
same node/way ids and coordinates, so tile builds and test expectations are stable.
"""
import json
import sys
from pathlib import Path

import osmium

HERE = Path(__file__).resolve().parent


def main() -> None:
    spec = json.loads((HERE / "ladder.json").read_text())
    out_dir = Path(sys.argv[1])
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"ladder-{spec['snapshotDate']}.osm.pbf"
    if out.exists():
        out.unlink()

    x0, y0 = spec["origin"]["lng"], spec["origin"]["lat"]
    dy, length = spec["rowSpacingDeg"], spec["rowLengthDeg"]
    # Per row: 4 nodes at x = 0, 1/4, 3/4, 1 of the row; the middle segment carries the restriction.
    xs = [x0, x0 + length / 4, x0 + 3 * length / 4, x0 + length]
    base = spec["baseTags"]
    meta = dict(version=1, timestamp="2026-01-01T00:00:00Z", changeset=1, uid=1, user="fixture")

    writer = osmium.SimpleWriter(str(out))
    try:
        node_id = lambda r, c: 1000 + r * 10 + c  # noqa: E731
        for r, _row in enumerate(spec["rows"]):
            for c, x in enumerate(xs):
                writer.add_node(osmium.osm.mutable.Node(id=node_id(r, c), location=(x, y0 + r * dy), tags={}, **meta))

        way_id = 1
        for r, row in enumerate(spec["rows"]):
            segments = [(0, 1, {}), (1, 2, row["tags"]), (2, 3, {})]
            for a, b, extra in segments:
                tags = {**base, **extra, "name": f"{row['id']} {a}-{b}"}
                writer.add_way(osmium.osm.mutable.Way(id=way_id, nodes=[node_id(r, a), node_id(r, b)], tags=tags, **meta))
                way_id += 1
        for c, label in ((0, "west"), (3, "east")):
            nodes = [node_id(r, c) for r in range(len(spec["rows"]))]
            writer.add_way(osmium.osm.mutable.Way(id=way_id, nodes=nodes, tags={**base, "name": f"{label} column"}, **meta))
            way_id += 1
    finally:
        writer.close()
    print(out)


if __name__ == "__main__":
    main()
