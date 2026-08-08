const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const DB = path.join(ROOT, 'data', 'pardogo-test.sqlite');
const PORT = 5199;
const BASE = `http://localhost:${PORT}`;
const ADMIN_PHONE = '67990000001';
const ADMIN_PASSWORD = 'Admin#PardoGo123';

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function request(pathname, options = {}) {
  const response = await fetch(`${BASE}${pathname}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${pathname}: ${data.error || response.statusText}`);
  }
  return data;
}

async function requestRaw(pathname, options = {}) {
  const response = await fetch(`${BASE}${pathname}`, {
    ...options,
    headers: {
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}


async function openSse(token) {
  const ticketResp = await request('/api/events-ticket', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({})
  });
  const ticket = String(ticketResp.ticket || '').trim();
  if (!ticket) throw new Error('Ticket SSE não retornado pela API.');

  const events = [];
  const listeners = [];
  const req = http.get(`${BASE}/api/events?ticket=${encodeURIComponent(ticket)}`, {
    headers: { Accept: 'text/event-stream' }
  });
  let closed = false;
  let buffer = '';

  req.on('error', error => {
    if (error.code === 'ECONNRESET' || error.code === 'ERR_STREAM_PREMATURE_CLOSE') return;
    if (closed) return;
    throw error;
  });

  req.on('response', response => {
    response.setEncoding('utf8');
    response.on('data', chunk => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        const eventLine = block.split('\n').find(line => line.startsWith('event: '));
        const dataLine = block.split('\n').find(line => line.startsWith('data: '));
        if (!eventLine || !dataLine) continue;
        const eventName = eventLine.slice(7).trim();
        let data = {};
        try { data = JSON.parse(dataLine.slice(6)); } catch {}
        const item = { eventName, data };
        events.push(item);
        for (const listener of [...listeners]) listener(item);
      }
    });
  });

  return {
    waitFor(eventName, predicate = () => true, timeoutMs = 6000) {
      const existing = events.find(item => item.eventName === eventName && predicate(item.data));
      if (existing) return Promise.resolve(existing.data);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const idx = listeners.indexOf(listener);
          if (idx >= 0) listeners.splice(idx, 1);
          reject(new Error(`Evento SSE não recebido: ${eventName}`));
        }, timeoutMs);
        function listener(item) {
          if (item.eventName !== eventName || !predicate(item.data)) return;
          clearTimeout(timer);
          const idx = listeners.indexOf(listener);
          if (idx >= 0) listeners.splice(idx, 1);
          resolve(item.data);
        }
        listeners.push(listener);
      });
    },
    close() {
      closed = true;
      req.destroy();
    }
  };
}

