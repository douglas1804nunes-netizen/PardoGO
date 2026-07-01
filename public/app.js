function initialApiBaseUrl() {
  const saved = localStorage.getItem('pardogo_api_base');
  if (saved) return saved;

  const cfg = window.PARDOGO_MOBILE_CONFIG || {};
  const profiles = cfg.profiles && typeof cfg.profiles === 'object' ? cfg.profiles : null;
  const useProfile = Boolean(cfg.autoSelectProfile && profiles);

  if (useProfile) {
    const stage = String(cfg.appStage || 'development').trim().toLowerCase();
    const profileUrl = String(profiles[stage] || '').trim();
    if (profileUrl) return profileUrl;
  }

  return String(cfg.apiBaseUrl || '').trim();
}

const state = {
  token: localStorage.getItem('pardogo_token') || '',
  user: JSON.parse(localStorage.getItem('pardogo_user') || 'null'),
  tariffRules: null,
  driverOnline: false,
  currentPosition: null,
  destinationPosition: null,
  currentRoute: null,
  map: null,
  driverMap: null,
  markers: {},
  driverMarkers: {},
  routeLayer: null,
  driverRouteLayer: null,
  driverRides: [],
  selectedDriverRideId: null,
  defaultCenter: { lat: -21.302, lng: -52.833, label: 'Santa Rita do Pardo - MS' },
  eventSource: null,
  realtimeConnected: false,
  realtimeLastEventAt: null,
  apiBaseUrl: initialApiBaseUrl(),
  googleAuthReady: false,
  addressSuggestions: {
    origin: [],
    destination: []
  },
  routeAutoTimer: null
};

const $ = selector => document.querySelector(selector);
const $$ = selector => Array.from(document.querySelectorAll(selector));
const money = value => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dateFmt = value => value ? new Date(value).toLocaleString('pt-BR') : '-';
const coordFmt = value => Number(value).toFixed(5).replace('.', ',');
const hasGeo = () => 'geolocation' in navigator;
const hasLeaflet = () => Boolean(window.L && typeof window.L.map === 'function');
const LOGIN_DEFAULT_STATUS = 'Informe seu telefone e senha para acessar.';

function debounce(fn, delay = 350) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function isStrongPassword(value) {
  const text = String(value || '');
  return /^(?=.*[A-Z])(?=.*[^A-Za-z0-9]).{6,}$/.test(text);
}

function routeIntent() {
  const params = new URLSearchParams(window.location.search || '');
  const path = String(window.location.pathname || '').toLowerCase();
  const view = params.get('view');
  const area = params.get('area');
  if (view === 'register' || path.endsWith('/cadastro.html')) return { view: 'register', area: null };
  if (view === 'login' || path.endsWith('/login.html')) return { view: 'login', area: null };
  if (area === 'driverPanel' || path.endsWith('/motorista.html')) return { view: null, area: 'driverPanel' };
  if (area === 'passengerPanel' || path.endsWith('/passageiro.html')) return { view: null, area: 'passengerPanel' };
  if (area === 'adminPanel' || path.endsWith('/admin.html')) return { view: null, area: 'adminPanel' };
  return { view: null, area: null };
}

function currentIntentArea() {
  return routeIntent().area;
}

function canOpenArea(areaId) {
  if (!state.user) return areaId === 'passengerPanel';
  if (state.user.role === 'admin') return true;
  if (state.user.role === 'passenger') return areaId === 'passengerPanel';
  if (state.user.role === 'driver') return areaId === 'driverPanel';
  return false;
}

function targetAreaForCurrentUser() {
  const requested = currentIntentArea();
  if (requested && canOpenArea(requested)) return requested;
  return areaForRole(state.user?.role);
}

function normalizedApiBase() {
  return String(state.apiBaseUrl || '').trim().replace(/\/$/, '');
}

function apiUrl(path) {
  if (/^https?:\/\//i.test(path)) return path;
  const base = normalizedApiBase();
  if (!base) return path;
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

function apiModeLabel() {
  const base = normalizedApiBase();
  return base ? `API online: ${base}` : 'API local/mesmo domínio';
}

function googleClientId() {
  return String(window.PARDOGO_MOBILE_CONFIG?.googleClientId || '').trim();
}

function toast(message, type = '') {
  const el = $('#toast');
  el.textContent = message;
  el.className = `toast ${type}`;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 4200);
}

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const base = normalizedApiBase();
  const primaryUrl = apiUrl(path);
  let response;

  try {
    response = await fetch(primaryUrl, { ...options, headers });
  } catch (networkError) {
    if (base) {
      try {
        // Fallback para mesma origem quando a API configurada está indisponível.
        response = await fetch(path, { ...options, headers });
      } catch {}
    }
    if (!response) {
      const target = base || 'mesma origem';
      throw new Error(`Falha de conexão com o servidor (${target}). Verifique internet, URL da API e se o backend está online.`);
    }
  }

  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  const data = isJson ? await response.json() : await response.text();
  if (!isJson) {
    throw new Error('Resposta inválida da API. Verifique a URL configurada no app e se o backend está online.');
  }
  if (!response.ok) throw new Error(data.error || data.message || 'Erro na solicitação.');
  return data;
}

function isValidUserPayload(user) {
  return Boolean(user && typeof user === 'object' && typeof user.role === 'string' && typeof user.id === 'string');
}


function updateRealtimeStatus(label, connected = false) {
  const badge = $('#realtimeStatus');
  if (!badge) return;
  state.realtimeConnected = connected;
  badge.textContent = label;
  badge.className = `realtime-badge ${connected ? 'ok' : 'warn'}`;
}

function disconnectRealtime() {
  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
  }
  updateRealtimeStatus('Tempo real offline', false);
}

function connectRealtime() {
  if (!state.token || !window.EventSource) {
    disconnectRealtime();
    return;
  }
  if (state.eventSource) state.eventSource.close();

  updateRealtimeStatus('Conectando tempo real...', false);
  const url = apiUrl(`/api/events?token=${encodeURIComponent(state.token)}`);
  const source = new EventSource(url);
  state.eventSource = source;

  source.addEventListener('connected', event => {
    state.realtimeLastEventAt = new Date();
    updateRealtimeStatus('Tempo real online', true);
    try {
      const payload = JSON.parse(event.data);
      console.info(payload.message || 'Tempo real conectado.');
    } catch {}
  });

  source.addEventListener('ping', () => {
    state.realtimeLastEventAt = new Date();
    updateRealtimeStatus('Tempo real online', true);
  });

  source.addEventListener('ride-update', async event => {
    const payload = safeEventData(event);
    state.realtimeLastEventAt = new Date();
    updateRealtimeStatus('Tempo real online', true);
    if (payload?.type === 'created' && state.user?.role === 'driver') toast('Nova corrida disponível para aceitar.', 'ok');
    if (payload?.type === 'accepted' && state.user?.role === 'passenger') toast(`Corrida aceita por ${payload.ride?.driverName || 'um motorista'}.`, 'ok');
    if (payload?.type === 'finished') toast('Corrida finalizada.', 'ok');
    if (payload?.type === 'cancelled') toast(`Corrida cancelada${payload.reason ? `: ${payload.reason}` : '.'}`, 'error');
    if (payload?.type === 'rated') toast('Avaliação da corrida registrada.', 'ok');
    await refreshActiveArea();
  });

  source.addEventListener('driver-pending-rides', async event => {
    const payload = safeEventData(event);
    state.realtimeLastEventAt = new Date();
    updateRealtimeStatus('Tempo real online', true);
    if (state.user?.role === 'driver' && payload?.rides?.length) toast(`${payload.rides.length} corrida(s) pendente(s) disponível(is).`, 'ok');
    await refreshActiveArea();
  });

  source.addEventListener('driver-update', async event => {
    const payload = safeEventData(event);
    state.realtimeLastEventAt = new Date();
    updateRealtimeStatus('Tempo real online', true);
    if (payload?.driver?.id === state.user?.id) {
      state.user = payload.driver;
      state.driverOnline = Boolean(payload.driver.online);
      localStorage.setItem('pardogo_user', JSON.stringify(state.user));
    }
    await refreshActiveArea();
  });

  source.addEventListener('tariff-update', async event => {
    const payload = safeEventData(event);
    state.realtimeLastEventAt = new Date();
    updateRealtimeStatus('Tempo real online', true);
    if (payload?.tariffRules) state.tariffRules = payload.tariffRules;
    await loadConfig();
    await refreshActiveArea();
    toast('Tarifa atualizada pelo administrador.', 'ok');
  });

  source.addEventListener('support-update', async event => {
    safeEventData(event);
    state.realtimeLastEventAt = new Date();
    updateRealtimeStatus('Tempo real online', true);
    if (state.user?.role === 'admin') toast('Novo chamado de suporte recebido.', 'ok');
    await refreshActiveArea();
  });

  source.addEventListener('security-update', async event => {
    safeEventData(event);
    state.realtimeLastEventAt = new Date();
    updateRealtimeStatus('Tempo real online', true);
    if (state.user?.role === 'admin') toast('Nova denúncia registrada.', 'error');
    await refreshActiveArea();
  });

  source.onerror = () => {
    updateRealtimeStatus('Reconectando...', false);
  };
}

function safeEventData(event) {
  try { return JSON.parse(event.data); } catch { return {}; }
}

function saveSession(token, user) {
  if (!isValidUserPayload(user)) {
    throw new Error('Resposta de login inválida: usuário não retornado pela API.');
  }
  state.token = token;
  state.user = user;
  state.driverOnline = Boolean(user?.online);
  localStorage.setItem('pardogo_token', token);
  localStorage.setItem('pardogo_user', JSON.stringify(user));
  renderSession();
  connectRealtime();
}

