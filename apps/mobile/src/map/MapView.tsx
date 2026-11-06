import React, { forwardRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Camera, Map, UserLocation, type MapRef } from '@maplibre/maplibre-react-native';
import type { LngLat, MapViewKind, Route } from '@drayvision/shared';
import { useApi } from '../api/ApiContext';
import type { BBox, MapApi } from '../api/client';
import { config } from '../config';
import { useLocation } from '../location/LocationContext';
import { LayerToggles } from './LayerToggles';
import { MapAttribution } from './MapAttribution';
import { useMapLayers } from './MapLayersContext';
import { MapOverlays } from './MapOverlays';
import { useTileConfig } from './TileConfigContext';
import { useMapSession } from './useMapSession';
import { useOverlayData } from './useOverlayData';

/** Handle to the map (e.g. snapshots for sharing) — screens import it from here, never from the SDK. */
export type { MapRef };

export interface MapViewProps {
  /** Which screen this map is: counted separately in map-session analytics. */
  view: MapViewKind;
  /** Route drawn just above the base roads (below every hazard / pin). */
  route?: Route | null;
  /** Follow the driver, rotating with their course (turn-by-turn). */
  followUser?: boolean;
  onLongPress?: (at: LngLat) => void;
  /** Reports the visible area (e.g. for a facility list). */
  onBoundsChange?: (bbox: BBox) => void;
  /** Show the layer switches (hidden in turn-by-turn to keep the screen glanceable). */
  showLayerToggles?: boolean;
  api?: MapApi;
  /** Extra native annotations (e.g. the destination pin). Always above GL layers. */
  children?: React.ReactNode;
}

/**
 * THE map. Every map in the app (plan, navigate, facility) is this component; no other
 * mapping SDK exists in the app. The style comes from OUR API's tile config (source can be
 * switched server-side), overlays are stacked in the fixed order, and attribution is always
 * on screen.
 */
export const MapView = forwardRef<MapRef, MapViewProps>(function MapView(
  { view, route = null, followUser = false, onLongPress, onBoundsChange, showLayerToggles = true, api: apiProp, children },
  ref,
) {
  const ctxApi = useApi();
  const api = apiProp ?? ctxApi;
  const { tileConfig } = useTileConfig();
  const { permission } = useLocation();
  const { visible } = useMapLayers();
  const [bbox, setBbox] = useState<BBox | null>(null);
  useMapSession(view, api);
  const fetched = useOverlayData(api, bbox, visible);

  return (
    <View style={styles.fill} testID={`map-${view}`}>
      <Map
        ref={ref}
        testID="map-view"
        style={styles.fill}
        mapStyle={tileConfig.style_url}
        logo={false}
        attribution // native (i) button too — our overlay below is the always-visible one
        compass
        onLongPress={onLongPress ? (e) => onLongPress({ lng: e.nativeEvent.lngLat[0], lat: e.nativeEvent.lngLat[1] }) : undefined}
        onRegionDidChange={(e) => {
          const b = e.nativeEvent.bounds as unknown as BBox;
          setBbox(b);
          onBoundsChange?.(b);
        }}
      >
        <Camera
          initialViewState={{ center: config.map.initialCenter, zoom: config.map.initialZoom }}
          minZoom={config.map.minZoom}
          maxZoom={config.map.maxZoom}
          {...(followUser ? { trackUserLocation: 'course' as const } : {})}
        />
        {permission === 'granted' ? <UserLocation heading /> : null}
        <MapOverlays data={{ route, ...fetched }} visible={visible} anchors={tileConfig.layer_anchors} />
        {children}
      </Map>
      <MapAttribution items={tileConfig.attribution} />
      {showLayerToggles ? <LayerToggles /> : null}
    </View>
  );
});

const styles = StyleSheet.create({ fill: { flex: 1 } });
