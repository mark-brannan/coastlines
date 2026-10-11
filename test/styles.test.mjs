import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { charts } from '../lib/charts.js';
import { find } from '../lib/catalogue.js';

// One Mapbox style per chart, hand-written, served by the plugin and read by
// the demo. The chart table is the contract; a style may not draw a layer the
// cutter will not cut.

const TYPE_FOR = { polygons: ['fill', 'line'], lines: ['line'], points: ['circle', 'symbol'] };
const style = async (id) =>
  JSON.parse(await readFile(new URL(`../styles/${id}.json`, import.meta.url), 'utf8'));

for (const entry of charts) {
  test(`styles/${entry.id}.json draws the chart's layers inside their zooms`, async () => {
    const doc = await style(entry.id);
    assert.equal(doc.version, 8);
    assert.equal(doc.name, entry.id);
    assert.deepEqual(
      Object.keys(doc.sources),
      ['coastlines'],
      'one vector source, named for the plugin',
    );
    assert.equal(doc.sources.coastlines.type, 'vector');
    assert.equal(doc.sources.coastlines.minzoom, entry.minzoom);
    assert.equal(doc.sources.coastlines.maxzoom, entry.maxzoom);

    const byName = new Map(entry.layers.map((layer) => [layer.name, layer]));
    const drawn = new Set();
    assert.equal(
      new Set(doc.layers.map((layer) => layer.id)).size,
      doc.layers.length,
      'style layer ids unique',
    );
    for (const layer of doc.layers) {
      assert.equal(layer.source, 'coastlines', layer.id);
      const chartLayer = byName.get(layer['source-layer']);
      assert.ok(chartLayer, `${layer.id} draws a layer the chart cuts`);
      drawn.add(chartLayer.name);
      const geometry = find(chartLayer.id).geometry;
      assert.ok(
        TYPE_FOR[geometry].includes(layer.type),
        `${layer.id}: ${layer.type} on ${geometry}`,
      );
      assert.ok((layer.minzoom ?? chartLayer.minzoom) >= chartLayer.minzoom, `${layer.id} minzoom`);
      // A style maxzoom is exclusive; a layer cut to the chart's top zoom is overzoomed past it, so it sets none.
      if (chartLayer.maxzoom === entry.maxzoom)
        assert.equal(layer.maxzoom, undefined, `${layer.id} overzooms past the chart`);
      else assert.ok(layer.maxzoom <= chartLayer.maxzoom + 1, `${layer.id} maxzoom`);
    }
    const undrawn = entry.layers.map((layer) => layer.name).filter((name) => !drawn.has(name));
    assert.deepEqual(undrawn, [], 'every cut layer is styled');
  });
}
