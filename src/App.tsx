import { useEffect, useState, type FormEvent } from 'react';
import { io } from 'socket.io-client';
import { ArrowLeft, ArrowRight, CalendarDays, Check, Clock3, LogOut, Mail, Radio, RefreshCw, Shield, Terminal, Trash2, Users, X } from 'lucide-react';

const apiBaseUrl = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');
const apiUrl = (path: string) => `${apiBaseUrl}${path}`;

async function apiFetch(path: string, options?: RequestInit): Promise<Response> {
  try {
    return await fetch(apiUrl(path), options);
  } catch (error) {
    if (error instanceof TypeError) {
      const help = import.meta.env.DEV
        ? 'Vérifiez que le serveur API est lancé avec npm run dev.'
        : 'Vérifiez VITE_API_URL dans Vercel et CORS_ALLOWED_ORIGINS sur Render.';
      throw new Error(`Impossible de joindre le serveur de réservation. ${help}`);
    }
    throw error;
  }
}

type Step = 'date' | 'details' | 'confirmation';
type BookingDraft = {
  date: string;
  time: string;
  guests: string;
  name: string;
  email: string;
  phone: string;
  note: string;
};
type Reservation = {
  reference: string;
  name: string;
  date: string;
  time: string;
  guests: number;
  notificationSent?: boolean;
  notificationError?: string;
};
type CreatorReservation = Reservation & {
  id: string;
  email: string;
  phone: string;
  note: string;
  status: string;
  createdAt: string;
};
type CreatorSettings = { email: string; mailReady: boolean };

function isReservation(value: unknown): value is Reservation {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.reference === 'string'
    && typeof candidate.name === 'string'
    && typeof candidate.date === 'string'
    && typeof candidate.time === 'string'
    && typeof candidate.guests === 'number'
    && (candidate.notificationSent === undefined || typeof candidate.notificationSent === 'boolean')
    && (candidate.notificationError === undefined || typeof candidate.notificationError === 'string');
}

function isCreatorReservation(value: unknown): value is CreatorReservation {
  if (!isReservation(value) || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === 'string'
    && typeof candidate.email === 'string'
    && typeof candidate.phone === 'string'
    && typeof candidate.note === 'string'
    && typeof candidate.status === 'string'
    && typeof candidate.createdAt === 'string';
}

async function creatorRequest<T>(path: string, token: string, options: RequestInit = {}): Promise<T> {
  const response = await apiFetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
  if (response.status === 404 && options.method === 'DELETE' && path.startsWith('/api/creators/reservations/')) {
    await response.text();
    throw new Error('La suppression n’est pas encore disponible sur le serveur en ligne. Redéployez la dernière version du serveur Express, puis réessayez.');
  }
  const data: unknown = response.status === 204 ? null : await readApiResponse(response);
  if (!response.ok) {
    const message = data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
      ? data.error
      : 'Impossible de communiquer avec le serveur.';
    throw new Error(message);
  }
  return data as T;
}

async function readApiResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    await response.text();
    if (response.status === 404) {
      throw new Error('Cette fonction n’est pas encore disponible sur le serveur en ligne. Redéployez la dernière version du serveur Express.');
    }
    throw new Error(
      `Le serveur en ligne a renvoyé une page web au lieu de l’API (HTTP ${response.status}). Vérifiez que le service Express est déployé et relié à cette adresse.`,
    );
  }
  try {
    return await response.json();
  } catch {
    throw new Error('Le serveur a renvoyé une réponse API illisible. Vérifiez son déploiement et ses journaux.');
  }
}

const paths: Record<Step, string> = {
  date: '#/reservation',
  details: '#/reservation/coordonnees',
  confirmation: '#/reservation/confirmation',
};
const timeSlots = ['12:00', '12:30', '13:00', '13:30', '19:00', '19:30', '20:00', '20:30', '21:00'];
const initialDraft: BookingDraft = {
  date: '',
  time: '19:00',
  guests: '2',
  name: '',
  email: '',
  phone: '',
  note: '',
};

function currentStep(): Step {
  if (window.location.hash.endsWith('/confirmation')) return 'confirmation';
  if (window.location.hash.endsWith('/coordonnees')) return 'details';
  return 'date';
}

