/** Decode an encoded polyline (Valhalla uses precision 6). Returns [lng, lat] pairs. */
export function decodePolyline(encoded: string, precision = 6): Array<[number, number]> {
  const factor = 10 ** precision;
  const out: Array<[number, number]> = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const next = (): number => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) {
    lat += next();
    lng += next();
    out.push([lng / factor, lat / factor]);
  }
  return out;
}
