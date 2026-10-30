export type NetworkMessage =
  | {
      type: 'joinGame';
      payload: { name: string };
    }
  | {
      type: 'movePlayer';
      payload: {
        playerId: string;
        from: { x: number; y: number };
        to: { x: number; y: number };
        path: Array<{ x: number; y: number }>;
      };
    }
  | {
      type: 'startTurn';
      payload: { playerId: string; turn: number };
    }
  | {
      type: 'endTurn';
      payload: { playerId: string; turn: number };
    }
  | {
      type: 'castSpell';
      payload: {
        playerId: string;
        spellId: string;
        target: { x: number; y: number } | null;
        range: number;
      };
    };

export class SocketClient {
  private readonly socket: WebSocket;

  constructor(url: string) {
    this.socket = new WebSocket(url);
  }

  public onOpen(callback: () => void): void {
    this.socket.addEventListener('open', callback);
  }

  public onMessage(callback: (message: unknown) => void): void {
    this.socket.addEventListener('message', (event) => {
      callback(JSON.parse(event.data as string));
    });
  }

  public send(message: NetworkMessage): void {
    this.socket.send(JSON.stringify(message));
  }

  public close(): void {
    this.socket.close();
  }
}