function clearSession() {
  state.token = '';
  state.user = null;
  state.driverOnline = false;
  localStorage.removeItem('pardogo_token');
  localStorage.removeItem('pardogo_user');
  disconnectRealtime();
  renderSession();
}

function roleLabel(role) {
  return { admin: 'Administrador', passenger: 'Passageiro', driver: 'Motorista' }[role] || 'Usuário';
}


function areaForRole(role) {
  return { admin: 'adminPanel', driver: 'driverPanel', passenger: 'passengerPanel' }[role] || 'passengerPanel';
}

function setFormStatus(id, message, type = '') {
  const el = $(id);
  if (!el) return;
  el.textContent = message;
  el.className = `form-status ${type || 'muted'}`;
}

function permissionTone(state) {
  if (state === 'granted') return 'ok';
  if (state === 'denied') return 'bad';
  return 'warn';
}

function hasContactPicker() {
  return Boolean(navigator.contacts && typeof navigator.contacts.select === 'function');
}

async function queryPermissionState(name) {
  if (!navigator.permissions?.query) return 'indisponivel';
  try {
    const result = await navigator.permissions.query({ name });
    return result.state || 'prompt';
  } catch {
    return 'indisponivel';
  }
}

async function contactPermissionState() {
  if (!hasContactPicker()) return 'indisponivel';
  try {
    const state = await queryPermissionState('contacts');
    if (state !== 'indisponivel') return state;
  } catch {}
  return 'disponivel-no-dispositivo';
}

async function updateMobilePermissionsStatus() {
  const note = $('#firstAccessNote');
  if (!note) return;
  const notificationState = 'Notification' in window ? (Notification.permission || 'default') : 'indisponivel';
  const noteParts = [
    'No primeiro acesso, o app pode pedir permissão de localização, notificações e câmera/microfone quando uma função exigir.',
    notificationState === 'granted' ? 'Notificações já estão ativas.' : 'Notificações ainda não foram liberadas.'
  ];
  note.textContent = noteParts.join(' ');
}

async function requestEssentialPermissions() {
  const messages = [];
  if (navigator.mediaDevices?.getUserMedia) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      stream.getTracks().forEach(track => track.stop());
      messages.push('câmera/microfone ok');
    } catch {
      messages.push('câmera/microfone negado');
    }
  } else {
    messages.push('câmera/microfone indisponível');
  }

  if (hasContactPicker()) {
    try {
      await navigator.contacts.select(['name'], { multiple: false });
      messages.push('contatos ok');
    } catch {
      messages.push('contatos não concedido');
    }
  } else {
    messages.push('contatos indisponível');
  }

  await updateMobilePermissionsStatus();
  toast(`Permissões essenciais: ${messages.join(' • ')}.`, 'ok');
}

async function requestLocationPermission() {
  if (!hasGeo()) {
    toast('Geolocalização não está disponível neste dispositivo.', 'error');
    return;
  }
  try {
    await getBrowserPosition();
    toast('Permissão de localização concedida.', 'ok');
  } catch {
    toast('Permissão de localização negada ou indisponível.', 'error');
  }
}

async function requestNotificationPermission() {
  if (!('Notification' in window)) {
    toast('Notificações não são suportadas neste dispositivo.', 'error');
    return;
  }
  try {
    const result = await Notification.requestPermission();
    if (result === 'granted') {
      toast('Permissão de notificações concedida.', 'ok');
      return;
    }
    toast('Permissão de notificações não foi concedida.', 'error');
  } catch {
    toast('Não foi possível solicitar notificações neste momento.', 'error');
  }
}

function renderWalletBalance() {
  const el = $('#walletBalance');
  if (!el) return;
  const amount = Number(state.user?.walletBalance || 0);
  el.textContent = money(amount);
}

function walletTransactionItem(tx) {
  const type = tx.type === 'credit' ? 'Crédito' : 'Débito';
  const cls = tx.type === 'credit' ? 'ok' : 'bad';
  const signal = tx.type === 'credit' ? '+' : '-';
  const amount = money(Number(tx.amount || 0));
  const method = tx.method || 'Saldo do app';
  const description = tx.description || '';
  return `
    <div class="item wallet-tx-item">
      <header>
        <div>
          <strong>${type}</strong>
          <small>${dateFmt(tx.created_at)} • ${method}</small>
          ${description ? `<small>${description}</small>` : ''}
        </div>
        <span class="badge ${cls}">${signal} ${amount}</span>
      </header>
    </div>
  `;
}

function renderWalletTransactions(transactions = []) {
  const box = $('#walletTransactions');
  if (!box) return;
  if (!transactions.length) {
    box.innerHTML = '<div class="empty">Sem movimentações no momento.</div>';
    return;
  }
  box.innerHTML = transactions.slice(0, 10).map(walletTransactionItem).join('');
}

async function loadWallet() {
  if (!state.user || !['passenger', 'admin'].includes(state.user.role)) return;
  const data = await api('/api/wallet');
  state.user.walletBalance = Number(data.balance || 0);
  localStorage.setItem('pardogo_user', JSON.stringify(state.user));
  renderWalletBalance();
  renderWalletTransactions(data.transactions || []);
}

function sanitizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizePhoneField(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.toLowerCase() === 'admin') return 'admin';
  return raw.replace(/\D/g, '');
}

function formatPhoneForInput(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 13);
  if (digits.length <= 2) return digits;
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 8)}-${digits.slice(8)}`;
}

function wirePhoneInput(selector, allowAdmin = false) {
  const input = $(selector);
  if (!input) return;
  input.addEventListener('input', () => {
    const current = String(input.value || '').trim();
    if (allowAdmin && /^admin$/i.test(current)) {
      input.value = 'admin';
      return;
    }
    input.value = formatPhoneForInput(current);
  });
}

function setFormBusy(form, busy) {
  if (!form) return;
  const submit = form.querySelector('button[type="submit"]');
  if (submit) {
    if (!submit.dataset.originalText) submit.dataset.originalText = submit.textContent;
    submit.textContent = busy ? 'Processando...' : submit.dataset.originalText;
  }
  form.querySelectorAll('button, input, select, textarea').forEach(el => {
    if (busy) {
      el.dataset.prevDisabled = el.disabled ? '1' : '0';
      el.disabled = true;
    } else {
      el.disabled = el.dataset.prevDisabled === '1';
      delete el.dataset.prevDisabled;
    }
  });
}

function activateTab(targetId) {
  const target = targetId || areaForRole(state.user?.role);
  if (!canOpenArea(target)) {
    const fallback = areaForRole(state.user?.role);
    if (target !== fallback) {
      setFormStatus('#loginStatus', 'Acesse com o perfil correto para abrir esta aba.', 'error');
      toast('Aba não disponível para o perfil atual.', 'error');
    }
    return activateTab(fallback);
  }
  const tab = $(`.tab[data-target="${target}"]`);
  const panel = $(`#${target}`);
  if (!tab || !panel) return;
  $$('.tab').forEach(btn => btn.classList.remove('active'));
  $$('.panel').forEach(item => item.classList.remove('active'));
  tab.classList.add('active');
  panel.classList.add('active');
  if (target === 'passengerPanel' && state.map) setTimeout(() => state.map.invalidateSize(), 80);
  if (target === 'driverPanel' && state.driverMap) setTimeout(() => state.driverMap.invalidateSize(), 80);
  refreshActiveArea();
}

function switchRegisterRole(role) {
  const normalized = role === 'driver' ? 'driver' : 'passenger';
  const select = $('#registerRole');
  if (select) select.value = normalized;
  $('#driverFields')?.classList.toggle('hidden', normalized !== 'driver');
  ['vehicle', 'plate'].forEach(field => {
    const input = $('#registerForm')?.elements?.[field];
    if (!input) return;
    input.required = normalized === 'driver';
  });
}

function showRegisterPanel() {
  $('#authShell')?.classList.add('hidden');
  $('#registerPanel')?.classList.remove('hidden');
  switchRegisterRole('passenger');
  setFormStatus('#registerStatus', 'Preencha os dados para criar sua conta.', '');
  $('#registerForm')?.elements?.name?.focus();
}

function showLoginPanel() {
  $('#registerPanel')?.classList.add('hidden');
  $('#authShell')?.classList.remove('hidden');
  setFormStatus('#loginStatus', LOGIN_DEFAULT_STATUS, '');
  $('#loginForm')?.elements?.phone?.focus();
}

async function handleGoogleCredential(credential, role = 'passenger') {
  const data = await api('/api/auth/google', {
    method: 'POST',
    body: JSON.stringify({ credential, role })
  });
  saveSession(data.token, data.user);
  setFormStatus('#loginStatus', data.message || 'Acesso com Google realizado com sucesso.', 'ok');
  toast(data.message || 'Acesso com Google realizado com sucesso.', 'ok');
  activateTab(targetAreaForCurrentUser());
}

