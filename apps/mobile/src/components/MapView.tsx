import React from 'react';
import { StyleSheet } from 'react-native';
import { Camera, Map } from '@maplibre/maplibre-react-native';
import { config } from '../config';
import { api } from '../api/client';

export interface MapViewProps {
  /** Override the style URL (tests / previews). Defaults to our API's tile proxy. */
  styleUrl?: string;
  children?: React.ReactNode;
  testID?: string;
}

/**
 * The single map surface used across screens. The style comes from OUR API (`/tiles/style.json`),
 * which proxies the tile vendor server-side — no tile key ships in the app.
 */
export function MapView({ styleUrl = api.styleUrl, children, testID = 'map-view' }: MapViewProps) {
  return (
    <Map testID={testID} style={styles.map} mapStyle={styleUrl} logo={false} attribution compass>
      <Camera
        initialViewState={{ center: config.map.initialCenter, zoom: config.map.initialZoom }}
        minZoom={config.map.minZoom}
        maxZoom={config.map.maxZoom}
      />
      {children}
    </Map>
  );
}

const styles = StyleSheet.create({ map: { flex: 1 } });
