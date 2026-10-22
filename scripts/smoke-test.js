import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { io } from 'socket.io-client';

const directory = mkdtempSync(join(tmpdir(), 'zinc-smoke-'));
const port = 4173;
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['server/server.js'], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port), ADMIN_PIN: '2468', DB_PATH: join(directory, 'db.json') },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let startupOutput = '';
child.stdout.on('data', (chunk) => { startupOutput += chunk.toString(); });
child.stderr.on('data', (chunk) => { startupOutput += chunk.toString(); });
const socket = io(base, { autoConnect: false, transports: ['websocket'] });

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, options);
  const body = response.status === 204 ? null : await response.json();
  assert.ok(response.ok, body?.error || `HTTP ${response.status}`);
  return body;
}

try {
  const started = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { clearInterval(interval); reject(new Error(`Serveur non démarré : ${startupOutput}`)); }, 8000);
    const interval = setInterval(() => {
      if (startupOutput.includes('écoute')) { clearInterval(interval); clearTimeout(timeout); resolve(); }
      if (child.exitCode !== null) { clearInterval(interval); clearTimeout(timeout); reject(new Error(startupOutput)); }
    }, 50);
  });
  await started;

  const homepage = await fetch(base);
  assert.equal(homepage.status, 200, 'La page publique est servie.');
  assert.match(await homepage.text(), /Le Zinc Bouillon/, 'Le contenu du site est présent.');
  const dashboard = await fetch(`${base}/admin`);
  assert.equal(dashboard.status, 200, 'Le repli SPA sert la route du dashboard.');

  const events = await request('/api/events');
  assert.ok(events.length > 0, 'Les événements de démonstration sont chargés.');
  const login = await request('/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: '2468' }),
  });
  const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${login.token}` };
  socket.connect();
  await once(socket, 'connect');
  const incoming = once(socket, 'reservation:new');
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const reservation = await request('/api/reservations', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Test Client', email: 'test@example.fr', phone: '0600000000', date: tomorrow, time: '19:00', guests: 2, note: '', eventId: null }),
  });
  const [liveReservation] = await incoming;
  assert.equal(liveReservation.id, reservation.id, 'La réservation est diffusée en direct.');
  const listed = await request('/api/admin/reservations', { headers: auth });
  assert.ok(listed.some((item) => item.id === reservation.id));
  const updated = await request(`/api/admin/reservations/${reservation.id}`, {
    method: 'PATCH', headers: auth, body: JSON.stringify({ status: 'Confirmée' }),
  });
  assert.equal(updated.status, 'Confirmée');

  const event = await request('/api/admin/events', {
    method: 'POST', headers: auth,
    body: JSON.stringify({ title: 'Test Jazz', description: 'Test API', date: tomorrow, time: '20:00', category: 'Musique', capacity: 30 }),
  });
  const edited = await request(`/api/admin/events/${event.id}`, {
    method: 'PUT', headers: auth,
    body: JSON.stringify({ ...event, title: 'Jazz modifié' }),
  });
  assert.equal(edited.title, 'Jazz modifié');
  await request(`/api/admin/events/${event.id}`, { method: 'DELETE', headers: auth });
  console.log('API smoke test OK : événements, authentification, réservation en direct, statut et gestion des événements.');
} finally {
  socket.disconnect();
  if (child.exitCode === null) { child.kill(); await once(child, 'exit').catch(() => {}); }
  rmSync(directory, { recursive: true, force: true });
}
