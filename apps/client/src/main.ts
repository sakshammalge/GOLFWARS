import { connect, type NetStatus } from './network.js';
import { startScene } from './scene.js';

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

startScene(document.getElementById('app')!);
void connect(render);
