const { MAP_DEFAULT_CENTER, CITY_AVERAGE_SPEED_KMH } = require('../config');
const { send, parseBody } = require('../http/response');
const { isValidLatLng, isWithinAllowedCity, assertCoordsWithinAllowedCity, geocodeAddress, reverseGeocodeCoords, calculateRoute, coordsFromBody } = require('../services/geo');
const { NOT_HANDLED } = require('../http/not-handled');

async function handle(req, res, url) {
  const method = req.method;
  const pathname = url.pathname;

  if (method === 'GET' && pathname === '/api/maps/default-center') {
    return send(res, 200, { ok: true, center: MAP_DEFAULT_CENTER, averageSpeedKmh: CITY_AVERAGE_SPEED_KMH });
  }

  if (method === 'GET' && pathname === '/api/maps/geocode') {
    const q = url.searchParams.get('q') || '';
    if (!q.trim()) return send(res, 400, { ok: false, error: 'Informe o endereço para buscar.' });
    const results = await geocodeAddress(q);
    if (!results.length) {
      return send(res, 400, { ok: false, error: 'Não encontramos esse endereço em Santa Rita do Pardo - MS. Tente o nome de uma rua/avenida ou toque no mapa para marcar o ponto exato.' });
    }
    return send(res, 200, { ok: true, query: q, results, fallbackCenter: MAP_DEFAULT_CENTER });
  }

  if (method === 'GET' && pathname === '/api/maps/reverse-geocode') {
    const lat = Number(url.searchParams.get('lat'));
    const lng = Number(url.searchParams.get('lng'));
    if (!isValidLatLng(lat, lng)) {
      return send(res, 400, { ok: false, error: 'Latitude/longitude inválidas.' });
    }
    if (!isWithinAllowedCity(lat, lng)) {
      return send(res, 400, { ok: false, error: 'Atendimento restrito a Santa Rita do Pardo - MS.' });
    }
    const result = await reverseGeocodeCoords(lat, lng);
    if (!result) {
      return send(res, 400, { ok: false, error: 'Nao foi possivel validar este ponto dentro de Santa Rita do Pardo - MS.' });
    }
    return send(res, 200, { ok: true, result });
  }

  if (method === 'POST' && pathname === '/api/maps/route') {
    const body = await parseBody(req);
    const { origin, destination } = coordsFromBody(body);
    if (!origin || !destination) return send(res, 400, { ok: false, error: 'Origem e destino precisam ter latitude e longitude.' });
    assertCoordsWithinAllowedCity(origin, destination);
    const route = await calculateRoute(origin, destination);
    return send(res, 200, { ok: true, ...route });
  }

  return NOT_HANDLED;
}

module.exports = { handle };
