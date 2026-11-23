import { Game } from './game.js';
import { connect, type NetStatus } from './network.js';
import { createStage } from './scene.js';

const statusEl = document.getElementById('status')!;

function render(s: NetStatus): void {
  statusEl.className = s.state === 'connected' ? 'ok' : s.state === 'disconnected' ? 'bad' : '';
  statusEl.textContent =
    s.state === 'connected'
      ? `Server: connected / ping ${s.pingMs ?? '-'} ms`
      : s.state === 'connecting'
        ? 'Server: connecting...'
        : 'Server: disconnected';
}

const game = new Game(createStage(document.getElementById('app')!));
void game.start();
// The server is optional in M1: a failed connection only changes the status label.
void connect(render);
