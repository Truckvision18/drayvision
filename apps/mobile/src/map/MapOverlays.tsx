import React from 'react';
import { GeoJSONSource, Layer } from '@maplibre/maplibre-react-native';
import { MAP_LAYER_ORDER } from '@drayvision/shared';
import type { LayerToggles } from './MapLayersContext';
import { beforeIdFor, geoJSONFor, LAYER_SPECS, type OverlayData } from './overlays';

/**
 * All overlay layers, ALWAYS mounted, in MAP_LAYER_ORDER:
 *   base roads → route → hazards → traffic → cameras → facilities → sponsored.
 * Toggles change `visibility`, never mount/unmount, so the stack can't be reordered by
 * whichever layer happens to mount last. Where the style has our anchors, each layer is also
 * pinned below the next anchor (`beforeId`).
 */
export function MapOverlays({ data, visible, anchors }: { data: OverlayData; visible: LayerToggles; anchors: boolean }) {
  return (
    <>
      {MAP_LAYER_ORDER.map((layer) => {
        const shown = layer === 'route' ? data.route !== null : visible[layer];
        return (
          <GeoJSONSource key={layer} id={`dv-src-${layer}`} data={geoJSONFor(layer, data)} testID={`source-${layer}`}>
            {LAYER_SPECS[layer].map((spec) => (
              <Layer
                key={spec.id}
                id={spec.id}
                testID={`layer-${spec.id}`}
                type={spec.type as never}
                paint={spec.paint as never}
                layout={{ ...(spec.layout ?? {}), visibility: shown ? 'visible' : 'none' } as never}
                {...(anchors ? { beforeId: beforeIdFor(layer) } : {})}
              />
            ))}
          </GeoJSONSource>
        );
      })}
    </>
  );
}