function initGoogleAuth() {
  const loginBtn = $('#googleAuthBtn');
  const registerBtn = $('#googleRegisterBtn');
  const clientId = googleClientId();

  const setUnavailable = message => {
    [loginBtn, registerBtn].forEach(btn => {
      if (!btn) return;
      btn.disabled = true;
      btn.title = message;
    });
  };

  if (!clientId) {
    setUnavailable('Defina googleClientId em public/mobile-config.js para habilitar o Google.');
    return;
  }

  const triggerGoogle = role => {
    if (!window.google?.accounts?.id) {
      toast('Google ainda não carregou. Tente novamente em alguns segundos.', 'error');
      return;
    }
    if (!state.googleAuthReady) {
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: async response => {
          try {
            const desiredRole = sessionStorage.getItem('pardogo_google_role') || 'passenger';
            await handleGoogleCredential(response.credential, desiredRole);
          } catch (error) {
            setFormStatus('#loginStatus', error.message, 'error');
            toast(error.message, 'error');
          }
        }
      });
      state.googleAuthReady = true;
    }
    sessionStorage.setItem('pardogo_google_role', role);
    window.google.accounts.id.prompt();
  };

  loginBtn?.addEventListener('click', () => triggerGoogle('passenger'));
  registerBtn?.addEventListener('click', () => triggerGoogle($('#registerRole')?.value === 'driver' ? 'driver' : 'passenger'));
}

async function doLogout(message = 'Você saiu do sistema.') {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch {}
  clearSession();
  toast(message);
  activateTab('passengerPanel');
}

function statusBadge(status) {
  const map = {
    pending: ['Pendente', 'warn'],
    approved: ['Aprovado', 'ok'],
    active: ['Ativo', 'ok'],
    blocked: ['Bloqueado', 'bad'],
    accepted: ['Aceita', 'warn'],
    finished: ['Finalizada', 'ok'],
    cancelled: ['Cancelada', 'bad'],
    open: ['Aberto', 'warn'],
    in_review: ['Em análise', 'warn'],
    closed: ['Fechado', 'ok'],
    resolved: ['Resolvido', 'ok']
  };
  const [label, cls] = map[status] || [status || 'Pendente', ''];
  return `<span class="badge ${cls}">${label}</span>`;
}

function renderSession() {
  const text = $('#sessionText');
  const logoutBtn = $('#logoutBtn');
  const loggedTitle = $('#loggedTitle');
  const loggedDescription = $('#loggedDescription');

  document.body.classList.toggle('is-logged-in', Boolean(state.user));

  if (state.user) {
    text.textContent = `${state.user.name} • ${roleLabel(state.user.role)}`;
    logoutBtn.classList.remove('hidden');
    if (loggedTitle) loggedTitle.textContent = `Você está conectado como ${roleLabel(state.user.role)}`;
    if (loggedDescription) {
      loggedDescription.textContent = state.user.role === 'driver' && state.user.status !== 'approved'
        ? `${state.user.name}, seu cadastro de motorista está em análise. Você pode acessar a aba de motorista e acompanhar o status.`
        : `${state.user.name}, use as abas abaixo ou clique em “Ir para minha área”.`;
    }
    renderWalletBalance();
  } else {
    text.textContent = 'Não conectado';
    logoutBtn.classList.add('hidden');
    setFormStatus('#loginStatus', LOGIN_DEFAULT_STATUS, '');
    renderWalletBalance();
  }
  protectPanels();
  refreshActiveArea();
}

function protectPanels() {
  $$('.protected').forEach(el => {
    const allowed = (el.dataset.role || '').split(' ').filter(Boolean);
    const ok = state.user && allowed.includes(state.user.role);
    el.classList.toggle('locked', !ok);
  });
}

async function loadConfig() {
  const data = await api('/api/config');
  state.tariffRules = data.tariffRules;
  $('#tariffMin').textContent = money(data.tariffRules.min);
  $('#tariffRulesText').textContent = `${money(data.tariffRules.base)} + ${money(data.tariffRules.perKm)}/km + ${money(data.tariffRules.perMin)}/min`;
  fillTariffForm(data.tariffRules);
}

async function loadLegalContent() {
  try {
    const data = await api('/api/legal');
    const legal = data.legal || {};
    $('#termsTitle').textContent = legal.terms?.title || 'Termos de uso';
    $('#termsSummary').textContent = legal.terms?.summary || '';
    $('#termsList').innerHTML = (legal.terms?.items || []).map(item => `<li>${item}</li>`).join('');
    $('#privacyTitle').textContent = legal.privacy?.title || 'Política de privacidade';
    $('#privacySummary').textContent = legal.privacy?.summary || '';
    $('#privacyList').innerHTML = (legal.privacy?.items || []).map(item => `<li>${item}</li>`).join('');
  } catch (error) {
    console.warn(error);
  }
}

async function loadMapDefaults() {
  try {
    const data = await api('/api/maps/default-center');
    state.defaultCenter = data.center || state.defaultCenter;
  } catch (error) {
    console.warn('Centro padrão local mantido.', error);
  }
}

function fillTariffForm(rules) {
  const form = $('#tariffForm');
  if (!form || !rules) return;
  ['base', 'perKm', 'perMin', 'min', 'driverSharePercent'].forEach(key => {
    if (form.elements[key]) form.elements[key].value = rules[key];
  });
}

function initMap() {
  const shell = $('#routeMap');
  if (!shell) return;

  if (!hasLeaflet()) {
    shell.classList.add('fallback-map');
    renderFallbackMap();
    return;
  }

  shell.classList.add('leaflet-container-shell');
  shell.innerHTML = '';
  state.map = L.map(shell, {
    zoomControl: true,
    attributionControl: true
  }).setView([state.defaultCenter.lat, state.defaultCenter.lng], 14);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap'
  }).addTo(state.map);

  state.markers.center = L.marker([state.defaultCenter.lat, state.defaultCenter.lng])
    .addTo(state.map)
    .bindPopup(state.defaultCenter.label || 'Santa Rita do Pardo - MS');

  state.map.on('click', event => {
    const form = $('#rideForm');
    if (!form) return;
    const { lat, lng } = event.latlng;
    const target = !form.elements.originLat.value ? 'origin' : 'destination';
    setPointFromMap(target, lat, lng).finally(() => renderRouteMap());
  });
}

function initDriverMap() {
  const shell = $('#driverRouteMap');
  if (!shell) return;

  if (!hasLeaflet()) {
    shell.classList.add('fallback-map');
    shell.innerHTML = '<div class="route-summary">Mapa indisponível neste navegador.</div>';
    return;
  }

  shell.classList.add('leaflet-container-shell');
  shell.innerHTML = '';
  state.driverMap = L.map(shell, {
    zoomControl: true,
    attributionControl: true
  }).setView([state.defaultCenter.lat, state.defaultCenter.lng], 13);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap'
  }).addTo(state.driverMap);
}

function setDriverMapMarker(key, coords, label, options = {}) {
  if (!state.driverMap || !coords) return;
  if (state.driverMarkers[key]) {
    state.driverMarkers[key].setLatLng([coords.lat, coords.lng]).bindPopup(label);
    return;
  }
  state.driverMarkers[key] = L.marker([coords.lat, coords.lng], options).addTo(state.driverMap).bindPopup(label);
}

function renderDriverRideMap() {
  const summary = $('#driverRouteSummary');
  const rides = state.driverRides || [];
  if (!summary) return;

  if (!rides.length) {
    summary.textContent = 'Sem corridas disponíveis para mostrar no mapa.';
    return;
  }

  const selected = rides.find(ride => ride.id === state.selectedDriverRideId) || rides[0];
  state.selectedDriverRideId = selected.id;

  if (!state.driverMap || !hasLeaflet()) {
    summary.innerHTML = `<strong>${selected.origin} → ${selected.destination}</strong><br>${selected.distanceKm} km • ${selected.minutes} min`;
    return;
  }

  if (state.driverRouteLayer) {
    state.driverRouteLayer.remove();
    state.driverRouteLayer = null;
  }

  const bounds = [];
  if (selected.pickupCoords) {
    setDriverMapMarker('pickup', selected.pickupCoords, 'Origem da corrida', { icon: pinIcon('origin') });
    bounds.push([selected.pickupCoords.lat, selected.pickupCoords.lng]);
  }
  if (selected.destinationCoords) {
    setDriverMapMarker('destination', selected.destinationCoords, 'Destino da corrida', { icon: pinIcon('destination') });
    bounds.push([selected.destinationCoords.lat, selected.destinationCoords.lng]);
  }
  if (state.user?.lastLocation) {
    setDriverMapMarker('driver', state.user.lastLocation, 'Sua posição atual', { icon: carIcon() });
    bounds.push([state.user.lastLocation.lat, state.user.lastLocation.lng]);
  }

  if (selected.routeGeometry?.coordinates?.length) {
    const coords = selected.routeGeometry.coordinates.map(([lng, lat]) => [lat, lng]);
    state.driverRouteLayer = L.polyline(coords, { weight: 5, opacity: 0.8 }).addTo(state.driverMap);
    coords.forEach(point => bounds.push(point));
  } else if (selected.pickupCoords && selected.destinationCoords) {
    state.driverRouteLayer = L.polyline(
      [[selected.pickupCoords.lat, selected.pickupCoords.lng], [selected.destinationCoords.lat, selected.destinationCoords.lng]],
      { weight: 4, dashArray: '8,8', opacity: 0.65 }
    ).addTo(state.driverMap);
  }

  if (bounds.length >= 2) state.driverMap.fitBounds(bounds, { padding: [28, 28], maxZoom: 16 });
  if (bounds.length === 1) state.driverMap.setView(bounds[0], 15);

  summary.innerHTML = `<strong>${selected.origin} → ${selected.destination}</strong><br>${selected.distanceKm} km • ${selected.minutes} min • ${routeSourceLabel(selected.routeSource || 'manual')}`;
}

