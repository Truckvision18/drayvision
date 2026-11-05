import React from 'react';
import { StyleSheet } from 'react-native';
import { Camera, Map, UserLocation } from '@maplibre/maplibre-react-native';
import type { LngLat } from '@drayvision/shared';
import { api } from '../api/client';
import { config } from '../config';
import { useLocation } from '../location/LocationContext';

export interface MapViewProps {
  /** Override the style URL (tests / previews). Defaults to our API's tile proxy. */
  styleUrl?: string;
  /** Follow the driver, rotating with their course (turn-by-turn). */
  followUser?: boolean;
  onLongPress?: (at: LngLat) => void;
  children?: React.ReactNode;
  testID?: string;
}

/**
 * The single map surface used across screens. The style comes from OUR API (`/tiles/style.json`),
 * which proxies the tile vendor server-side — no tile key ships in the app.
 */
export function MapView({ styleUrl = api.styleUrl, followUser = false, onLongPress, children, testID = 'map-view' }: MapViewProps) {
  const { permission } = useLocation();
  return (
    <Map
      testID={testID}
      style={styles.map}
      mapStyle={styleUrl}
      logo={false}
      attribution
      compass
      onLongPress={onLongPress ? (e) => onLongPress({ lng: e.nativeEvent.lngLat[0], lat: e.nativeEvent.lngLat[1] }) : undefined}
    >
      <Camera
        initialViewState={{ center: config.map.initialCenter, zoom: config.map.initialZoom }}
        minZoom={config.map.minZoom}
        maxZoom={config.map.maxZoom}
        {...(followUser ? { trackUserLocation: 'course' as const } : {})}
      />
      {permission === 'granted' ? <UserLocation heading /> : null}
      {children}
    </Map>
  );
}

const styles = StyleSheet.create({ map: { flex: 1 } });
