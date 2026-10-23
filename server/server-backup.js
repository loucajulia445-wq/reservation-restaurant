import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dataPath = process.env.DB_PATH ? resolve(process.env.DB_PATH) : join(here, 'db.json');
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });
const sessions = new Set();
const port = Number(process.env.PORT || 4000);

function seedEvents() {
  const nextFriday = new Date();
  nextFriday.setDate(nextFriday.getDate() + ((5 - nextFriday.getDay() + 7) % 7 || 7));
  nextFriday.setHours(20, 0, 0, 0);
  const sunday = new Date(nextFriday);
  sunday.setDate(sunday.getDate() + 2);
  const date = (value) => value.toISOString().slice(0, 10);
  return [
    { id: randomUUID(), title: 'Jazz au Zinc', description: 'Un trio de jazz en live, des bougies et les grands classiques de la maison.', date: date(nextFriday), time: '20:00', category: 'Musique', capacity: 48, booked: 0 },
    { id: randomUUID(), title: 'Le grand brunch du dimanche', description: 'Œufs mayo, brioche perdue et produits du marché, à partager sans se presser.', date: date(sunday), time: '11:30', category: 'Brunch', capacity: 36, booked: 0 },
    { id: randomUUID(), title: 'Les copains du Zinc', description: 'Une soirée conviviale autour de nos assiettes à partager et de bons vins.', date: date(new Date(nextFriday.getTime() + 7 * 86400000)), time: '19:30', category: 'Soirée', capacity: 52, booked: 0 },
  ];
}

if (!existsSync(dataPath)) {
  mkdirSync(dirname(dataPath), { recursive: true });
  writeFileSync(dataPath, JSON.stringify({ reservations: [], events: seedEvents() }, null, 2));
}
let db = JSON.parse(readFileSync(dataPath, 'utf8'));
if (!Array.isArray(db.reservations) || !Array.isArray(db.events)) db = { reservations: [], events: seedEvents() };
if (typeof db.creatorEmail !== 'string') db.creatorEmail = '';
function persist() { writeFileSync(dataPath, JSON.stringify(db, null, 2)); }
const creatorSessions = new Set();
const emailPattern = /^\S+@\S+\.\S+$/;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

async function sendReservationEmail(reservation) {
  if (!db.creatorEmail) return { sent: false, error: 'Aucune adresse e-mail créateur n’est configurée.' };
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) {
    return { sent: false, error: 'Le service e-mail n’est pas configuré sur le serveur (RESEND_API_KEY et RESEND_FROM_EMAIL).' };
  }
  const dateLabel = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full', timeZone: 'Europe/Paris' })
    .format(new Date(`${reservation.date}T12:00:00`));
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL,
      to: [db.creatorEmail],
      subject: `Nouvelle réservation ${reservation.reference} · Le Zinc Bouillon`,
      html: `<h1>Nouvelle réservation</h1><p><strong>${escapeHtml(reservation.name)}</strong> a demandé une table.</p><ul><li>Date : ${escapeHtml(dateLabel)}</li><li>Heure : ${escapeHtml(reservation.time)}</li><li>Personnes : ${reservation.guests}</li><li>Téléphone : ${escapeHtml(reservation.phone)}</li><li>E-mail : ${escapeHtml(reservation.email)}</li></ul><p>Référence : ${escapeHtml(reservation.reference)}</p>${reservation.note ? `<p>Note : ${escapeHtml(reservation.note)}</p>` : ''}`,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const responseText = await response.text();
    const message = `Le fournisseur e-mail a refusé l’envoi (HTTP ${response.status}).`;
    console.error(`${message} ${responseText.slice(0, 500)}`);
    return { sent: false, error: message };
  }
  return { sent: true, error: '' };
}