function localToday() {
  const date = new Date();
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function readDraft(): BookingDraft {
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem('zinc-booking-draft') || 'null');
    if (
      saved && typeof saved === 'object' &&
      'date' in saved && typeof saved.date === 'string' &&
      'time' in saved && typeof saved.time === 'string' &&
      'guests' in saved && typeof saved.guests === 'string' &&
      'name' in saved && typeof saved.name === 'string' &&
      'email' in saved && typeof saved.email === 'string' &&
      'phone' in saved && typeof saved.phone === 'string' &&
      'note' in saved && typeof saved.note === 'string'
    ) {
      return {
        date: saved.date,
        time: saved.time,
        guests: saved.guests,
        name: saved.name,
        email: saved.email,
        phone: saved.phone,
        note: saved.note,
      };
    }
  } catch {
    sessionStorage.removeItem('zinc-booking-draft');
  }
  return initialDraft;
}

function readReservation(): Reservation | null {
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem('zinc-booking-confirmation') || 'null');
    if (isReservation(saved)) return saved;
  } catch {
    sessionStorage.removeItem('zinc-booking-confirmation');
  }
  return null;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${value}T12:00:00`));
}

async function createReservation(draft: BookingDraft): Promise<Reservation> {
  const response = await apiFetch('/api/reservations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...draft,
      guests: Number(draft.guests),
      eventId: null,
    }),
  });
  const result = await readApiResponse(response);
  if (!response.ok) {
    const message = result && typeof result === 'object' && 'error' in result && typeof result.error === 'string'
      ? result.error
      : 'Impossible d’enregistrer votre réservation.';
    throw new Error(message);
  }
  if (!isReservation(result)) {
    throw new Error('La réponse du serveur est invalide. Veuillez réessayer.');
  }
  return {
    reference: result.reference,
    name: result.name,
    date: result.date,
    time: result.time,
    guests: result.guests,
    notificationSent: result.notificationSent,
    notificationError: result.notificationError,
  };
}

export default function App() {
  const [step, setStep] = useState<Step>(currentStep);
  const [creatorsRoute, setCreatorsRoute] = useState(() => window.location.hash.startsWith('#/createurs'));
  const [draft, setDraft] = useState<BookingDraft>(readDraft);
  const [confirmation, setConfirmation] = useState<Reservation | null>(readReservation);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!window.location.hash) window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${paths.date}`);
    const syncRoute = () => {
      setCreatorsRoute(window.location.hash.startsWith('#/createurs'));
      setStep(currentStep());
    };
    window.addEventListener('hashchange', syncRoute);
    return () => window.removeEventListener('hashchange', syncRoute);
  }, []);

  useEffect(() => {
    sessionStorage.setItem('zinc-booking-draft', JSON.stringify(draft));
  }, [draft]);

  const navigate = (nextStep: Step) => {
    setError('');
    window.location.hash = paths[nextStep];
    setStep(nextStep);
  };

  const updateDraft = (updates: Partial<BookingDraft>) => {
    setDraft((current) => ({ ...current, ...updates }));
  };

  const continueToDetails = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    navigate('details');
  };

  const submitBooking = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft.date || !draft.time || !draft.guests) {
      setError('Choisissez d’abord une date, une heure et le nombre de personnes.');
      navigate('date');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const created = await createReservation(draft);
      setConfirmation(created);
      sessionStorage.setItem('zinc-booking-confirmation', JSON.stringify(created));
      navigate('confirmation');
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : 'Impossible d’enregistrer votre réservation.');
    } finally {
      setSubmitting(false);
    }
  };

  const newBooking = () => {
    setDraft(initialDraft);
    setConfirmation(null);
    sessionStorage.removeItem('zinc-booking-confirmation');
    navigate('date');
  };

  if (creatorsRoute) return <CreatorPortal />;

  const hasBookingDetails = Boolean(draft.date && draft.time && draft.guests);
  const safeStep = step === 'confirmation' && !confirmation ? 'date' : step;
  const stepIndex = safeStep === 'date' ? 1 : safeStep === 'details' ? 2 : 3;

  return (
    <main className="booking-app">
      <header className="app-header">
        <div className="brand-lockup">
          <a className="brand" href="#/reservation" aria-label="Le Zinc Bouillon — réservation">
            <img className="brand-logo" src="/logo-zinc.svg" alt="Le Zinc Bouillon" />
          </a>
          <button className="secret-logo-trigger" type="button" aria-label="Accès créateurs" title="Accès créateurs" onClick={() => { sessionStorage.removeItem('zinc-creators-token'); window.location.hash = '#/createurs/connexion'; }} />
        </div>
        <span className="header-caption">RÉSERVATION EN LIGNE</span>
      </header>

      <div className="booking-layout">
        <section className="booking-main" aria-live="polite">
          {safeStep !== 'confirmation' && (
            <div className="progress" aria-label={`Étape ${stepIndex} sur 3`}>
              <span className={stepIndex >= 1 ? 'progress-step active' : 'progress-step'}><i>1</i> Votre créneau</span>
              <span className="progress-line" />
              <span className={stepIndex >= 2 ? 'progress-step active' : 'progress-step'}><i>2</i> Vos coordonnées</span>
              <span className="progress-line" />
              <span className="progress-step"><i>3</i> Confirmation</span>
            </div>
          )}

          {safeStep === 'date' && (
            <form className="booking-card" onSubmit={continueToDetails}>
              <div className="eyebrow"><CalendarDays size={16} /> ÉTAPE 1 SUR 3</div>
              <h1>Choisissez votre<br /><em>moment à table.</em></h1>
              <p className="intro">Indiquez la date, l’heure et le nombre de personnes. Nous vous gardons une place.</p>

              <label className="field-label" htmlFor="booking-date">Date de réservation</label>
              <input
                id="booking-date"
                className="input-control"
                type="date"
                min={localToday()}
                required
                value={draft.date}
                onChange={(event) => updateDraft({ date: event.target.value })}
              />

              <fieldset className="field-group">
                <legend>Choisissez une heure</legend>
                <div className="time-grid">
                  {timeSlots.map((time) => (
                    <button
                      type="button"
                      className={draft.time === time ? 'time-option selected' : 'time-option'}
                      key={time}
                      aria-pressed={draft.time === time}
                      onClick={() => updateDraft({ time })}
                    >
                      {time}
                    </button>
                  ))}
                </div>
              </fieldset>

              <label className="field-label" htmlFor="booking-guests">Nombre de personnes</label>
              <select
                id="booking-guests"
                className="input-control"
                value={draft.guests}
                onChange={(event) => updateDraft({ guests: event.target.value })}
              >
                {Array.from({ length: 12 }, (_, index) => index + 1).map((count) => (
                  <option value={count} key={count}>{count} {count === 1 ? 'personne' : 'personnes'}</option>
                ))}
                <option value="more">Plus de 12 personnes</option>
              </select>

              {draft.guests === 'more' ? (
                <div className="large-party-contact" role="status">
                  <p>Pour une réservation de plus de 12 personnes, contactez directement le restaurant.</p>
                  <a className="primary-button" href="tel:+33494229000">Appeler le 04 94 22 90 00</a>
                </div>
              ) : (
                <button className="primary-button" type="submit">Continuer <ArrowRight size={17} /></button>
              )}
            </form>
          )}

          {safeStep === 'details' && (
            <form className="booking-card" onSubmit={submitBooking}>
              <button className="back-button" type="button" onClick={() => navigate('date')}><ArrowLeft size={15} /> Modifier le créneau</button>
              <div className="eyebrow"><Users size={16} /> ÉTAPE 2 SUR 3</div>
              <h1>Vos coordonnées<br /><em>pour vous recevoir.</em></h1>
              <p className="intro">Un moyen de vous joindre au cas où nous aurions une question à propos de votre réservation.</p>

              <label className="field-label" htmlFor="booking-name">Nom et prénom</label>
              <input id="booking-name" className="input-control" required minLength={2} autoComplete="name" placeholder="Votre nom" value={draft.name} onChange={(event) => updateDraft({ name: event.target.value })} />

              <div className="field-row">
                <div>
                  <label className="field-label" htmlFor="booking-email">Adresse e-mail</label>
                  <input id="booking-email" className="input-control" required type="email" autoComplete="email" placeholder="vous@exemple.fr" value={draft.email} onChange={(event) => updateDraft({ email: event.target.value })} />
                </div>
                <div>
                  <label className="field-label" htmlFor="booking-phone">Téléphone</label>
                  <input id="booking-phone" className="input-control" required type="tel" autoComplete="tel" placeholder="06 12 34 56 78" value={draft.phone} onChange={(event) => updateDraft({ phone: event.target.value })} />
                </div>
              </div>

              <label className="field-label" htmlFor="booking-note">Une précision à nous communiquer ? <span>(facultatif)</span></label>
              <textarea id="booking-note" className="input-control note-control" rows={3} maxLength={500} placeholder="Allergie, chaise bébé, occasion spéciale…" value={draft.note} onChange={(event) => updateDraft({ note: event.target.value })} />

              {error && <p className="form-error" role="alert">{error}</p>}
              <button className="primary-button" type="submit" disabled={submitting}>
                {submitting ? 'Enregistrement…' : 'Confirmer ma demande'} {!submitting && <ArrowRight size={17} />}
              </button>
              <p className="privacy-note">Votre demande est transmise directement au restaurant.</p>
            </form>
          )}

          {safeStep === 'confirmation' && confirmation && (
            <section className="booking-card confirmation-card">
              <div className="confirmation-icon"><Check size={30} /></div>
              <div className="eyebrow">RÉSERVATION ENREGISTRÉE</div>
              <h1>Merci {confirmation.name.split(' ')[0]},<br /><em>à très vite !</em></h1>
              <p className="intro">Votre demande a bien été reçue. Le restaurant vous recontactera si nécessaire pour confirmer les détails.</p>
              <div className="reference-card">
                <span>VOTRE RÉFÉRENCE</span>
                <strong>{confirmation.reference}</strong>
                <p>{formatDate(confirmation.date)}<br />{confirmation.time} · {confirmation.guests} {confirmation.guests === 1 ? 'personne' : 'personnes'}</p>
              </div>
              {confirmation.notificationSent === false && confirmation.notificationError && (
                <p className="notification-warning" role="status">Votre réservation est enregistrée, mais l’alerte e-mail n’a pas pu être envoyée. Le restaurant pourra consulter la demande dans son espace créateurs.</p>
              )}
              <button className="secondary-button" type="button" onClick={newBooking}>Faire une nouvelle réservation <ArrowRight size={16} /></button>
            </section>
          )}
        </section>

        <aside className="booking-summary" aria-label="Récapitulatif de la réservation">
          <div className="summary-heading"><Clock3 size={17} /><span>VOTRE RÉSERVATION</span></div>
          {hasBookingDetails ? (
            <div className="summary-details">
              <div><span>Date</span><strong>{formatDate(draft.date)}</strong></div>
              <div><span>Heure</span><strong>{draft.time}</strong></div>
              <div><span>Convives</span><strong>{draft.guests} {draft.guests === '1' ? 'personne' : 'personnes'}</strong></div>
            </div>
          ) : (
            <p className="summary-empty">Votre date et votre horaire s’afficheront ici.</p>
          )}
          <div className="summary-note">Une question ? Contactez directement le restaurant pour toute demande particulière.</div>
        </aside>
      </div>

      <footer className="app-footer">
        <span>LE ZINC BOUILLON</span>
        <span>Réservation simple, sans empreinte bancaire.</span>
      </footer>
    </main>
  );
}

