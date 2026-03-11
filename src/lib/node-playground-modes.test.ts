import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCenteredViewportForNode,
  buildFramedViewportForNode,
  getActiveNodePlaygroundMode,
  getInitialNodePlaygroundMode,
  positionNodeAroundCenter,
  preserveNodeCenterPosition,
} from "@/lib/node-playground-modes";

test("initial node playground modes derive from persisted display mode unless the fixture opens in edit", () => {
  assert.equal(getInitialNodePlaygroundMode("preview"), "preview");
  assert.equal(getInitialNodePlaygroundMode("compact"), "compact");
  assert.equal(getInitialNodePlaygroundMode("resized"), "resize");
  assert.equal(getInitialNodePlaygroundMode("preview", true), "edit");
});

test("active node playground mode prefers full and resized render states over persisted metadata", () => {
  assert.equal(getActiveNodePlaygroundMode("preview", "preview"), "preview");
  assert.equal(getActiveNodePlaygroundMode("compact", "compact"), "compact");
  assert.equal(getActiveNodePlaygroundMode("preview", "full"), "edit");
  assert.equal(getActiveNodePlaygroundMode("preview", "resized"), "resize");
});

test("preserveNodeCenterPosition keeps the node center stable while the shell size changes", () => {
  const nextPosition = preserveNodeCenterPosition(
    { x: 120, y: 180 },
    { width: 236, height: 84 },
    { width: 980, height: 385 }
  );

  assert.deepEqual(nextPosition, { x: -252, y: 30 });
});

test("positionNodeAroundCenter converts a target center back into the matching top-left position", () => {
  const position = positionNodeAroundCenter(
    { x: 238, y: 222 },
    { width: 320, height: 320 }
  );

  assert.deepEqual(position, { x: 78, y: 62 });
});

test("buildCenteredViewportForNode centers the node inside the available surface without changing zoom", () => {
  const viewport = buildCenteredViewportForNode({
    zoom: 0.8,
    nodePosition: { x: 180, y: 120 },
    nodeSize: { width: 760, height: 460 },
    surfaceSize: { width: 960, height: 720 },
  });

  assert.deepEqual(viewport, {
    zoom: 0.8,
    x: 32,
    y: 80,
  });
});

test("buildFramedViewportForNode fits and centers the node with playground padding", () => {
  const viewport = buildFramedViewportForNode({
    nodePosition: { x: 180, y: 120 },
    nodeSize: { width: 760, height: 460 },
    surfaceSize: { width: 960, height: 720 },
  });

  assert.deepEqual(viewport, {
    zoom: 1.0526315789473684,
    x: -109,
    y: -8,
  });
});
