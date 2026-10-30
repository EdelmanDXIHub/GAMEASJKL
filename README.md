# Krikas MVP

Este proyecto es una base para un videojuego web 2D táctico por turnos inspirada en mecánicas de MMORPG clásicos como Dofus, pero adaptado para un prototipo original.

## Estructura

- `client`: aplicación Phaser 3 + TypeScript
- `server`: servidor Node.js + WebSockets
- `shared`: lógica compartida (cuadrícula, pathfinding, tipos de red)

## Requisitos

- Node.js 20+
- npm

## Instalación

```bash
npm install
```

## Ejecutar en desarrollo

```bash
npm run dev:client
npm run dev:server
```

El cliente queda disponible en la red local en la dirección que muestra Vite. Para que otros computadores de la misma red entren, comparte esa dirección usando la IP local del computador servidor (por ejemplo, `http://192.168.1.20:5173`) y permite los puertos `5173` y `8080` en el firewall. En **Jugar en sala**, todos deben usar como servidor `ws://IP-DEL-SERVIDOR:8080`; una persona crea la sala y comparte el código.

Las salas se guardan en memoria del proceso: se eliminan cuando todos salen o cuando se reinicia el servidor. Para jugar por internet, publica el servidor WebSocket en un host accesible públicamente y configura en el campo **Servidor WebSocket** su dirección `wss://...` (con TLS mediante un proxy inverso). La dirección local `ws://...` solo sirve dentro de la misma red.

## Compilar

```bash
npm run build
```

## Prototipo actual

- Grid isométrica con obstáculos
- Cálculo de ruta con A*
- Validación de casillas accesibles
- Eventos básicos de red: `joinGame`, `movePlayer`, `startTurn`, `endTurn`, `castSpell`

## Cómo probar

1. Inicia el servidor:
   ```bash
   npm run dev:server
   ```
2. Inicia el cliente:
   ```bash
   npm run dev:client
   ```
3. Abre la URL que muestre Vite en el navegador.
4. El cliente envía mensajes por WebSocket al puerto `ws://localhost:8080`.