async function run() {
  for (const suffix of ['', '-shm', '-wal']) {
    const file = `${DB}${suffix}`;
    if (fs.existsSync(file)) fs.rmSync(file, { force: true });
  }

  const server = spawn(process.execPath, ['--no-warnings', 'server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      DB_PATH: DB,
      NODE_ENV: 'development',
      ADMIN_INITIAL_PHONE: ADMIN_PHONE,
      ADMIN_INITIAL_PASSWORD: ADMIN_PASSWORD,
      APP_BASE_URL: 'https://pardogo-8yn0.onrender.com',
      CANONICAL_BASE_URL: 'https://pardogo-8yn0.onrender.com',
      CORS_ORIGIN: 'https://pardogo-8yn0.onrender.com,https://localhost'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let ready = false;
  server.stdout.on('data', data => {
    if (String(data).includes('PardoGo Etapa 14')) ready = true;
  });
  server.stderr.on('data', data => process.stderr.write(data));

  for (let i = 0; i < 40 && !ready; i++) await wait(150);
  if (!ready) throw new Error('Servidor não iniciou no tempo esperado.');

  try {
    const testPassword = 'Senha@1';

    const health = await request('/api/health');
    if (!health.ok || health.version !== '1.4.0') throw new Error('Health check falhou.');
    if (!Object.prototype.hasOwnProperty.call(health, 'renderCommit')) throw new Error('Health não expôs campo renderCommit.');
    if (!Object.prototype.hasOwnProperty.call(health, 'renderBranch')) throw new Error('Health não expôs campo renderBranch.');
    if (!Object.prototype.hasOwnProperty.call(health, 'renderRepo')) throw new Error('Health não expôs campo renderRepo.');

    const webhookDisabled = await requestRaw('/api/webhooks/pix/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ txid: 'pix-disabled-test', status: 'approved' })
    });
    if (webhookDisabled.response.status !== 404) {
      throw new Error('Webhook PIX desabilitado deveria retornar 404.');
    }

    const optionsLogin = await fetch(`${BASE}/api/auth/login`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://localhost',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type,authorization'
      }
    });
    if (optionsLogin.status !== 204) throw new Error('Preflight OPTIONS de /api/auth/login não retornou 204.');
    if (optionsLogin.headers.get('access-control-allow-origin') !== 'https://localhost') throw new Error('CORS não aceitou origem https://localhost no preflight.');
    if (!String(optionsLogin.headers.get('access-control-allow-methods') || '').includes('OPTIONS')) throw new Error('Allow-Methods não incluiu OPTIONS.');
    if (!String(optionsLogin.headers.get('access-control-allow-headers') || '').toLowerCase().includes('authorization')) throw new Error('Allow-Headers não incluiu Authorization.');

    const corsLocal = await requestRaw('/api/health', {
      headers: {
        Origin: 'https://localhost',
        Accept: 'application/json'
      }
    });
    if (corsLocal.response.headers.get('access-control-allow-origin') !== 'https://localhost') {
      throw new Error('CORS não aceitou origem https://localhost em /api/health.');
    }

    const corsRender = await requestRaw('/api/health', {
      headers: {
        Origin: 'https://pardogo-8yn0.onrender.com',
        Accept: 'application/json'
      }
    });
    if (corsRender.response.headers.get('access-control-allow-origin') !== 'https://pardogo-8yn0.onrender.com') {
      throw new Error('CORS não aceitou origem https://pardogo-8yn0.onrender.com em /api/health.');
    }

    if (!health.features.includes('sqlite') || !health.features.includes('secure-sessions') || !health.features.includes('security-headers') || !health.features.includes('rate-limit') || !health.features.includes('production-healthcheck') || !health.features.includes('deploy-ready') || !health.features.includes('route-calculation') || !health.features.includes('realtime-sse') || !health.features.includes('ride-cancellation') || !health.features.includes('ride-contact') || !health.features.includes('ride-rating') || !health.features.includes('quality-dashboard') || !health.features.includes('support-tickets') || !health.features.includes('safety-reports') || !health.features.includes('driver-documents') || !health.features.includes('legal-lgpd')) {
      throw new Error('Features de SQLite/sessões/produção/rota/tempo real/cancelamento/contato não apareceram no health check.');
    }

    if (!fs.existsSync(DB)) throw new Error('Banco SQLite não foi criado.');

    await request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name: 'Passageira Teste', phone: '67911110000', password: testPassword, role: 'passenger', acceptTerms: true, acceptPrivacy: true })
    });

    const driverRegister = await request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name: 'Motorista Teste', phone: '67922220000', password: testPassword, role: 'driver', vehicle: 'Fiat Mobi', plate: 'ABC1D23', cnhNumber: '12345678900', vehicleModel: 'Mobi 2020', vehicleColor: 'Prata', acceptTerms: true, acceptPrivacy: true })
    });

    const adminLogin = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ phone: ADMIN_PHONE, password: ADMIN_PASSWORD })
    });
    if (!adminLogin.token || adminLogin.token.length < 30) throw new Error('Token seguro não foi emitido.');
    if (!adminLogin.expiresAt) throw new Error('Expiração da sessão não foi informada.');

    await request(`/api/admin/drivers/${driverRegister.user.id}/status`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminLogin.token}` },
      body: JSON.stringify({ status: 'approved' })
    });

    await request(`/api/admin/drivers/${driverRegister.user.id}/documents`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminLogin.token}` },
      body: JSON.stringify({ documentStatus: 'verified', documentsNote: 'Conferido no teste.' })
    });

    const driverLogin = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ phone: '67922220000', password: testPassword })
    });

    await request('/api/driver/status', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${driverLogin.token}` },
      body: JSON.stringify({ online: true })
    });

    const driverLocation = await request('/api/driver/location', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${driverLogin.token}` },
      body: JSON.stringify({ lat: -21.30, lng: -52.82, accuracy: 25 })
    });
    if (!driverLocation.user.lastLocation) throw new Error('Localização do motorista não foi salva.');

    const passengerLogin = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ phone: '67911110000', password: testPassword })
    });

    const walletBeforeTopup = await request('/api/wallet', {
      headers: { Authorization: `Bearer ${passengerLogin.token}` }
    });
    const topupCash = await request('/api/wallet/topup', {
      method: 'POST',
      headers: { Authorization: `Bearer ${passengerLogin.token}` },
      body: JSON.stringify({ amount: 80, method: 'Dinheiro' })
    });
    if (Number(topupCash.balance || 0) <= Number(walletBeforeTopup.balance || 0)) {
      throw new Error('Recarga em dinheiro não creditou saldo.');
    }

    const idempotencyKey = `ride-test-${Date.now()}`;
    const balanceBeforeSaldoRide = Number(topupCash.balance || 0);
    const saldoRideFirst = await request('/api/rides', {
      method: 'POST',
      headers: { Authorization: `Bearer ${passengerLogin.token}` },
      body: JSON.stringify({
        origin: 'Escola',
        destination: 'Praca Central',
        distanceKm: 1.8,
        minutes: 6,
        paymentMethod: 'Saldo do app',
        idempotencyKey,
        useRoute: false
      })
    });
    const walletAfterFirstSaldoRide = await request('/api/wallet', {
      headers: { Authorization: `Bearer ${passengerLogin.token}` }
    });

    const saldoRideRetry = await request('/api/rides', {
      method: 'POST',
      headers: { Authorization: `Bearer ${passengerLogin.token}` },
      body: JSON.stringify({
        origin: 'Escola',
        destination: 'Praca Central',
        distanceKm: 1.8,
        minutes: 6,
        paymentMethod: 'Saldo do app',
        idempotencyKey,
        useRoute: false
      })
    });
    const walletAfterRetrySaldoRide = await request('/api/wallet', {
      headers: { Authorization: `Bearer ${passengerLogin.token}` }
    });

    if (saldoRideFirst.ride.id !== saldoRideRetry.ride.id) {
      throw new Error('Idempotência de corrida não retornou a mesma corrida no retry.');
    }
    if (Number(walletAfterRetrySaldoRide.balance || 0) !== Number(walletAfterFirstSaldoRide.balance || 0)) {
      throw new Error('Retry idempotente debitou saldo novamente.');
    }
    if (Number(walletAfterFirstSaldoRide.balance || 0) >= balanceBeforeSaldoRide) {
      throw new Error('Corrida com Saldo do app não debitou carteira.');
    }

    const concurrentKey = `ride-concurrent-${Date.now()}`;
    const concurrentBody = {
      origin: 'Farmacia',
      destination: 'Rodoviaria',
      distanceKm: 2.1,
      minutes: 7,
      paymentMethod: 'Pix',
      idempotencyKey: concurrentKey,
      useRoute: false
    };
    const [concurrentA, concurrentB] = await Promise.all([
      request('/api/rides', {
        method: 'POST',
        headers: { Authorization: `Bearer ${passengerLogin.token}` },
        body: JSON.stringify(concurrentBody)
      }),
      request('/api/rides', {
        method: 'POST',
        headers: { Authorization: `Bearer ${passengerLogin.token}` },
        body: JSON.stringify(concurrentBody)
      })
    ]);
    if (concurrentA.ride.id !== concurrentB.ride.id) {
      throw new Error('Concorrência com mesma idempotencyKey criou corridas duplicadas.');
    }

    const insufficient = await requestRaw('/api/rides', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${passengerLogin.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        origin: 'Zona Rural',
        destination: 'Centro',
        distanceKm: 999,
        minutes: 999,
        paymentMethod: 'Saldo do app',
        idempotencyKey: `ride-insufficient-${Date.now()}`,
        useRoute: false
      })
    });
    if (insufficient.response.status !== 400 || !String(insufficient.data.error || '').includes('Saldo insuficiente')) {
      throw new Error('Saldo insuficiente deveria retornar 400 sem criar corrida.');
    }

    const driverStream = await openSse(driverLogin.token);
    const passengerStream = await openSse(passengerLogin.token);
    await driverStream.waitFor('connected');
    await passengerStream.waitFor('connected');

    const route = await request('/api/maps/route', {
      method: 'POST',
      body: JSON.stringify({ originLat: -21.3000, originLng: -52.8300, destinationLat: -21.3120, destinationLng: -52.8450 })
    });
    if (!route.distanceKm || route.minutes < 3) throw new Error('Cálculo de rota/distância falhou.');
    if (!['osrm', 'haversine-fallback'].includes(route.source)) throw new Error('Fonte da rota inválida.');

    const rideCreated = await request('/api/rides', {
      method: 'POST',
      headers: { Authorization: `Bearer ${passengerLogin.token}` },
      body: JSON.stringify({ origin: 'Centro', destination: 'Hospital', distanceKm: 2.5, minutes: 10, paymentMethod: 'Pix', originLat: -21.30, originLng: -52.83, destinationLat: -21.312, destinationLng: -52.845, useRoute: true })
    });

    const driverRideEvent = await driverStream.waitFor('ride-update', payload => payload.type === 'created' && payload.ride?.id === rideCreated.ride.id);
    if (!driverRideEvent.ride) throw new Error('Motorista não recebeu corrida em tempo real.');

    if (rideCreated.ride.fare < 12) throw new Error('Tarifa mínima não aplicada.');
    if (!rideCreated.ride.pickupCoords || !rideCreated.ride.destinationCoords) throw new Error('Coordenadas de origem/destino não foram salvas na corrida.');
    if (!rideCreated.ride.routeSource) throw new Error('Fonte da rota não foi salva na corrida.');

    await request(`/api/rides/${rideCreated.ride.id}/accept`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${driverLogin.token}` }
    });

    const passengerAcceptedEvent = await passengerStream.waitFor('ride-update', payload => payload.type === 'accepted' && payload.ride?.id === rideCreated.ride.id);
    if (passengerAcceptedEvent.ride.status !== 'accepted') throw new Error('Passageiro não recebeu aceite em tempo real.');

    await request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name: 'Motorista Dois', phone: '67933330000', password: testPassword, role: 'driver', vehicle: 'Onix', plate: 'QWE1R23', acceptTerms: true, acceptPrivacy: true })
    });
    await request('/api/admin/drivers/approve-pending', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminLogin.token}` },
      body: JSON.stringify({})
    });
    const driver2Login = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ phone: '67933330000', password: testPassword })
    });
    await request('/api/driver/status', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${driver2Login.token}` },
      body: JSON.stringify({ online: true })
    });

    const contestedRide = await request('/api/rides', {
      method: 'POST',
      headers: { Authorization: `Bearer ${passengerLogin.token}` },
      body: JSON.stringify({ origin: 'Posto', destination: 'Mercado', distanceKm: 2.3, minutes: 9, paymentMethod: 'Pix', useRoute: false })
    });

    const acceptRace = await Promise.allSettled([
      request(`/api/rides/${contestedRide.ride.id}/accept`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${driverLogin.token}` }
      }),
      request(`/api/rides/${contestedRide.ride.id}/accept`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${driver2Login.token}` }
      })
    ]);
    const acceptsOk = acceptRace.filter(item => item.status === 'fulfilled').length;
    const acceptsFail = acceptRace.filter(item => item.status === 'rejected').length;
    if (acceptsOk !== 1 || acceptsFail !== 1) {
      throw new Error('Dois motoristas aceitaram a mesma corrida simultaneamente.');
    }

    const passengerContactDriver = await request(`/api/rides/${rideCreated.ride.id}/contact`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${passengerLogin.token}` },
      body: JSON.stringify({ target: 'driver', channel: 'whatsapp' })
    });
    if (!passengerContactDriver.whatsappUrl || !passengerContactDriver.whatsappUrl.includes('wa.me')) throw new Error('Contato por WhatsApp com motorista falhou.');

    const driverContactPassenger = await request(`/api/rides/${rideCreated.ride.id}/contact`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${driverLogin.token}` },
      body: JSON.stringify({ target: 'passenger', channel: 'call' })
    });
    if (!driverContactPassenger.telUrl || !driverContactPassenger.telUrl.startsWith('tel:')) throw new Error('Contato por ligação com passageiro falhou.');

    await request(`/api/rides/${rideCreated.ride.id}/finish`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${driverLogin.token}` }
    });

    const passengerFinishedEvent = await passengerStream.waitFor('ride-update', payload => payload.type === 'finished' && payload.ride?.id === rideCreated.ride.id);
    if (passengerFinishedEvent.ride.status !== 'finished') throw new Error('Passageiro não recebeu finalização em tempo real.');

    const ratingResult = await request(`/api/rides/${rideCreated.ride.id}/rating`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${passengerLogin.token}` },
      body: JSON.stringify({ rating: 5, comment: 'Atendimento rápido e seguro.' })
    });
    if (!ratingResult.rating || ratingResult.rating.rating !== 5) throw new Error('Avaliação da corrida não foi salva.');
    const ratedEvent = await passengerStream.waitFor('ride-update', payload => payload.type === 'rated' && payload.ride?.id === rideCreated.ride.id);
    if (!ratedEvent.ride.rating || ratedEvent.ride.rating.rating !== 5) throw new Error('Avaliação não foi enviada em tempo real.');

    const rideToCancel = await request('/api/rides', {
      method: 'POST',
      headers: { Authorization: `Bearer ${passengerLogin.token}` },
      body: JSON.stringify({ origin: 'Mercado', destination: 'Casa', distanceKm: 1.5, minutes: 6, paymentMethod: 'Dinheiro' })
    });
    await driverStream.waitFor('ride-update', payload => payload.type === 'created' && payload.ride?.id === rideToCancel.ride.id);
    await request(`/api/rides/${rideToCancel.ride.id}/cancel`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${passengerLogin.token}` },
      body: JSON.stringify({ reason: 'Teste de cancelamento' })
    });
    const cancelRetry = await requestRaw(`/api/rides/${rideToCancel.ride.id}/cancel`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${passengerLogin.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ reason: 'Tentativa duplicada' })
    });
    if (![403, 409].includes(cancelRetry.response.status)) {
      throw new Error('Cancelamento duplicado deveria ser bloqueado com 403/409.');
    }
    const passengerCancelledEvent = await passengerStream.waitFor('ride-update', payload => payload.type === 'cancelled' && payload.ride?.id === rideToCancel.ride.id);
    if (passengerCancelledEvent.ride.status !== 'cancelled' || !passengerCancelledEvent.ride.cancelReason) throw new Error('Cancelamento não foi emitido/salvo.');

    const walletBeforeRefundRide = await request('/api/wallet', {
      headers: { Authorization: `Bearer ${passengerLogin.token}` }
    });
    const refundableRide = await request('/api/rides', {
      method: 'POST',
      headers: { Authorization: `Bearer ${passengerLogin.token}` },
      body: JSON.stringify({
        origin: 'Padaria',
        destination: 'Igreja',
        distanceKm: 1.3,
        minutes: 5,
        paymentMethod: 'Saldo do app',
        idempotencyKey: `ride-refund-${Date.now()}`,
        useRoute: false
      })
    });
    const walletAfterRefundableCreate = await request('/api/wallet', {
      headers: { Authorization: `Bearer ${passengerLogin.token}` }
    });
    if (Number(walletAfterRefundableCreate.balance || 0) >= Number(walletBeforeRefundRide.balance || 0)) {
      throw new Error('Corrida de estorno não debitou saldo antes do cancelamento.');
    }
    await request(`/api/rides/${refundableRide.ride.id}/cancel`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${passengerLogin.token}` },
      body: JSON.stringify({ reason: 'Cancelar para estorno de teste' })
    });
    const walletAfterRefund = await request('/api/wallet', {
      headers: { Authorization: `Bearer ${passengerLogin.token}` }
    });
    if (Number(walletAfterRefund.balance || 0) !== Number(walletBeforeRefundRide.balance || 0)) {
      throw new Error('Estorno de corrida cancelada não devolveu saldo corretamente.');
    }

    const legal = await request('/api/legal');
    if (!legal.legal?.terms?.items?.length || !legal.legal?.privacy?.items?.length) throw new Error('Conteúdo legal não foi retornado.');

    const support = await request('/api/support/tickets', {
      method: 'POST',
      headers: { Authorization: `Bearer ${passengerLogin.token}` },
      body: JSON.stringify({ subject: 'Ajuda no teste', category: 'corrida', message: 'Chamado de teste da etapa 11.' })
    });
    if (!support.ticket || support.ticket.status !== 'open') throw new Error('Chamado de suporte não foi criado.');

    const report = await request('/api/reports', {
      method: 'POST',
      headers: { Authorization: `Bearer ${passengerLogin.token}` },
      body: JSON.stringify({ rideId: rideCreated.ride.id, reportedRole: 'driver', category: 'seguranca', description: 'Denúncia de teste da etapa 11.' })
    });
    if (!report.report || report.report.status !== 'open') throw new Error('Denúncia não foi registrada.');

    driverStream.close();
    passengerStream.close();

    const walletBeforePixConfirm = await request('/api/wallet', {
      headers: { Authorization: `Bearer ${passengerLogin.token}` }
    });
    const pixTopup = await request('/api/wallet/topup', {
      method: 'POST',
      headers: { Authorization: `Bearer ${passengerLogin.token}` },
      body: JSON.stringify({ amount: 15, method: 'Pix' })
    });
    if (!pixTopup.pendingPix?.id) throw new Error('Recarga PIX pendente não foi criada.');
    await request(`/api/admin/wallet/pix/${pixTopup.pendingPix.id}/confirm`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminLogin.token}` },
      body: JSON.stringify({ approve: true, note: 'confirmacao teste' })
    });
    await request(`/api/admin/wallet/pix/${pixTopup.pendingPix.id}/confirm`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminLogin.token}` },
      body: JSON.stringify({ approve: true, note: 'confirmacao duplicada' })
    });
    const walletAfterPixConfirm = await request('/api/wallet', {
      headers: { Authorization: `Bearer ${passengerLogin.token}` }
    });
    const expectedAfterPix = Number((Number(walletBeforePixConfirm.balance || 0) + 15).toFixed(2));
    if (Number(walletAfterPixConfirm.balance || 0) !== expectedAfterPix) {
      throw new Error('Confirmação PIX duplicada alterou saldo de forma incorreta.');
    }

    const dashboard = await request('/api/admin/dashboard', {
      headers: { Authorization: `Bearer ${adminLogin.token}` }
    });

    if (dashboard.database.type !== 'SQLite') throw new Error('Painel não informou SQLite.');
    if (dashboard.stats.ridesFinished < 1) throw new Error('Corrida finalizada não apareceu no painel.');
    if (dashboard.stats.ridesCancelled < 1) throw new Error('Corrida cancelada não apareceu no painel.');
    if (dashboard.stats.contactsLogged < 2) throw new Error('Contatos não apareceram nas métricas.');
    if (dashboard.stats.ratingsCount < 1) throw new Error('Avaliação não apareceu nas métricas.');
    if (dashboard.stats.averageRating !== 5) throw new Error('Média de avaliação incorreta no painel.');
    const dashboardDriver = dashboard.users.find(user => user.id === driverRegister.user.id);
    if (!dashboardDriver || dashboardDriver.averageRating !== 5 || dashboardDriver.reviewsCount !== 1) throw new Error('Média do motorista não apareceu no painel.');
    if (dashboard.stats.driversApproved < 1) throw new Error('Motorista aprovado não apareceu no painel.');
    if (dashboard.stats.supportOpen < 1) throw new Error('Chamado aberto não apareceu nas métricas.');
    if (dashboard.stats.reportsOpen < 1) throw new Error('Denúncia aberta não apareceu nas métricas.');
    if (!dashboard.supportTickets?.length || !dashboard.rideReports?.length) throw new Error('Chamados/denúncias não apareceram no dashboard.');
    const dashboardDriverDocs = dashboard.users.find(user => user.id === driverRegister.user.id);
    if (!dashboardDriverDocs || dashboardDriverDocs.documentStatus !== 'verified') throw new Error('Status documental do motorista não apareceu no painel.');

    const system = await request('/api/admin/system', {
      headers: { Authorization: `Bearer ${adminLogin.token}` }
    });
    if (!system.system || system.system.version !== '1.4.0' || !system.system.security) throw new Error('Checklist de produção não foi retornado.');

    const audit = await request('/api/admin/audit', {
      headers: { Authorization: `Bearer ${adminLogin.token}` }
    });
    if (!Array.isArray(audit.logs) || audit.logs.length === 0) throw new Error('Auditoria não registrou eventos.');

    await request('/api/auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${passengerLogin.token}` }
    });

    const denied = await fetch(`${BASE}/api/me`, {
      headers: { Authorization: `Bearer ${passengerLogin.token}` }
    });
    if (denied.status !== 401) throw new Error('Logout não revogou a sessão.');

    const wrongLogin = await requestRaw('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '67911110000', password: 'senha-invalida' })
    });
    if (wrongLogin.response.status !== 401) throw new Error('Login inválido deveria retornar 401.');

    const appJs = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
    const mobileConfigJs = fs.readFileSync(path.join(ROOT, 'public', 'mobile-config.js'), 'utf8');

    if (!mobileConfigJs.includes("production: 'https://pardogo-8yn0.onrender.com'")) {
      throw new Error('Perfil production do mobile-config.js não está apontando para a API oficial.');
    }
    if (!mobileConfigJs.includes("apiBaseUrl: 'https://pardogo-8yn0.onrender.com'")) {
      throw new Error('apiBaseUrl padrão do mobile-config.js não está na API oficial sem barra final.');
    }
    if (!mobileConfigJs.includes('enableApiSetupScreen: false')) {
      throw new Error('Build de produção precisa desabilitar enableApiSetupScreen no mobile-config.js.');
    }
    if (!appJs.includes("api('/api/auth/login'")) {
      throw new Error('Fluxo de login do front-end não está chamando /api/auth/login.');
    }
    if (!appJs.includes("sanitized = sanitized.replace(/^\\/api\\/api\\//i, '/api/');")) {
      throw new Error('Proteção contra duplicidade de /api não encontrada no cliente.');
    }
    if (!appJs.includes("return 'Telefone ou senha inválidos.';")) {
      throw new Error('Tratamento HTTP 401 no cliente não está padronizado.');
    }
    if (!appJs.includes("throw new Error('Não foi possível conectar à API.');")) {
      throw new Error('Mensagem de erro de rede/CORS não foi separada corretamente no cliente.');
    }
    if (!appJs.includes('localStorage.removeItem(API_BASE_STORAGE_KEY);')) {
      throw new Error('Limpeza de URL inválida no localStorage não foi encontrada.');
    }
    if (!appJs.includes("logApiSelection('recover-oficial');")) {
      throw new Error('Recuperação automática para API oficial não foi encontrada no cliente.');
    }

    console.log('✓ backend SQLite validado');
    console.log('✓ health check, preflight OPTIONS e CORS mobile validados');
    console.log('✓ regressão front-end de URL/API/login validada');
    console.log('✓ login com sessão expirada/revogável validado');
    console.log('✓ cadastro e aprovação de motorista validados');
    console.log('✓ corrida aceita/finalizada validada');
    console.log('✓ rota/mapa backend validados');
    console.log('✓ tempo real SSE validado');
    console.log('✓ cancelamento de corrida validado');
    console.log('✓ contato WhatsApp/ligação validado');
    console.log('✓ avaliação de corrida e qualidade validadas');
    console.log('✓ suporte, denúncias e documentos validados');
    console.log('✓ termos e privacidade validados');
    console.log('✓ pré-produção e checklist de deploy validados');
    console.log('✓ auditoria administrativa validada');
  } finally {
    server.kill();
    await wait(300);
    for (const suffix of ['', '-shm', '-wal']) {
      const file = `${DB}${suffix}`;
      if (fs.existsSync(file)) fs.rmSync(file, { force: true });
    }
  }
}

run().catch(error => {
  console.error(`✗ ${error.message}`);
  process.exit(1);
});
