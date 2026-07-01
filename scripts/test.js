const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const DB = path.join(ROOT, 'data', 'pardogo-test.sqlite');
const PORT = 5199;
const BASE = `http://localhost:${PORT}`;

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


function openSse(token) {
  const events = [];
  const listeners = [];
  const req = http.get(`${BASE}/api/events?token=${encodeURIComponent(token)}`, {
    headers: { Accept: 'text/event-stream' }
  });
  let buffer = '';

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
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB },
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
      body: JSON.stringify({ phone: 'admin', password: '123456' })
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

    const driverStream = openSse(driverLogin.token);
    const passengerStream = openSse(passengerLogin.token);
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
    const passengerCancelledEvent = await passengerStream.waitFor('ride-update', payload => payload.type === 'cancelled' && payload.ride?.id === rideToCancel.ride.id);
    if (passengerCancelledEvent.ride.status !== 'cancelled' || !passengerCancelledEvent.ride.cancelReason) throw new Error('Cancelamento não foi emitido/salvo.');

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

    const dashboard = await request('/api/admin/dashboard', {
      headers: { Authorization: `Bearer ${adminLogin.token}` }
    });

    if (dashboard.database.type !== 'SQLite') throw new Error('Painel não informou SQLite.');
    if (dashboard.stats.ridesFinished !== 1) throw new Error('Corrida finalizada não apareceu no painel.');
    if (dashboard.stats.ridesCancelled !== 1) throw new Error('Corrida cancelada não apareceu no painel.');
    if (dashboard.stats.contactsLogged < 2) throw new Error('Contatos não apareceram nas métricas.');
    if (dashboard.stats.ratingsCount !== 1) throw new Error('Avaliação não apareceu nas métricas.');
    if (dashboard.stats.averageRating !== 5) throw new Error('Média de avaliação incorreta no painel.');
    const dashboardDriver = dashboard.users.find(user => user.id === driverRegister.user.id);
    if (!dashboardDriver || dashboardDriver.averageRating !== 5 || dashboardDriver.reviewsCount !== 1) throw new Error('Média do motorista não apareceu no painel.');
    if (dashboard.stats.driversApproved !== 1) throw new Error('Motorista aprovado não apareceu no painel.');
    if (dashboard.stats.supportOpen !== 1) throw new Error('Chamado aberto não apareceu nas métricas.');
    if (dashboard.stats.reportsOpen !== 1) throw new Error('Denúncia aberta não apareceu nas métricas.');
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

    console.log('✓ backend SQLite validado');
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