function getRideFormCoords() {
  const form = $('#rideForm');
  if (!form) return { origin: null, destination: null };
  const originLat = Number(form.elements.originLat.value);
  const originLng = Number(form.elements.originLng.value);
  const destinationLat = Number(form.elements.destinationLat.value);
  const destinationLng = Number(form.elements.destinationLng.value);
  return {
    origin: Number.isFinite(originLat) && Number.isFinite(originLng) ? { lat: originLat, lng: originLng } : null,
    destination: Number.isFinite(destinationLat) && Number.isFinite(destinationLng) ? { lat: destinationLat, lng: destinationLng } : null
  };
}

function setOriginCoords(lat, lng, label = 'Origem') {
  const form = $('#rideForm');
  form.elements.originLat.value = Number(lat).toFixed(6);
  form.elements.originLng.value = Number(lng).toFixed(6);
  state.currentPosition = { lat: Number(lat), lng: Number(lng), label };
  if (!form.elements.origin.value.trim()) form.elements.origin.value = label;
  $('#locationText').textContent = `Origem: ${coordFmt(lat)}, ${coordFmt(lng)}`;
}

function setDestinationCoords(lat, lng, label = 'Destino') {
  const form = $('#rideForm');
  form.elements.destinationLat.value = Number(lat).toFixed(6);
  form.elements.destinationLng.value = Number(lng).toFixed(6);
  state.destinationPosition = { lat: Number(lat), lng: Number(lng), label };
  if (!form.elements.destination.value.trim()) form.elements.destination.value = label;
  $('#destinationText').textContent = `Destino: ${coordFmt(lat)}, ${coordFmt(lng)}`;
}

function clearRideCoords(type) {
  const form = $('#rideForm');
  if (!form) return;
  if (type === 'origin') {
    form.elements.originLat.value = '';
    form.elements.originLng.value = '';
    state.currentPosition = null;
    $('#locationText').textContent = 'Origem sem coordenadas. Use mapa, localização ou busca.';
  }
  if (type === 'destination') {
    form.elements.destinationLat.value = '';
    form.elements.destinationLng.value = '';
    state.destinationPosition = null;
    $('#destinationText').textContent = 'Destino sem coordenadas. Use mapa ou busca para definir com precisão.';
  }
  state.currentRoute = null;
}

async function reverseGeocode(lat, lng) {
  const data = await api(`/api/maps/reverse-geocode?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`);
  return String(data.result?.label || '').trim();
}

async function setPointFromMap(type, lat, lng) {
  const form = $('#rideForm');
  if (!form) return;
  const fallback = type === 'origin' ? 'Origem selecionada no mapa' : 'Destino selecionado no mapa';
  let label = fallback;
  try {
    const resolved = await reverseGeocode(lat, lng);
    if (resolved) label = resolved;
  } catch {}
  if (type === 'origin') {
    setOriginCoords(lat, lng, label);
    form.elements.origin.value = label;
    toast('Origem marcada no mapa.', 'ok');
  } else {
    setDestinationCoords(lat, lng, label);
    form.elements.destination.value = label;
    toast('Destino marcado no mapa.', 'ok');
  }
  scheduleAutoEstimate();
}

async function resolveRideFieldByGeocode(type) {
  const form = $('#rideForm');
  if (!form) return null;
  const field = type === 'origin' ? form.elements.origin : form.elements.destination;
  const query = String(field.value || '').trim();
  if (!query) return null;
  const data = await api(`/api/maps/geocode?q=${encodeURIComponent(query)}`);
  if (!Array.isArray(data.results) || !data.results.length) {
    throw new Error(type === 'origin' ? 'Origem não encontrada no mapa.' : 'Destino não encontrado no mapa.');
  }
  const place = data.results[0];
  const bestLabel = String(place.label || query).trim();
  if (type === 'origin') setOriginCoords(place.lat, place.lng, bestLabel);
  if (type === 'destination') setDestinationCoords(place.lat, place.lng, bestLabel);
  field.value = bestLabel;
  return place;
}

function updateSuggestionList(type, results = []) {
  const datalist = type === 'origin' ? $('#originSuggestions') : $('#destinationSuggestions');
  if (!datalist) return;
  datalist.innerHTML = '';
  for (const item of results.slice(0, 6)) {
    const option = document.createElement('option');
    option.value = item.label;
    datalist.appendChild(option);
  }
}

const requestAddressSuggestions = debounce(async (type, query) => {
  const text = String(query || '').trim();
  if (text.length < 3) {
    state.addressSuggestions[type] = [];
    updateSuggestionList(type, []);
    return;
  }
  try {
    const data = await api(`/api/maps/geocode?q=${encodeURIComponent(text)}`);
    state.addressSuggestions[type] = Array.isArray(data.results) ? data.results : [];
    updateSuggestionList(type, state.addressSuggestions[type]);
  } catch {
    state.addressSuggestions[type] = [];
    updateSuggestionList(type, []);
  }
}, 320);

function applyKnownSuggestion(type) {
  const form = $('#rideForm');
  if (!form) return false;
  const field = type === 'origin' ? form.elements.origin : form.elements.destination;
  const value = String(field.value || '').trim();
  if (!value) return false;
  const hit = (state.addressSuggestions[type] || []).find(item => String(item.label || '').trim() === value);
  if (!hit) return false;
  if (type === 'origin') setOriginCoords(hit.lat, hit.lng, hit.label || value);
  if (type === 'destination') setDestinationCoords(hit.lat, hit.lng, hit.label || value);
  renderRouteMap();
  scheduleAutoEstimate();
  return true;
}

function scheduleAutoEstimate() {
  if (state.routeAutoTimer) clearTimeout(state.routeAutoTimer);
  state.routeAutoTimer = setTimeout(async () => {
    const { origin, destination } = getRideFormCoords();
    if (!origin || !destination) return;
    try {
      await calculateRoute();
      await estimateFare();
    } catch {}
  }, 420);
}

function renderRouteMap() {
  const form = $('#rideForm');
  if (!form) return;
  const origin = form.elements.origin.value || 'Origem';
  const destination = form.elements.destination.value || 'Destino';
  const distanceKm = Number(form.elements.distanceKm.value || 0);
  const minutes = Number(form.elements.minutes.value || 0);
  const distancePreview = $('#rideDistancePreview');
  const minutesPreview = $('#rideMinutesPreview');
  if (distancePreview) distancePreview.textContent = distanceKm > 0 ? `${distanceKm} km` : '- km';
  if (minutesPreview) minutesPreview.textContent = minutes > 0 ? `${minutes} min` : '- min';
  const { origin: originCoords, destination: destinationCoords } = getRideFormCoords();

  if (state.map && hasLeaflet()) {
    drawLeafletRoute(origin, destination, originCoords, destinationCoords);
  } else {
    renderFallbackMap();
  }

  const source = state.currentRoute?.source ? routeSourceLabel(state.currentRoute.source) : 'manual/simulado';
  const fallback = state.currentRoute?.fallback ? ' • usando fallback' : '';
  $('#routeSummary').innerHTML = `<strong>${origin} → ${destination}</strong><br>${distanceKm || '-'} km • ${minutes || '-'} min • fonte: ${source}${fallback}.`;
}

function drawLeafletRoute(originLabel, destinationLabel, originCoords, destinationCoords) {
  const bounds = [];
  if (originCoords) {
    setLeafletMarker('origin', originCoords, originLabel || 'Origem', { icon: pinIcon('origin') });
    bounds.push([originCoords.lat, originCoords.lng]);
  }
  if (destinationCoords) {
    setLeafletMarker('destination', destinationCoords, destinationLabel || 'Destino', { icon: pinIcon('destination') });
    bounds.push([destinationCoords.lat, destinationCoords.lng]);
  }
  if (state.user?.role === 'driver' && state.user.lastLocation) {
    setLeafletMarker('driver', state.user.lastLocation, 'Minha posição como motorista', { icon: carIcon() });
    bounds.push([state.user.lastLocation.lat, state.user.lastLocation.lng]);
  }

  if (state.routeLayer) {
    state.routeLayer.remove();
    state.routeLayer = null;
  }

  if (state.currentRoute?.geometry?.coordinates?.length) {
    const coords = state.currentRoute.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
    state.routeLayer = L.polyline(coords, { weight: 5, opacity: 0.75 }).addTo(state.map);
    coords.forEach(point => bounds.push(point));
  } else if (originCoords && destinationCoords) {
    state.routeLayer = L.polyline([[originCoords.lat, originCoords.lng], [destinationCoords.lat, destinationCoords.lng]], { weight: 4, dashArray: '8,8', opacity: 0.65 }).addTo(state.map);
  }

  if (bounds.length >= 2) state.map.fitBounds(bounds, { padding: [28, 28], maxZoom: 16 });
  if (bounds.length === 1) state.map.setView(bounds[0], 15);
}

function setLeafletMarker(key, coords, label, options = {}) {
  if (state.markers[key]) {
    state.markers[key].setLatLng([coords.lat, coords.lng]).bindPopup(label);
    return;
  }
  state.markers[key] = L.marker([coords.lat, coords.lng], options).addTo(state.map).bindPopup(label);
}

function pinIcon(type) {
  const cls = type === 'origin' ? 'leaflet-pin-origin' : 'leaflet-pin-destination';
  const text = type === 'origin' ? 'O' : 'D';
  return L.divIcon({ className: `leaflet-pin ${cls}`, html: `<span>${text}</span>`, iconSize: [32, 32], iconAnchor: [16, 32] });
}

function carIcon() {
  return L.divIcon({ className: 'leaflet-car', html: '🚗', iconSize: [34, 34], iconAnchor: [17, 17] });
}

