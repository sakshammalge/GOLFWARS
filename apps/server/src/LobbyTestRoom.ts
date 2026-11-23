import { Room, type Client } from '@colyseus/core';
import { MessageType, type PingMessage, type PongMessage } from '@golfwars/shared';

/** M0 connectivity-test room: answers `ping` with `pong`, echoing the client timestamp. */
export class LobbyTestRoom extends Room {
  override onCreate(): void {
    this.onMessage(MessageType.Ping, (client: Client, message: PingMessage) => {
      const pong: PongMessage = { t: message.t };
      client.send(MessageType.Pong, pong);
    });
  }
}
