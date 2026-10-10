import type { WebSocket } from "ws";

interface BrowserPeerTransport {
  send(packet: Buffer): void;
  disconnect(code?: number, reason?: string): void;
}

/**
 * Routes GrowServer's existing Peer.send output to a browser transport when
 * that peer was created by the browser gateway. Native ENet peers are untouched.
 */
export class BrowserPeerTransportRegistry {
  private static readonly transports = new Map<number, BrowserPeerTransport>();

  static attach(netID: number, transport: BrowserPeerTransport): void {
    if (this.transports.has(netID)) {
      throw new Error(`Browser virtual netID ${netID} is already registered`);
    }
    this.transports.set(netID, transport);
  }

  static detach(netID: number): void {
    this.transports.delete(netID);
  }

  static has(netID: number): boolean {
    return this.transports.has(netID);
  }

  static send(netID: number, packet: Buffer): boolean {
    const transport = this.transports.get(netID);
    if (!transport) return false;
    transport.send(packet);
    return true;
  }

  static disconnect(netID: number, code = 1000, reason = "Peer disconnected"): boolean {
    const transport = this.transports.get(netID);
    if (!transport) return false;
    transport.disconnect(code, reason);
    return true;
  }
}