function renderFallbackMap() {
  const shell = $('#routeMap');
  if (!shell || !shell.classList.contains('fallback-map')) return;
  shell.innerHTML = `
    <div class="map-grid"></div>
    <div class="map-road main"></div>
    <div class="map-road cross"></div>
    <div class="map-pin origin" id="originPin"><span>Origem</span></div>
    <div class="map-pin destination" id="destinationPin"><span>Destino</span></div>
    <div class="map-car" id="mapCar">🚗</div>
  `;
  const form = $('#rideForm');
  if (!form) return;
  const distanceKm = Number(form.elements.distanceKm.value || 0);
  const seed = Math.max(1, Math.min(9, Math.round(distanceKm || 2)));
  const originLeft = 14 + seed;
  const originTop = 56 - Math.min(seed, 5);
  const destinationLeft = 68 + Math.min(seed * 2, 14);
  const destinationTop = 24 + Math.min(seed, 10);
  const originPin = $('#originPin');
  const destinationPin = $('#destinationPin');
  const car = $('#mapCar');
  if (!originPin || !destinationPin || !car) return;
  originPin.style.left = `${originLeft}%`;
  originPin.style.top = `${originTop}%`;
  destinationPin.style.left = `${destinationLeft}%`;
  destinationPin.style.top = `${destinationTop}%`;
  car.style.left = `${(originLeft + destinationLeft) / 2}%`;
  car.style.top = `${(originTop + destinationTop) / 2}%`;
}

function routeSourceLabel(source) {
  return {
    osrm: 'rota real OSRM',
    'haversine-fallback': 'cálculo por coordenadas',
    manual: 'manual'
  }[source] || source;
}

function getBrowserPosition() {
  return new Promise((resolve, reject) => {
    if (!hasGeo()) return reject(new Error('Seu navegador não liberou geolocalização.'));
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 30000
    });
  });
}

async function capturePassengerLocation() {
  try {
    const position = await getBrowserPosition();
    const { latitude, longitude, accuracy } = position.coords;
    setOriginCoords(latitude, longitude, 'Minha localização atual');
    $('#locationText').textContent = `Localização capturada: ${coordFmt(latitude)}, ${coordFmt(longitude)} • precisão aprox. ${Math.round(accuracy || 0)}m`;
    renderRouteMap();
    scheduleAutoEstimate();
    toast('Localização do passageiro capturada.', 'ok');
  } catch (error) {
    toast('Não consegui capturar a localização. Verifique a permissão do navegador.', 'error');
  }
}

async function geocodeField(type) {
  const form = $('#rideForm');
  const field = type === 'origin' ? form.elements.origin : form.elements.destination;
  const query = field.value.trim();
  if (!query) return toast(type === 'origin' ? 'Digite uma origem para buscar.' : 'Digite um destino para buscar.', 'error');
  const data = await api(`/api/maps/geocode?q=${encodeURIComponent(query)}`);
  if (!data.results.length) return toast('Endereço não encontrado. Tente colocar bairro, rua ou ponto de referência.', 'error');
  const place = data.results[0];
  const bestLabel = String(place.label || query).trim();
  if (type === 'origin') setOriginCoords(place.lat, place.lng, bestLabel);
  if (type === 'destination') setDestinationCoords(place.lat, place.lng, bestLabel);
  field.value = bestLabel;
  renderRouteMap();
  scheduleAutoEstimate();
  toast(`${type === 'origin' ? 'Origem' : 'Destino'} encontrado no mapa.`, 'ok');
}

async function updateDriverLocation() {
  if (!state.user || state.user.role !== 'driver') return toast('Entre como motorista.', 'error');
  try {
    const position = await getBrowserPosition();
    const body = {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      accuracy: position.coords.accuracy
    };
    const data = await api('/api/driver/location', { method: 'PATCH', body: JSON.stringify(body) });
    state.user = data.user;
    localStorage.setItem('pardogo_user', JSON.stringify(data.user));
    $('#driverLocationText').textContent = `Posição enviada: ${coordFmt(body.lat)}, ${coordFmt(body.lng)}`;
    renderRouteMap();
    toast('Posição do motorista atualizada.', 'ok');
  } catch (error) {
    toast('Não consegui atualizar a localização do motorista.', 'error');
  }
}

async function calculateRoute() {
  const { origin, destination } = getRideFormCoords();
  if (!origin || !destination) {
    state.currentRoute = null;
    renderRouteMap();
    return null;
  }
  const route = await api('/api/maps/route', {
    method: 'POST',
    body: JSON.stringify({ originLat: origin.lat, originLng: origin.lng, destinationLat: destination.lat, destinationLng: destination.lng })
  });
  state.currentRoute = route;
  const form = $('#rideForm');
  form.elements.distanceKm.value = route.distanceKm;
  form.elements.minutes.value = route.minutes;
  $('#routeModeText').textContent = `Rota: ${route.distanceKm} km • ${route.minutes} min • ${routeSourceLabel(route.source)}${route.fallback ? ' (fallback)' : ''}`;
  renderRouteMap();
  return route;
}

async function estimateFare() {
  const form = $('#rideForm');
  const { origin, destination } = getRideFormCoords();
  let payload = {
    distanceKm: Number(form.elements.distanceKm.value || 0),
    minutes: Number(form.elements.minutes.value || 0)
  };
  if (origin && destination) {
    payload = {
      ...payload,
      originLat: origin.lat,
      originLng: origin.lng,
      destinationLat: destination.lat,
      destinationLng: destination.lng,
      useRoute: true
    };
  }
  const data = await api('/api/rides/estimate', { method: 'POST', body: JSON.stringify(payload) });
  $('#farePreview').textContent = money(data.fare);
  if (data.distanceKm) form.elements.distanceKm.value = data.distanceKm;
  if (data.minutes) form.elements.minutes.value = data.minutes;
  if (data.routeGeometry) {
    state.currentRoute = {
      source: data.routeSource,
      geometry: data.routeGeometry,
      fallback: data.routeFallback,
      distanceKm: data.distanceKm,
      minutes: data.minutes
    };
  }
  renderRouteMap();
  return data.fare;
}

function rideItem(ride, options = {}) {
  const status = statusBadge(ride.status);
  const driver = ride.driverName ? `<small>Motorista: ${ride.driverName}</small>` : '<small>Aguardando motorista</small>';
  let actions = '';
  const canCancel = ['pending', 'accepted'].includes(ride.status);
  if (options.driver && ride.status === 'pending') actions += `<button class="small ok" data-accept="${ride.id}">Aceitar</button>`;
  if (options.driver && ride.status === 'accepted' && ride.driverId === state.user?.id) actions += `<button class="small" data-finish="${ride.id}">Finalizar</button>`;
  if (options.driver && (ride.pickupCoords || ride.destinationCoords)) actions += `<button class="small" data-driver-map="${ride.id}">Ver no mapa</button>`;
  if (options.admin && ride.status === 'accepted') actions += `<button class="small" data-admin-finish="${ride.id}">Finalizar pelo admin</button>`;
  if (canCancel && (options.passenger || options.admin || (options.driver && ride.driverId === state.user?.id))) actions += `<button class="small bad" data-cancel="${ride.id}">Cancelar</button>`;
  if ((options.passenger || options.admin) && ride.driverId) {
    actions += `<button class="small" data-contact="${ride.id}" data-target="driver" data-channel="whatsapp">WhatsApp motorista</button>`;
    actions += `<button class="small" data-contact="${ride.id}" data-target="driver" data-channel="call">Ligar motorista</button>`;
  }
  if ((options.driver && ride.driverId === state.user?.id) || options.admin) {
    actions += `<button class="small" data-contact="${ride.id}" data-target="passenger" data-channel="whatsapp">WhatsApp passageiro</button>`;
    actions += `<button class="small" data-contact="${ride.id}" data-target="passenger" data-channel="call">Ligar passageiro</button>`;
  }
  if (options.passenger && ride.status === 'finished' && ride.driverId && !ride.rating) {
    actions += `<button class="small ok" data-rate="${ride.id}">Avaliar corrida</button>`;
  }
  if (options.passenger && ride.status === 'finished' && ride.driverId && ride.rating) {
    actions += `<button class="small" data-rate="${ride.id}">Editar avaliação</button>`;
  }
  const coords = ride.pickupCoords ? `<span class="coords">Origem GPS: ${coordFmt(ride.pickupCoords.lat)}, ${coordFmt(ride.pickupCoords.lng)}</span>` : '';
  const destinationCoords = ride.destinationCoords ? `<span class="coords">Destino GPS: ${coordFmt(ride.destinationCoords.lat)}, ${coordFmt(ride.destinationCoords.lng)}</span>` : '';
  const route = ride.routeSource ? `<span class="coords">Rota: ${routeSourceLabel(ride.routeSource)}${ride.straightLineKm ? ` • linha reta ${ride.straightLineKm} km` : ''}</span>` : '';
  const rating = ride.rating ? `<small class="rating-note">Avaliação: ${'★'.repeat(ride.rating.rating)}${'☆'.repeat(5 - ride.rating.rating)}${ride.rating.comment ? ` • ${ride.rating.comment}` : ''}</small>` : '';
  return `
    <div class="item">
      <header>
        <div>
          <strong>${ride.origin} → ${ride.destination}</strong>
          <small>${dateFmt(ride.createdAt)} • Passageiro: ${ride.passengerName || '-'}</small><br>
          ${driver}
        </div>
        ${status}
      </header>
      <p><strong>${money(ride.fare)}</strong> • ${ride.distanceKm} km • ${ride.minutes} min • ${ride.paymentMethod || 'Pagamento não informado'}</p>
      ${ride.notes ? `<small>Obs.: ${ride.notes}</small>` : ''}
      ${ride.cancelReason ? `<small class="cancel-note">Cancelamento: ${ride.cancelReason} • ${dateFmt(ride.cancelledAt)}</small>` : ''}
      ${rating}
      ${coords}${destinationCoords}${route}
      ${actions ? `<div class="item-actions">${actions}</div>` : ''}
    </div>
  `;
}

