import { RealtimeGame } from './game/RealtimeGame';

const root = document.querySelector<HTMLElement>('#app');

if (!root) {
  throw new Error('No se encontro el contenedor principal del juego.');
}

new RealtimeGame(root);