function CreatorPortal() {
  const [token, setToken] = useState(() => sessionStorage.getItem('zinc-creators-token') || '');
  const [pin, setPin] = useState('');
  const [loginError, setLoginError] = useState('');
  const [reservations, setReservations] = useState<CreatorReservation[]>([]);
  const [email, setEmail] = useState('');
  const [mailReady, setMailReady] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState('');

  const signOut = () => {
    sessionStorage.removeItem('zinc-creators-token');
    setToken('');
    setReservations([]);
    setEmail('');
    window.location.hash = '#/createurs/connexion';
  };

  useEffect(() => {
    if (!token) return;
    let active = true;
    setLoading(true);
    Promise.all([
      creatorRequest<unknown>('/api/creators/reservations', token),
      creatorRequest<unknown>('/api/creators/settings', token),
    ]).then(([reservationData, settingsData]) => {
      if (!active) return;
      if (!Array.isArray(reservationData) || !reservationData.every(isCreatorReservation)) {
        throw new Error('La liste des réservations reçue du serveur est invalide.');
      }
      if (!settingsData || typeof settingsData !== 'object' || !('email' in settingsData) || typeof settingsData.email !== 'string' || !('mailReady' in settingsData) || typeof settingsData.mailReady !== 'boolean') {
        throw new Error('Les paramètres e-mail reçus du serveur sont invalides.');
      }
      setReservations(reservationData);
      setEmail(settingsData.email);
      setMailReady(settingsData.mailReady);
      setError('');
    }).catch((loadError) => {
      if (!active) return;
      const text = loadError instanceof Error ? loadError.message : 'Chargement impossible.';
      if (text.includes('Session créateur expirée')) signOut();
      else setError(text);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [token]);

  useEffect(() => {
    if (!token) return;
    const socket = io(apiBaseUrl || undefined);
    socket.on('reservation:new', (reservation: unknown) => {
      if (isCreatorReservation(reservation)) {
        setReservations((current) => [reservation, ...current.filter((item) => item.id !== reservation.id)]);
      }
    });
    socket.on('reservation:updated', (reservation: unknown) => {
      if (isCreatorReservation(reservation)) {
        setReservations((current) => current.map((item) => item.id === reservation.id ? reservation : item));
      }
    });
    socket.on('reservation:deleted', (reservation: unknown) => {
      if (reservation && typeof reservation === 'object' && 'id' in reservation && typeof reservation.id === 'string') {
        setReservations((current) => current.filter((item) => item.id !== reservation.id));
      }
    });
    return () => { socket.disconnect(); };
  }, [token]);

  const login = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoginError('');
    setBusy(true);
    try {
      const response = await apiFetch('/api/creators/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
      const result = await readApiResponse(response);
      if (!response.ok || !result || typeof result !== 'object' || !('token' in result) || typeof result.token !== 'string') {
        const errorMessage = result && typeof result === 'object' && 'error' in result && typeof result.error === 'string'
          ? result.error
          : 'Connexion impossible.';
        throw new Error(errorMessage);
      }
      sessionStorage.setItem('zinc-creators-token', result.token);
      setToken(result.token);
      setPin('');
      window.location.hash = '#/createurs/reservations';
    } catch (loginFailure) {
      setLoginError(loginFailure instanceof Error ? loginFailure.message : 'Connexion impossible.');
    } finally {
      setBusy(false);
    }
  };

  const saveEmail = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setMessage('');
    setBusy(true);
    try {
      const settings = await creatorRequest<CreatorSettings>('/api/creators/settings', token, {
        method: 'PUT',
        body: JSON.stringify({ email }),
      });
      setEmail(settings.email);
      setMailReady(settings.mailReady);
      setMessage('Adresse e-mail enregistrée.');
    } catch (saveFailure) {
      setError(saveFailure instanceof Error ? saveFailure.message : 'Enregistrement impossible.');
    } finally {
      setBusy(false);
    }
  };

  const refresh = async () => {
    setError('');
    setLoading(true);
    try {
      const data = await creatorRequest<unknown>('/api/creators/reservations', token);
      if (!Array.isArray(data) || !data.every(isCreatorReservation)) throw new Error('La liste reçue du serveur est invalide.');
      setReservations(data);
    } catch (refreshFailure) {
      setError(refreshFailure instanceof Error ? refreshFailure.message : 'Actualisation impossible.');
    } finally {
      setLoading(false);
    }
  };

  const deleteReservation = async (reservation: CreatorReservation) => {
    setError('');
    setMessage('');
    setDeletingId(reservation.id);
    try {
      await creatorRequest<void>(`/api/creators/reservations/${encodeURIComponent(reservation.id)}`, token, { method: 'DELETE' });
      setReservations((current) => current.filter((item) => item.id !== reservation.id));
      setMessage(`Réservation ${reservation.reference} supprimée.`);
      setConfirmDeleteId('');
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Suppression impossible.');
    } finally {
      setDeletingId('');
    }
  };

  if (!token) {
    return (
      <main className="creator-portal creator-auth">
        <form className="creator-auth-card" onSubmit={login}>
          <div className="creator-auth-mark"><Shield size={25} /></div>
          <div className="creator-kicker"><Terminal size={14} /> ACCÈS RESTREINT</div>
          <h1>Créateurs<span>_</span></h1>
          <p>Zone de contrôle privée. Saisissez votre code d’accès pour continuer.</p>
          <label htmlFor="creator-page-pin">PIN <span>// 4 DIGITS</span></label>
          <input id="creator-page-pin" autoFocus inputMode="numeric" type="password" pattern="[0-9]{4}" maxLength={4} required value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 4))} />
          {loginError && <p className="creator-error" role="alert">{loginError}</p>}
          <button className="creator-button" type="submit" disabled={busy}>{busy ? 'VÉRIFICATION…' : 'AUTHENTIFIER'} <ArrowRight size={16} /></button>
          <a className="creator-back" href="#/reservation"><ArrowLeft size={14} /> RETOUR À LA RÉSERVATION</a>
        </form>
      </main>
    );
  }

  return (
    <main className="creator-portal">
      <header className="creator-header">
        <div className="creator-title-lockup"><span className="creator-logo">Z<span>.</span></span><div><div className="creator-kicker"><Radio size={13} /> SYSTÈME EN LIGNE</div><h1>CREATORS<span>_</span></h1></div></div>
        <div className="creator-header-actions"><a href="#/reservation"><ArrowLeft size={15} /> RÉSERVATION</a><button type="button" onClick={signOut}><LogOut size={15} /> QUITTER</button></div>
      </header>
      <div className="creator-content">
        <div className="creator-welcome"><div><span className="creator-kicker">TABLEAU DE BORD // LE ZINC BOUILLON</span><h2>Réservations<span>_</span></h2></div><button className="creator-refresh" type="button" onClick={() => void refresh()} disabled={loading}><RefreshCw size={15} /> {loading ? 'CHARGEMENT' : 'ACTUALISER'}</button></div>

        <section className="creator-panel creator-email-panel">
          <div className="creator-panel-heading"><Mail size={17} /><h3>ALERTE E-MAIL</h3><span className={mailReady ? 'system-status ready' : 'system-status'}>{mailReady ? 'SERVICE ACTIF' : 'CONFIGURATION REQUISE'}</span></div>
          <form className="creator-email-form" onSubmit={saveEmail}>
            <label htmlFor="creator-email">ADRESSE DE NOTIFICATION</label>
            <div className="creator-email-controls"><input id="creator-email" type="email" required maxLength={254} placeholder="vous@exemple.fr" value={email} onChange={(event) => setEmail(event.target.value)} /><button type="submit" disabled={busy}>{busy ? 'ENREGISTREMENT…' : 'ENREGISTRER'}</button></div>
          </form>
          <p className="creator-hint">{mailReady ? 'Un e-mail sera envoyé à cette adresse à chaque nouvelle réservation.' : email ? 'Configurez RESEND_API_KEY et RESEND_FROM_EMAIL sur le serveur pour activer les notifications. Les réservations restent enregistrées même si l’envoi échoue.' : 'Saisissez et enregistrez une adresse e-mail pour recevoir les alertes de réservation.'}</p>
          {message && <p className="creator-success" role="status">{message}</p>}
        </section>

        <section className="creator-panel creator-reservations-panel">
          <div className="creator-panel-heading"><Users size={17} /><h3>CARNET DE RÉSERVATIONS</h3><span className="reservation-count">{reservations.length} ENREGISTRÉE{reservations.length === 1 ? '' : 'S'}</span></div>
          {error && <p className="creator-error creator-panel-error" role="alert">{error}</p>}
          {loading && reservations.length === 0 ? <p className="creator-empty">LECTURE DES DONNÉES…</p> : reservations.length === 0 ? <p className="creator-empty">AUCUNE RÉSERVATION POUR LE MOMENT.</p> : (
            <div className="creator-reservation-list">
              {reservations.map((reservation) => (
                <article className="creator-reservation" key={reservation.id}>
                  <div className="reservation-scan"><span>{reservation.reference}</span><strong>{reservation.guests.toString().padStart(2, '0')}</strong><small>CONVIVES</small></div>
                  <div className="creator-reservation-info"><div className="creator-reservation-top"><h4>{reservation.name}</h4><span className={`creator-status ${reservation.status === 'Annulée' ? 'cancelled' : ''}`}>{reservation.status.toUpperCase()}</span></div><p className="creator-reservation-date">{formatDate(reservation.date)} · {reservation.time}</p><p className="creator-contact"><a href={`mailto:${encodeURIComponent(reservation.email)}`}>{reservation.email}</a><span>·</span><a href={`tel:${reservation.phone.replace(/[^\d+]/g, '')}`}>{reservation.phone}</a></p>{reservation.note && <p className="creator-reservation-note">NOTE // {reservation.note}</p>}</div>
                  <div className="creator-delete-actions">
                    {confirmDeleteId === reservation.id ? (
                      <>
                        <span>SUPPRIMER ?</span>
                        <button className="creator-delete-confirm" type="button" disabled={deletingId === reservation.id} onClick={() => void deleteReservation(reservation)}>{deletingId === reservation.id ? 'SUPPRESSION…' : 'OUI, SUPPRIMER'}</button>
                        <button className="creator-delete-cancel" type="button" disabled={deletingId === reservation.id} onClick={() => setConfirmDeleteId('')}><X size={13} /> ANNULER</button>
                      </>
                    ) : (
                      <button className="creator-delete-button" type="button" aria-label={`Supprimer la réservation ${reservation.reference}`} title="Supprimer cette réservation" onClick={() => setConfirmDeleteId(reservation.id)}><Trash2 size={15} /> <span>SUPPRIMER</span></button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
        <footer className="creator-footer"><span>LE ZINC BOUILLON // PRIVATE ACCESS</span><span>FLUX TEMPS RÉEL <i /></span></footer>
      </div>
    </main>
  );
}