async function loadPassengerRides() {
  if (!state.user || !['passenger', 'admin'].includes(state.user.role)) return;
  await loadWallet().catch(() => {});
  const data = await api('/api/rides/my');
  $('#passengerRides').innerHTML = data.rides.length ? data.rides.map(r => rideItem(r, { passenger: true })).join('') : '<div class="empty">Nenhuma corrida ainda.</div>';
}

async function loadDriverRides() {
  if (!state.user || state.user.role !== 'driver') return;
  if (state.user.status !== 'approved') {
    $('#driverRides').innerHTML = '<div class="empty">Seu cadastro de motorista está em análise. Assim que o admin aprovar, as corridas aparecerão aqui.</div>';
    $('#driverStatusBadge').textContent = 'Pendente de aprovação';
    $('#driverStatusBadge').className = 'badge warn';
    const toggleBtn = $('#toggleOnlineBtn');
    const locationBtn = $('#driverLocationBtn');
    if (toggleBtn) toggleBtn.disabled = true;
    if (locationBtn) locationBtn.disabled = true;
    $('#driverLocationText').textContent = 'Aguardando aprovação para ativar status e localização do motorista.';
    state.driverRides = [];
    renderDriverRideMap();
    return;
  }

  const data = await api('/api/driver/rides');
  state.driverRides = data.rides;
  $('#driverRides').innerHTML = data.rides.length ? data.rides.map(r => rideItem(r, { driver: true })).join('') : '<div class="empty">Nenhuma corrida disponível.</div>';
  $('#driverStatusBadge').textContent = state.driverOnline ? 'Online' : 'Offline';
  $('#driverStatusBadge').className = `badge ${state.driverOnline ? 'ok' : ''}`;
  const toggleBtn = $('#toggleOnlineBtn');
  const locationBtn = $('#driverLocationBtn');
  if (toggleBtn) toggleBtn.disabled = false;
  if (locationBtn) locationBtn.disabled = false;
  if (state.user?.lastLocation?.lat) {
    $('#driverLocationText').textContent = `Última posição: ${coordFmt(state.user.lastLocation.lat)}, ${coordFmt(state.user.lastLocation.lng)}`;
  }
  renderDriverRideMap();
}

async function loadAdminDashboard() {
  if (!state.user || state.user.role !== 'admin') return;
  const data = await api('/api/admin/dashboard');
  renderMetrics(data.stats);
  fillTariffForm(data.tariffRules);
  const drivers = data.users.filter(u => u.role === 'driver');
  const passengers = data.users.filter(u => u.role === 'passenger');
  $('#driversList').innerHTML = drivers.length ? drivers.map(driverItem).join('') : '<div class="empty">Nenhum motorista cadastrado.</div>';
  $('#passengersList').innerHTML = passengers.length ? passengers.map(passengerItem).join('') : '<div class="empty">Nenhum passageiro cadastrado.</div>';
  $('#adminRides').innerHTML = data.rides.length ? data.rides.map(r => rideItem(r, { admin: true })).join('') : '<div class="empty">Nenhuma corrida cadastrada.</div>';
  $('#adminSupportList').innerHTML = data.supportTickets?.length ? data.supportTickets.map(supportItem).join('') : '<div class="empty">Nenhum chamado aberto.</div>';
  $('#adminReportsList').innerHTML = data.rideReports?.length ? data.rideReports.map(reportItem).join('') : '<div class="empty">Nenhuma denúncia registrada.</div>';
  $('#exportLink').onclick = async e => {
    e.preventDefault();
    try {
      const response = await fetch(apiUrl('/api/admin/export'), { headers: { Authorization: `Bearer ${state.token}` } });
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pardogo-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast(error.message, 'error');
    }
  };
  await loadSystemChecklist();
}

async function loadSystemChecklist() {
  const box = $('#systemChecklist');
  if (!box || !state.user || state.user.role !== 'admin') return;
  try {
    const data = await api('/api/admin/system');
    const system = data.system;
    const warnings = system.productionWarnings?.length
      ? system.productionWarnings.map(w => `<li class="warn-text">${w}</li>`).join('')
      : '<li class="ok-text">Nenhum alerta crítico para o ambiente atual.</li>';
    const items = system.checklist.map(item => `<li>${item}</li>`).join('');
    box.className = 'production-checklist';
    box.innerHTML = `
      <strong>Status do sistema</strong>
      <small>Versão ${system.version} • ${system.environment} • Node ${system.node}</small>
      <small>Banco: ${system.database.type} ${system.database.exists ? 'ativo' : 'não encontrado'}</small>
      <small>HTTPS forçado: ${system.security.forceHttps ? 'sim' : 'não'} • Limite: ${system.security.rateLimitMax}/min</small>
      <ul>${warnings}${items}</ul>
    `;
  } catch (error) {
    box.className = 'production-checklist empty';
    box.textContent = `Não foi possível carregar o checklist: ${error.message}`;
  }
}

function renderMetrics(stats) {
  const metrics = [
    ['Passageiros', stats.passengers],
    ['Motoristas online', stats.driversOnline],
    ['Pendentes', stats.driversPending],
    ['Corridas finalizadas', stats.ridesFinished],
    ['Faturamento corridas', money(stats.totalRevenue)],
    ['Comissão estimada', money(stats.estimatedPlatformCommission)],
    ['Corridas pendentes', stats.ridesPending],
    ['Corridas aceitas', stats.ridesAccepted],
    ['Corridas canceladas', stats.ridesCancelled],
    ['Contatos registrados', stats.contactsLogged],
    ['Avaliações recebidas', stats.ratingsCount],
    ['Média das avaliações', stats.averageRating ? `${stats.averageRating}/5` : 'Sem notas'],
    ['Motoristas em atenção', stats.lowRatedDrivers],
    ['Chamados abertos', stats.supportOpen],
    ['Denúncias abertas', stats.reportsOpen],
    ['Docs pendentes', stats.driverDocsPending]
  ];
  $('#adminMetrics').innerHTML = metrics.map(([label, value]) => `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`).join('');
}

function driverItem(driver) {
  const actions = [
    `<button class="small ok" data-driver-status="approved" data-driver-id="${driver.id}">Aprovar</button>`,
    `<button class="small" data-driver-status="pending" data-driver-id="${driver.id}">Pendente</button>`,
    `<button class="small bad" data-driver-status="blocked" data-driver-id="${driver.id}">Bloquear</button>`
  ].join('');
  const docLabels = { not_sent: 'Documentos não enviados', pending_review: 'Documentos em análise', verified: 'Documentos verificados', rejected: 'Documentos recusados' };
  const docClass = driver.documentStatus === 'verified' ? 'ok' : driver.documentStatus === 'rejected' ? 'bad' : 'warn';
  const docActions = [
    `<button class="small ok" data-doc-status="verified" data-driver-id="${driver.id}">Docs OK</button>`,
    `<button class="small" data-doc-status="pending_review" data-driver-id="${driver.id}">Em análise</button>`,
    `<button class="small bad" data-doc-status="rejected" data-driver-id="${driver.id}">Recusar docs</button>`
  ].join('');
  const lastLocation = driver.lastLocation ? `<small>GPS: ${coordFmt(driver.lastLocation.lat)}, ${coordFmt(driver.lastLocation.lng)}</small><br>` : '';
  const rating = driver.reviewsCount ? `<small>Avaliação média: ${driver.averageRating}/5 em ${driver.reviewsCount} corrida(s)</small><br>` : '<small>Ainda sem avaliações</small><br>';
  const docs = `<small>CNH: ${driver.cnhNumber || '-'} • Modelo: ${driver.vehicleModel || '-'} • Cor: ${driver.vehicleColor || '-'}</small><br><span class="badge ${docClass}">${docLabels[driver.documentStatus] || 'Documentos'}</span>${driver.documentsNote ? `<small class="docs-note">Obs. docs: ${driver.documentsNote}</small>` : ''}`;
  return `
    <div class="item">
      <header>
        <div>
          <strong>${driver.name}</strong>
          <small>${driver.phone} • ${driver.vehicle || '-'} • ${driver.plate || '-'}</small><br>
          ${docs}<br>
          ${lastLocation}
          ${rating}
          <small>${driver.online ? 'Online' : 'Offline'} • Cadastro: ${dateFmt(driver.createdAt)}</small>
        </div>
        ${statusBadge(driver.status)}
      </header>
      <div class="item-actions">${actions}${docActions}</div>
    </div>
  `;
}

function passengerItem(passenger) {
  return `
    <div class="item">
      <header>
        <div>
          <strong>${passenger.name}</strong>
          <small>${passenger.phone}</small><br>
          <small>Saldo: ${money(passenger.walletBalance || 0)}</small><br>
          <small>Cadastro: ${dateFmt(passenger.createdAt)}</small>
        </div>
        ${statusBadge(passenger.status)}
      </header>
    </div>
  `;
}

function supportItem(ticket) {
  return `
    <div class="item">
      <header>
        <div>
          <strong>${ticket.subject}</strong>
          <small>${ticket.category} • ${dateFmt(ticket.createdAt)} • ${roleLabel(ticket.role)}</small>
        </div>
        ${statusBadge(ticket.status)}
      </header>
      <p>${ticket.message}</p>
      ${ticket.adminNote ? `<small>Admin: ${ticket.adminNote}</small>` : ''}
    </div>
  `;
}

