# IoT-Naivechain

This is a proof of concept on how to use a blockchain on an IoT architecture.

## Running

You can start 3 different device types with the following commands:

```bash
DEVICE=gateway HTTP_PORT=3001 P2P_PORT=6001 npm start
DEVICE=lights HTTP_PORT=3002 P2P_PORT=6002 PEERS=ws://localhost:6001 npm start
DEVICE=temperature HTTP_PORT=3003 P2P_PORT=6003 PEERS=ws://localhost:6001 npm start
```

Commands to the **lights** device can be issued with:

```bash
curl -H "Content-type:application/json" --data '{"device": "lights", "name": "on"}' http://localhost:3001/sendCommand
curl -H "Content-type:application/json" --data '{"device": "lights", "name": "off"}' http://localhost:3001/sendCommand
```