app.use(express.json({ limit: '32kb' }));
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/events', (_req, res) => res.json(db.events.filter((event) => event.date >= new Date().toISOString().slice(0, 10)).sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`))));
app.post('/api/admin/login', (req, res) => {
  const expected = process.env.ADMIN_PIN || '1234';
  if (String(req.body?.pin || '') !== expected) return res.status(401).json({ error: 'Code incorrect.' });
  const token = randomUUID();
  sessions.add(token);
  res.json({ token });
});
app.post('/api/creators/login', (req, res) => {
  const expected = process.env.CREATOR_PIN || '1304';
  if (!/^\d{4}$/.test(String(req.body?.pin || '')) || String(req.body.pin) !== expected) {
    return res.status(401).json({ error: 'Code PIN incorrect.' });
  }
  const token = randomUUID();
  creatorSessions.add(token);
  res.json({ token });
});
function requireCreator(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token || !creatorSessions.has(token)) return res.status(401).json({ error: 'Session créateur expirée. Reconnectez-vous.' });
  next();
}
app.get('/api/creators/reservations', requireCreator, (_req, res) => {
  const sorted = [...db.reservations].sort((a, b) => `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`));
  res.json(sorted);
});
app.get('/api/creators/settings', requireCreator, (_req, res) => {
  res.json({
    email: db.creatorEmail,
    mailReady: Boolean(db.creatorEmail && process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL),
  });
});
app.put('/api/creators/settings', requireCreator, (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!emailPattern.test(email) || email.length > 254) return res.status(400).json({ error: 'Saisissez une adresse e-mail valide.' });
  db.creatorEmail = email;
  persist();
  res.json({
    email: db.creatorEmail,
    mailReady: Boolean(db.creatorEmail && process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL),
  });
});
function requireAdmin(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token || !sessions.has(token)) return res.status(401).json({ error: 'Session expirée. Reconnectez-vous.' });
  next();
}
app.get('/api/admin/reservations', requireAdmin, (_req, res) => {
  const sorted = [...db.reservations].sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  res.json(sorted);
});
app.post('/api/reservations', (req, res) => {
  const { name, email, phone, date, time, guests, note, eventId } = req.body || {};
  if (!name?.trim() || !/^\S+@\S+\.\S+$/.test(email || '') || !phone?.trim() || !date || !time || !Number.isInteger(Number(guests)) || Number(guests) < 1 || Number(guests) > 12) {
    return res.status(400).json({ error: 'Vérifiez les informations de votre réservation (1 à 12 personnes).' });
  }
  if (date < new Date().toISOString().slice(0, 10)) return res.status(400).json({ error: 'Choisissez une date à venir.' });
  const event = eventId ? db.events.find((item) => item.id === eventId) : null;
  if (eventId && !event) return res.status(404).json({ error: 'Cet événement n’est plus disponible.' });
  if (event && event.booked + Number(guests) > event.capacity) return res.status(409).json({ error: 'Il ne reste plus assez de places pour cet événement.' });
  const reservation = {
    id: randomUUID(), reference: `ZB-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    name: name.trim(), email: email.trim().toLowerCase(), phone: phone.trim(), date, time,
    guests: Number(guests), note: String(note || '').trim().slice(0, 500), eventId: event?.id || null,
    status: 'À confirmer', createdAt: new Date().toISOString(),
  };
  db.reservations.push(reservation);
  if (event) event.booked += reservation.guests;
  persist();
  io.emit('reservation:new', reservation);
  if (event) io.emit('events:updated');
  sendReservationEmail(reservation)
    .then((notification) => {
      if (!notification.sent && db.creatorEmail) console.error(`Notification e-mail non envoyée pour ${reservation.reference} : ${notification.error}`);
      res.status(201).json({ ...reservation, notificationSent: notification.sent, notificationError: notification.error });
    })
    .catch((error) => {
      console.error(`Erreur d’envoi de notification pour ${reservation.reference}:`, error);
      res.status(201).json({
        ...reservation,
        notificationSent: false,
        notificationError: 'Erreur de communication avec le service e-mail. Consultez les journaux du serveur.',
      });
    });
});
app.patch('/api/admin/reservations/:id', requireAdmin, (req, res) => {
  const reservation = db.reservations.find((item) => item.id === req.params.id);
  if (!reservation) return res.status(404).json({ error: 'Réservation introuvable.' });
  const allowed = ['À confirmer', 'Confirmée', 'Annulée', 'Terminée'];
  if (!allowed.includes(req.body?.status)) return res.status(400).json({ error: 'Statut invalide.' });
  const previousStatus = reservation.status;
  reservation.status = req.body.status;
  if (reservation.eventId && previousStatus !== 'Annulée' && reservation.status === 'Annulée') {
    const event = db.events.find((item) => item.id === reservation.eventId);
    if (event) event.booked = Math.max(0, event.booked - reservation.guests);
  }
  if (reservation.eventId && previousStatus === 'Annulée' && reservation.status !== 'Annulée') {
    const event = db.events.find((item) => item.id === reservation.eventId);
    if (event) event.booked += reservation.guests;
  }
  persist();
  io.emit('reservation:updated', reservation);
  io.emit('events:updated');
  res.json(reservation);
});
app.post('/api/admin/events', requireAdmin, (req, res) => {
  const { title, description, date, time, capacity, category } = req.body || {};
  if (!title?.trim() || !description?.trim() || !date || !time || Number(capacity) < 1) return res.status(400).json({ error: 'Complétez les champs obligatoires.' });
  const event = { id: randomUUID(), title: title.trim(), description: description.trim(), date, time, capacity: Number(capacity), category: category || 'Soirée', booked: 0 };
  db.events.push(event);
  persist();
  io.emit('events:updated');
  res.status(201).json(event);
});
app.put('/api/admin/events/:id', requireAdmin, (req, res) => {
  const event = db.events.find((item) => item.id === req.params.id);
  if (!event) return res.status(404).json({ error: 'Événement introuvable.' });
  const { title, description, date, time, capacity, category } = req.body || {};
  if (!title?.trim() || !description?.trim() || !date || !time || Number(capacity) < event.booked) return res.status(400).json({ error: 'Vérifiez les champs et la capacité (réservations déjà prises).' });
  Object.assign(event, { title: title.trim(), description: description.trim(), date, time, capacity: Number(capacity), category: category || 'Soirée' });
  persist();
  io.emit('events:updated');
  res.json(event);
});
app.delete('/api/admin/events/:id', requireAdmin, (req, res) => {
  const event = db.events.find((item) => item.id === req.params.id);
  if (!event) return res.status(404).json({ error: 'Événement introuvable.' });
  db.events = db.events.filter((item) => item.id !== req.params.id);
  persist();
  io.emit('events:updated');
  res.status(204).end();
});

const clientBuildPath = resolve(here, '../dist');
app.use(express.static(clientBuildPath));
app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path === '/api' || req.path.startsWith('/api/')) return next();
  res.sendFile(join(clientBuildPath, 'index.html'), (error) => {
    if (error) next(error);
  });
});

httpServer.listen(port, '0.0.0.0', () => console.log(`Le Zinc Bouillon API écoute sur http://localhost:${port}`));