function reportItem(report) {
  return `
    <div class="item">
      <header>
        <div>
          <strong>${report.category}</strong>
          <small>Relatado: ${roleLabel(report.reportedRole)} • ${report.rideId ? `Corrida ${report.rideId} • ` : ''}${dateFmt(report.createdAt)}</small>
        </div>
        ${statusBadge(report.status)}
      </header>
      <p>${report.description}</p>
      ${report.adminNote ? `<small>Admin: ${report.adminNote}</small>` : ''}
    </div>
  `;
}

async function loadSecurityData() {
  if (!state.user) return;
  const [support, reports] = await Promise.all([
    api('/api/support/tickets'),
    api('/api/reports')
  ]);
  if ($('#supportList')) $('#supportList').innerHTML = support.tickets.length ? support.tickets.map(supportItem).join('') : '<div class="empty">Nenhum chamado aberto.</div>';
  if ($('#reportsList')) $('#reportsList').innerHTML = reports.reports.length ? reports.reports.map(reportItem).join('') : '<div class="empty">Nenhuma denúncia registrada.</div>';
}

async function refreshActiveArea() {
  if (!state.user) return;
  try {
    if (state.user.role === 'passenger') await loadPassengerRides();
    if (state.user.role === 'driver') await loadDriverRides();
    await loadSecurityData().catch(() => {});
    if (state.user.role === 'admin') {
      await loadPassengerRides().catch(() => {});
      await loadAdminDashboard();
    }
  } catch (error) {
    console.warn(error);
  }
}


function renderApiBaseStatus() {
  const input = $('#apiBaseInput');
  const status = $('#apiBaseStatus');
  if (input) input.value = normalizedApiBase();
  if (status) {
    status.textContent = `Modo atual: ${apiModeLabel()}.`;
    status.className = `form-status ${normalizedApiBase() ? 'ok' : 'muted'}`;
  }
}

function wireAddressAutocomplete() {
  const form = $('#rideForm');
  if (!form) return;
  const originInput = form.elements.origin;
  const destinationInput = form.elements.destination;
  originInput?.addEventListener('input', () => requestAddressSuggestions('origin', originInput.value));
  destinationInput?.addEventListener('input', () => requestAddressSuggestions('destination', destinationInput.value));
  originInput?.addEventListener('change', () => { applyKnownSuggestion('origin'); });
  destinationInput?.addEventListener('change', () => { applyKnownSuggestion('destination'); });
  originInput?.addEventListener('blur', () => { applyKnownSuggestion('origin'); });
  destinationInput?.addEventListener('blur', () => { applyKnownSuggestion('destination'); });
}

function setApiBaseUrl(value) {
  const url = String(value || '').trim().replace(/\/$/, '');
  if (url && !/^https?:\/\//i.test(url)) {
    throw new Error('Informe uma URL começando com http:// ou https://.');
  }
  state.apiBaseUrl = url;
  if (url) localStorage.setItem('pardogo_api_base', url);
  else localStorage.removeItem('pardogo_api_base');
  renderApiBaseStatus();
  disconnectRealtime();
  if (state.token) connectRealtime();
}

