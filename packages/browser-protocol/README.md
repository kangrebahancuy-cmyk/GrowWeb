# Browser protocol foundation

This package defines a versioned JSON envelope shared by the future browser client and server-side gateway.

## Current scope

- Protocol version 1 client/server message types.
- Validation for message size, chat length, input sequence, direction, tile coordinates, and interaction fields.
- No browser simulation, no ENet emulation, and no claim of a working game gateway.

## Required integration work

The gateway must bind each WebSocket to a real authenticated GrowServer player/session. It must not trust client-supplied player IDs, coordinates beyond server-side world rules, item ownership, or inventory changes. Accepted actions must be translated into existing server action/tank handlers or a deliberately designed session API.

## Message examples

```json
{"version":1,"type":"hello","client":"growserver-web"}
{"version":1,"type":"input","sequence":1,"direction":"right","jump":false}
{"version":1,"type":"interact","sequence":2,"x":12,"y":8,"interaction":"punch"}
{"version":1,"type":"chat","text":"Hello"}
```

This is an internal transport contract, not the Growtopia wire protocol.
