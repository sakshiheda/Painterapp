import React, { useState } from 'react';
import { View, Image, StyleSheet, Pressable } from 'react-native';
import Svg, { Circle, Line, Polygon } from 'react-native-svg';
import { imageToViewCoords } from '../utils/coords';

/**
 * Renders the capture image inside a fixed-size box and lets the parent
 * receive image-space tap coordinates. The parent supplies an array of
 * markers/lines drawn as SVG overlays.
 *
 * Props:
 *   capture          — { width, height, ... } (image dimensions in px)
 *   imageUrl         — full URL of the photo
 *   apiKey           — passed as a header so authenticated images load
 *   onTap(point)     — called with { x, y } in image px
 *   markers          — array of { x, y, color?, label? } in image px
 *   lines            — array of { from, to, color? } in image px
 *   polygon          — optional [{x,y}] in image px (drawn closed if length>=3)
 */
export default function ImageCanvas({
  capture, imageUrl, apiKey, onTap, markers = [], lines = [], polygon = [],
}) {
  const [view, setView] = useState(null);

  function handlePress(e) {
    if (!view) return;
    const { locationX, locationY } = e.nativeEvent;
    onTap?.({ viewX: locationX, viewY: locationY, view, image: capture });
  }

  // Convert all overlay points to view coordinates
  const viewMarkers = view ? markers.map((m) => ({ ...m, ...imageToViewCoords(m, view, capture) })) : [];
  const viewLines = view
    ? lines.map((l) => ({
        ...l,
        from: imageToViewCoords(l.from, view, capture),
        to: imageToViewCoords(l.to, view, capture),
      }))
    : [];
  const viewPolygon = view ? polygon.map((p) => imageToViewCoords(p, view, capture)) : [];

  return (
    <View
      style={styles.wrap}
      onLayout={(e) => setView({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}>
      <Pressable style={StyleSheet.absoluteFill} onPress={handlePress}>
        <Image
          source={{ uri: imageUrl, headers: { 'x-api-key': apiKey } }}
          style={StyleSheet.absoluteFill}
          resizeMode="contain"
        />
      </Pressable>

      {view && (
        <Svg width={view.width} height={view.height} style={StyleSheet.absoluteFill} pointerEvents="none">
          {viewPolygon.length >= 3 && (
            <Polygon
              points={viewPolygon.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="rgba(250,204,21,0.25)"
              stroke="#facc15"
              strokeWidth={2}
            />
          )}
          {viewLines.map((l, i) => (
            <Line
              key={`l-${i}`}
              x1={l.from.x} y1={l.from.y}
              x2={l.to.x} y2={l.to.y}
              stroke={l.color || '#22d3ee'}
              strokeWidth={3}
            />
          ))}
          {viewMarkers.map((m, i) => (
            <Circle
              key={`m-${i}`}
              cx={m.x} cy={m.y} r={8}
              fill={m.color || '#ef4444'}
              stroke="#fff"
              strokeWidth={2}
            />
          ))}
        </Svg>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: '#000',
  },
});