function wireEvents() {
  renderApiBaseStatus();
  wireAddressAutocomplete();

  wirePhoneInput('#loginForm input[name="phone"]', true);
  wirePhoneInput('#registerForm input[name="phone"]', false);

  $('#apiBaseForm')?.addEventListener('submit', event => {
    event.preventDefault();
    try {
      setApiBaseUrl(event.currentTarget.elements.apiBaseUrl.value);
      toast(`Configuração salva: ${apiModeLabel()}.`, 'ok');
    } catch (error) {
      toast(error.message, 'error');
      renderApiBaseStatus();
    }
  });

  $('#clearApiBaseBtn')?.addEventListener('click', () => {
    setApiBaseUrl('');
    toast('App configurado para usar API local/mesmo domínio.', 'ok');
  });

  $('#approveAllDriversBtn')?.addEventListener('click', async () => {
    if (!state.user || state.user.role !== 'admin') {
      toast('Apenas admin pode aprovar motoristas.', 'error');
      return;
    }
    const confirmed = confirm('Aprovar todos os motoristas pendentes agora?');
    if (!confirmed) return;
    try {
      const data = await api('/api/admin/drivers/approve-pending', { method: 'PATCH' });
      toast(`${data.updated || 0} motorista(s) aprovado(s).`, 'ok');
      await loadAdminDashboard();
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  $('#registerRole')?.addEventListener('change', event => switchRegisterRole(event.target.value));
  $('#openRegisterBtn')?.addEventListener('click', showRegisterPanel);
  $('#backToLoginBtn')?.addEventListener('click', showLoginPanel);
  document.body.addEventListener('click', event => {
    if (event.target?.id === 'openRegisterBtn') showRegisterPanel();
    if (event.target?.id === 'backToLoginBtn') showLoginPanel();
  });

  $$('[data-toggle-password]').forEach(button => {
    button.addEventListener('click', () => {
      const form = $(`#${button.dataset.togglePassword}`);
      const input = form?.elements?.password;
      if (!input) return;
      const visible = input.type === 'text';
      input.type = visible ? 'password' : 'text';
      button.textContent = visible ? 'Mostrar' : 'Ocultar';
    });
  });

  $('#goToAreaBtn')?.addEventListener('click', () => activateTab(targetAreaForCurrentUser()));
  $('#logoutInlineBtn')?.addEventListener('click', () => doLogout());

  $('#useLocationBtn').addEventListener('click', capturePassengerLocation);
  $('#driverLocationBtn').addEventListener('click', updateDriverLocation);
  $('#lookupOriginBtn').addEventListener('click', async () => {
    try { await geocodeField('origin'); } catch (error) { toast(error.message, 'error'); }
  });
  $('#lookupDestinationBtn').addEventListener('click', async () => {
    try { await geocodeField('destination'); } catch (error) { toast(error.message, 'error'); }
  });
  $('#calculateRouteBtn').addEventListener('click', async () => {
    try { await calculateRoute(); await estimateFare(); } catch (error) { toast(error.message, 'error'); }
  });

  $('#loginForm').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const body = Object.fromEntries(new FormData(form).entries());
    setFormBusy(form, true);
    try {
      body.phone = normalizePhoneField(body.phone);
      body.password = String(body.password || '').trim();
      if (!body.phone) throw new Error('Informe seu telefone ou usuário.');
      if (!body.password) throw new Error('Informe sua senha.');
      const data = await api('/api/auth/login', { method: 'POST', body: JSON.stringify(body) });
      if (!isValidUserPayload(data.user)) {
        throw new Error('Não foi possível concluir o login. Confira a URL da API na aba App.');
      }
      saveSession(data.token, data.user);
      setFormStatus('#loginStatus', data.message || `Login realizado. Perfil: ${roleLabel(data.user.role)}.`, 'ok');
      toast(data.message || 'Login realizado com sucesso.', 'ok');
      activateTab(targetAreaForCurrentUser());
    } catch (error) {
      setFormStatus('#loginStatus', error.message, 'error');
      toast(error.message, 'error');
    } finally {
      setFormBusy(form, false);
    }
  });

  $('#registerForm').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const body = Object.fromEntries(new FormData(form).entries());
    setFormBusy(form, true);
    try {
      body.phone = normalizePhoneField(body.phone);
      body.name = sanitizeText(body.name);
      body.password = String(body.password || '').trim();
      body.vehicle = sanitizeText(body.vehicle);
      body.plate = sanitizeText(body.plate).toUpperCase().replace(/\s+/g, '');
      body.cnhNumber = sanitizeText(body.cnhNumber);
      body.vehicleModel = sanitizeText(body.vehicleModel);
      body.vehicleColor = sanitizeText(body.vehicleColor);
      if (!body.name || body.name.length < 2) throw new Error('Informe seu nome.');
      if (!body.phone) throw new Error('Informe seu telefone com DDD.');
      if (!body.password || !isStrongPassword(body.password)) {
        throw new Error('A senha precisa ter no mínimo 6 caracteres, 1 letra maiúscula e 1 caractere especial.');
      }
      if (body.role === 'driver' && (!body.vehicle || !body.plate)) {
        throw new Error('Para motorista, informe veículo e placa.');
      }
      const data = await api('/api/auth/register', { method: 'POST', body: JSON.stringify(body) });
      toast(data.message, 'ok');
      setFormStatus('#registerStatus', data.message, 'ok');
      const loginForm = $('#loginForm');
      if (loginForm?.elements?.phone) loginForm.elements.phone.value = body.phone || '';
      form.reset();
      switchRegisterRole('passenger');
      showLoginPanel();
      setFormStatus('#loginStatus', 'Cadastro criado. Digite sua senha e entre no sistema.', 'ok');
    } catch (error) {
      setFormStatus('#registerStatus', error.message, 'error');
      toast(error.message, 'error');
    } finally {
      setFormBusy(form, false);
    }
  });

  $('#logoutBtn').addEventListener('click', () => doLogout());

  $('#estimateBtn').addEventListener('click', async () => {
    try { await estimateFare(); } catch (error) { toast(error.message, 'error'); }
  });

  ['origin', 'destination', 'distanceKm', 'minutes'].forEach(name => {
    const field = $('#rideForm').elements[name];
    if (!field) return;
    field.addEventListener('input', () => {
      if (name === 'origin') clearRideCoords('origin');
      if (name === 'destination') clearRideCoords('destination');
      renderRouteMap();
    });
  });

  $('#rideForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (!state.user || !['passenger', 'admin'].includes(state.user.role)) return toast('Entre como passageiro para pedir corrida.', 'error');
    try {
      const form = event.currentTarget;
      let { origin, destination } = getRideFormCoords();
      if (!origin) await resolveRideFieldByGeocode('origin');
      if (!destination) await resolveRideFieldByGeocode('destination');
      ({ origin, destination } = getRideFormCoords());
      if (!origin || !destination) {
        throw new Error('Defina origem e destino válidos no mapa antes de solicitar a corrida.');
      }
      await calculateRoute();
      await estimateFare();
      const body = Object.fromEntries(new FormData(form).entries());
      body.distanceKm = Number(body.distanceKm || 0);
      body.minutes = Number(body.minutes || 0);
      body.originLat = body.originLat ? Number(body.originLat) : null;
      body.originLng = body.originLng ? Number(body.originLng) : null;
      body.destinationLat = body.destinationLat ? Number(body.destinationLat) : null;
      body.destinationLng = body.destinationLng ? Number(body.destinationLng) : null;
      body.routeSource = state.currentRoute?.source || 'manual';
      body.routeGeometry = state.currentRoute?.geometry || null;
      body.useRoute = Boolean(origin && destination);
      const data = await api('/api/rides', { method: 'POST', body: JSON.stringify(body) });
      toast(`${data.message} Valor: ${money(data.ride.fare)}`, 'ok');
      if (body.paymentMethod === 'Saldo do app') {
        await loadWallet().catch(() => {});
      }
      await refreshActiveArea();
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  $('#walletTopupForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    if (!state.user || !['passenger', 'admin'].includes(state.user.role)) return toast('Entre como passageiro para recarregar saldo.', 'error');
    const form = event.currentTarget;
    const body = Object.fromEntries(new FormData(form).entries());
    setFormBusy(form, true);
    try {
      body.amount = Number(body.amount || 0);
      const data = await api('/api/wallet/topup', { method: 'POST', body: JSON.stringify(body) });
      state.user.walletBalance = Number(data.balance || 0);
      localStorage.setItem('pardogo_user', JSON.stringify(state.user));
      renderWalletBalance();
      setFormStatus('#walletStatus', data.message || 'Recarga concluída.', 'ok');
      toast('Crédito adicionado com sucesso.', 'ok');
      form.reset();
      form.elements.amount.value = '20';
    } catch (error) {
      setFormStatus('#walletStatus', error.message, 'error');
      toast(error.message, 'error');
    } finally {
      setFormBusy(form, false);
    }
  });

  $('#toggleOnlineBtn').addEventListener('click', async () => {
    if (!state.user || state.user.role !== 'driver') return toast('Entre como motorista.', 'error');
    try {
      const data = await api('/api/driver/status', { method: 'PATCH', body: JSON.stringify({ online: !state.driverOnline }) });
      state.user = data.user;
      state.driverOnline = data.user.online;
      localStorage.setItem('pardogo_user', JSON.stringify(data.user));
      await loadDriverRides();
      toast(state.driverOnline ? 'Motorista online.' : 'Motorista offline.', 'ok');
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  $('#supportForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    if (!state.user) return toast('Entre no sistema para abrir chamado.', 'error');
    try {
      const body = Object.fromEntries(new FormData(event.currentTarget).entries());
      await api('/api/support/tickets', { method: 'POST', body: JSON.stringify(body) });
      event.currentTarget.reset();
      await loadSecurityData();
      toast('Chamado enviado para o suporte.', 'ok');
    } catch (error) { toast(error.message, 'error'); }
  });

  $('#reportForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    if (!state.user) return toast('Entre no sistema para enviar denúncia.', 'error');
    try {
      const body = Object.fromEntries(new FormData(event.currentTarget).entries());
      await api('/api/reports', { method: 'POST', body: JSON.stringify(body) });
      event.currentTarget.reset();
      await loadSecurityData();
      toast('Denúncia registrada para análise.', 'ok');
    } catch (error) { toast(error.message, 'error'); }
  });

  $('#tariffForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (!state.user || state.user.role !== 'admin') return toast('Apenas admin pode alterar tarifas.', 'error');
    try {
      const body = Object.fromEntries(new FormData(event.currentTarget).entries());
      const data = await api('/api/admin/tariff', { method: 'PATCH', body: JSON.stringify(body) });
      state.tariffRules = data.tariffRules;
      await loadConfig();
      await loadAdminDashboard();
      toast('Tarifas atualizadas.', 'ok');
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  document.body.addEventListener('click', async event => {
    const tab = event.target.closest('.tab');
    if (tab) {
      activateTab(tab.dataset.target);
      return;
    }

    const accept = event.target.closest('[data-accept]');
    if (accept) {
      try {
        await api(`/api/rides/${accept.dataset.accept}/accept`, { method: 'PATCH' });
        toast('Corrida aceita.', 'ok');
        await loadDriverRides();
      } catch (error) { toast(error.message, 'error'); }
      return;
    }

    const driverMap = event.target.closest('[data-driver-map]');
    if (driverMap) {
      state.selectedDriverRideId = driverMap.dataset.driverMap;
      renderDriverRideMap();
      return;
    }

    const finish = event.target.closest('[data-finish]');
    if (finish) {
      try {
        await api(`/api/rides/${finish.dataset.finish}/finish`, { method: 'PATCH' });
        toast('Corrida finalizada.', 'ok');
        await loadDriverRides();
      } catch (error) { toast(error.message, 'error'); }
      return;
    }

    const adminFinish = event.target.closest('[data-admin-finish]');
    if (adminFinish) {
      try {
        await api(`/api/rides/${adminFinish.dataset.adminFinish}/finish`, { method: 'PATCH' });
        toast('Corrida finalizada pelo admin.', 'ok');
        await loadAdminDashboard();
      } catch (error) { toast(error.message, 'error'); }
      return;
    }



    const cancel = event.target.closest('[data-cancel]');
    if (cancel) {
      const reason = prompt('Informe o motivo do cancelamento:', 'Solicitado pelo usuário');
      if (reason === null) return;
      try {
        await api(`/api/rides/${cancel.dataset.cancel}/cancel`, { method: 'PATCH', body: JSON.stringify({ reason }) });
        toast('Corrida cancelada.', 'ok');
        await refreshActiveArea();
      } catch (error) { toast(error.message, 'error'); }
      return;
    }

    const contact = event.target.closest('[data-contact]');
    if (contact) {
      try {
        const data = await api(`/api/rides/${contact.dataset.contact}/contact`, {
          method: 'POST',
          body: JSON.stringify({ target: contact.dataset.target, channel: contact.dataset.channel })
        });
        const url = contact.dataset.channel === 'call' ? data.telUrl : data.whatsappUrl;
        if (url) window.open(url, '_blank');
        toast(contact.dataset.channel === 'call' ? 'Ligação aberta.' : 'WhatsApp aberto.', 'ok');
        await refreshActiveArea();
      } catch (error) { toast(error.message, 'error'); }
      return;
    }

    const rate = event.target.closest('[data-rate]');
    if (rate) {
      const value = prompt('Qual nota para o motorista? Digite de 1 a 5:', '5');
      if (value === null) return;
      const rating = Number(value);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        toast('A nota precisa ser um número inteiro de 1 a 5.', 'error');
        return;
      }
      const comment = prompt('Deixe um comentário opcional sobre a corrida:', '') || '';
      try {
        await api(`/api/rides/${rate.dataset.rate}/rating`, {
          method: 'POST',
          body: JSON.stringify({ rating, comment })
        });
        toast('Avaliação registrada com sucesso.', 'ok');
        await refreshActiveArea();
      } catch (error) { toast(error.message, 'error'); }
      return;
    }

    const docStatus = event.target.closest('[data-doc-status]');
    if (docStatus) {
      try {
        const note = docStatus.dataset.docStatus === 'rejected' ? (prompt('Motivo da recusa documental:', 'Documento ilegível ou pendente') || '') : '';
        await api(`/api/admin/drivers/${docStatus.dataset.driverId}/documents`, {
          method: 'PATCH',
          body: JSON.stringify({ documentStatus: docStatus.dataset.docStatus, documentsNote: note })
        });
        toast('Status documental atualizado.', 'ok');
        await loadAdminDashboard();
      } catch (error) { toast(error.message, 'error'); }
      return;
    }

    const driverStatus = event.target.closest('[data-driver-status]');
    if (driverStatus) {
      try {
        await api(`/api/admin/drivers/${driverStatus.dataset.driverId}/status`, {
          method: 'PATCH',
          body: JSON.stringify({ status: driverStatus.dataset.driverStatus })
        });
        toast('Status do motorista atualizado.', 'ok');
        await loadAdminDashboard();
      } catch (error) { toast(error.message, 'error'); }
    }
  });
}

async function boot() {
  wireEvents();
  initGoogleAuth();
  try {
    await loadMapDefaults();
    await loadConfig();
    await loadLegalContent();
    initMap();
    initDriverMap();
    if (state.token) {
      const me = await api('/api/me');
      state.user = me.user;
      state.driverOnline = Boolean(me.user.online);
      localStorage.setItem('pardogo_user', JSON.stringify(me.user));
    }
  } catch (error) {
    if (state.token) clearSession();
    console.warn(error);
  }
  renderSession();
  const intent = routeIntent();
  if (!state.user && intent.view === 'register') showRegisterPanel();
  if (!state.user && intent.view === 'login') showLoginPanel();
  if (state.user) activateTab(targetAreaForCurrentUser());
  if (state.token) connectRealtime();
  renderRouteMap();
  estimateFare().catch(() => {});
  updateMobilePermissionsStatus().catch(() => {});
}

boot();
