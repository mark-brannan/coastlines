// Draws a GeoJSON FeatureCollection on a 2D canvas context through a
// projection function. Shared by the README sheet renderer and anything else
// that wants a quick equirectangular look; it is not the plotter -- MapLibre
// is -- and it clips nothing, which equirectangular never needs.

/** Equirectangular: lon,lat to x,y in a `width` by `height` box. */
export const equirectangular =
  (width, height) =>
  ([lon, lat]) => [((lon + 180) / 360) * width, ((90 - lat) / 180) * height];

function tracePath(ctx, rings, project) {
  for (const ring of rings) {
    ring.forEach((position, index) => {
      const [x, y] = project(position);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
  }
}

/** Every ring (polygons), line (lines) or position (points) of a geometry, flattened one level. */
function parts(geometry) {
  const { type, coordinates } = geometry;
  if (type === 'Point') return [[coordinates]];
  if (type === 'MultiPoint') return [coordinates];
  if (type === 'LineString') return [coordinates];
  if (type === 'MultiLineString' || type === 'Polygon') return coordinates;
  if (type === 'MultiPolygon') return coordinates.flat();
  return [];
}

/**
 * Draws `collection` with `style`: `{ fill, stroke, lineWidth, radius }`.
 * Polygons fill (even-odd, so holes stay holes) and stroke; lines stroke;
 * points become dots of `radius`.
 */
export function drawCollection(ctx, collection, project, style) {
  const { fill, stroke, lineWidth = 1, radius = 1.5 } = style;
  ctx.lineWidth = lineWidth;
  if (stroke) ctx.strokeStyle = stroke;
  if (fill) ctx.fillStyle = fill;
  for (const feature of collection.features) {
    if (!feature.geometry) continue;
    const { type } = feature.geometry;
    const polygon = type === 'Polygon' || type === 'MultiPolygon';
    const point = type === 'Point' || type === 'MultiPoint';
    if (point) {
      for (const [x, y] of parts(feature.geometry)[0].map(project)) {
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
      continue;
    }
    ctx.beginPath();
    tracePath(ctx, parts(feature.geometry), project);
    if (polygon && fill) ctx.fill('evenodd');
    if (stroke) ctx.stroke();
  }
}
