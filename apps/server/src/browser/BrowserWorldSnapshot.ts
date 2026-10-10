import type { BrowserWorldSnapshot } from "@growserver/browser-protocol";
import type { Base } from "../core/Base";
import { World } from "../core/World";

/**
 * Reads the actual GrowServer world cache/database without creating a synthetic
 * world or inserting a browser account into the native ENet peer collection.
 * This is a read-only bridge; it is not a playable browser player session.
 */
export async function getBrowserWorldSnapshot(
  base: Base,
  requestedName: string,
): Promise<BrowserWorldSnapshot | null> {
  const worldName = requestedName.trim().toUpperCase();
  if (!/^[A-Z0-9]{1,24}$/.test(worldName)) return null;

  const cachedWorld = base.cache.worlds.get(worldName);
  const exists = cachedWorld || (await base.database.worlds.has(worldName));
  if (!exists) return null;

  const world = new World(base, worldName);
  await world.getData();

  const { width, height, blocks } = world.data;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width > 255 ||
    height > 255 ||
    !Array.isArray(blocks) ||
    blocks.length !== width * height
  ) {
    return null;
  }

  const tiles = blocks.map((block, index) => ({
    x:             index % width,
    y:             Math.floor(index / width),
    foregroundId: Number.isSafeInteger(block.fg) ? block.fg : 0,
    backgroundId: Number.isSafeInteger(block.bg) ? block.bg : 0,
    flags:         Number.isSafeInteger(block.flags) ? block.flags : 0,
  }));

  const players = Array.from(base.cache.peers.values())
    .filter((peer) => peer.world === worldName)
    .map((peer) => ({
      playerId:   String(peer.userID),
      displayName: peer.displayName,
      worldName,
      x:          peer.x ?? 0,
      y:          peer.y ?? 0,
      facing:     peer.rotatedLeft ? "left" as const : "right" as const,
      level:      peer.level,
    }));

  return {
    name: worldName,
    width,
    height,
    tiles,
    players,
  };
}
