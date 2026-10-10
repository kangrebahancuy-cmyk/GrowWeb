import assert from "node:assert/strict";
import test from "node:test";
import { BrowserPeerTransportRegistry } from "../src/browser/BrowserPeerTransportRegistry";

test("virtual peer packets route only to the registered browser transport", () => {
  const received: Buffer[] = [];
  const netID = 987654321;
  BrowserPeerTransportRegistry.attach(netID, {
    send: (packet) => received.push(packet),
    disconnect: () => undefined,
  });

  try {
    const packet = Buffer.from([1, 2, 3]);
    assert.equal(BrowserPeerTransportRegistry.has(netID), true);
    assert.equal(BrowserPeerTransportRegistry.send(netID, packet), true);
    assert.deepEqual(received, [packet]);
    assert.equal(BrowserPeerTransportRegistry.send(netID + 1, packet), false);
  } finally {
    BrowserPeerTransportRegistry.detach(netID);
  }

  assert.equal(BrowserPeerTransportRegistry.has(netID), false);
});

test("virtual peer disconnect is routed to the owning browser transport", () => {
  let disconnected: [number | undefined, string | undefined] | undefined;
  const netID = 987654322;
  BrowserPeerTransportRegistry.attach(netID, {
    send: () => undefined,
    disconnect: (code, reason) => {
      disconnected = [code, reason];
    },
  });

  try {
    assert.equal(BrowserPeerTransportRegistry.disconnect(netID, 1008, "invalid action"), true);
    assert.deepEqual(disconnected, [1008, "invalid action"]);
  } finally {
    BrowserPeerTransportRegistry.detach(netID);
  }
});
