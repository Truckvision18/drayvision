import { Share } from 'react-native';
import type { Route, TileConfig } from '@drayvision/shared';
import { formatDistance, formatDuration } from '../navigation/format';
import { attributionLine } from './MapAttribution';

/**
 * Anything we export or share carries the map attribution. A map IMAGE is only included when
 * the tile source allows it — MapTiler's Cloud Terms §7 forbid redistributing map content as a
 * screenshot / static image, so with MapTiler the share is text only.
 */
export function buildShareMessage(route: Route, tileConfig: TileConfig): string {
  return [
    `DrayVision truck route: ${formatDuration(route.duration_s)}, ${formatDistance(route.distance_m)}`,
    `Safety check: ${route.safety_result.status} (restrictions ${route.data_versions.restrictions})`,
    `Map data: ${attributionLine(tileConfig.attribution)}`,
  ].join('\n');
}

export interface Snapshotter {
  createStaticMapImage(options: { output: 'file' }): Promise<string>;
}

export async function shareRoute(
  route: Route,
  tileConfig: TileConfig,
  map: Snapshotter | null,
  share: Pick<typeof Share, 'share'> = Share,
): Promise<void> {
  const message = buildShareMessage(route, tileConfig);
  let url: string | undefined;
  if (tileConfig.export.snapshot_allowed && map) {
    // The attribution travels in the message alongside the image.
    url = await map.createStaticMapImage({ output: 'file' }).catch(() => undefined);
  }
  await share.share(url ? { message, url } : { message });
}
