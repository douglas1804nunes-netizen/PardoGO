const { MAP_DEFAULT_CENTER, CITY_GEOFENCE_RADIUS_KM, CITY_AVERAGE_SPEED_KMH, MAP_TIMEOUT_MS } = require('../config');

const MAP_BOUNDING_BOX = computeBoundingBox(MAP_DEFAULT_CENTER, CITY_GEOFENCE_RADIUS_KM);

function isValidLatLng(lat, lng) {
  return Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) && Math.abs(Number(lat)) <= 90 && Math.abs(Number(lng)) <= 180;
}

function roundCoord(value) {
  return Number(Number(value).toFixed(6));
}

function haversineDistanceKm(origin, destination) {
  if (!origin || !destination || !isValidLatLng(origin.lat, origin.lng) || !isValidLatLng(destination.lat, destination.lng)) return 0;
  const toRad = degree => degree * Math.PI / 180;
  const R = 6371;
  const dLat = toRad(Number(destination.lat) - Number(origin.lat));
  const dLng = toRad(Number(destination.lng) - Number(origin.lng));
  const lat1 = toRad(Number(origin.lat));
  const lat2 = toRad(Number(destination.lat));
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Number((R * c).toFixed(2));
}

function isWithinAllowedCity(lat, lng) {
  if (!isValidLatLng(lat, lng)) return false;
  const distance = haversineDistanceKm(
    { lat: Number(lat), lng: Number(lng) },
    { lat: MAP_DEFAULT_CENTER.lat, lng: MAP_DEFAULT_CENTER.lng }
  );
  return distance <= CITY_GEOFENCE_RADIUS_KM;
}

// Converte raio (km) em um retangulo lat/lng ao redor do centro da cidade para restringir a busca no Nominatim.
function computeBoundingBox(center, radiusKm) {
  const latDelta = radiusKm / 111;
  const lngDelta = radiusKm / (111 * Math.cos(center.lat * Math.PI / 180));
  return {
    minLat: center.lat - latDelta,
    maxLat: center.lat + latDelta,
    minLng: center.lng - lngDelta,
    maxLng: center.lng + lngDelta
  };
}

function viewboxParam(box) {
  return `${box.minLng},${box.maxLat},${box.maxLng},${box.minLat}`;
}

function assertCoordsWithinAllowedCity(origin, destination) {
  if (!origin || !destination) return;
  if (!isWithinAllowedCity(origin.lat, origin.lng) || !isWithinAllowedCity(destination.lat, destination.lng)) {
    const error = new Error('Atendimento restrito a Santa Rita do Pardo - MS. Ajuste origem e destino dentro da cidade.');
    error.statusCode = 400;
    throw error;
  }
}

function estimateMinutesByDistance(distanceKm) {
  const safeDistance = Math.max(Number(distanceKm || 0), 0.1);
  const minutes = Math.ceil((safeDistance / CITY_AVERAGE_SPEED_KMH) * 60);
  return Math.max(minutes, 3);
}

async function fetchJsonWithTimeout(url, timeoutMs = MAP_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'PardoGo-MVP/0.6 contato-local'
      }
    });
    if (!response.ok) throw new Error(`Serviço de mapa respondeu ${response.status}.`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

const ADDRESS_LABEL_CITY_MARKER = 'Santa Rita do Pardo';

// Nominatim sempre lista do mais especifico pro mais genérico. Como todo resultado
// já está restrito a esta cidade (viewbox + isWithinAllowedCity), cidade/estado/país
// no fim do texto só atrapalham a leitura do nome da rua — cortamos a partir daí.
function shortenAddressLabel(item) {
  const displayName = String(item?.display_name || '').trim();
  const road = item?.address?.road || item?.address?.pedestrian || item?.address?.footway;
  const houseNumber = item?.address?.house_number;
  if (road) return houseNumber ? `${road}, ${houseNumber}` : road;
  const idx = displayName.indexOf(ADDRESS_LABEL_CITY_MARKER);
  if (idx > 0) return displayName.slice(0, idx).replace(/,\s*$/, '').trim();
  return displayName;
}

async function geocodeAddress(query) {
  const term = String(query || '').trim();
  if (!term) return [];
  const expanded = /santa rita/i.test(term) ? term : `${term}, Santa Rita do Pardo, Mato Grosso do Sul, Brasil`;
  const viewbox = viewboxParam(MAP_BOUNDING_BOX);
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=8&addressdetails=1&dedupe=1&accept-language=pt-BR&countrycodes=br&viewbox=${encodeURIComponent(viewbox)}&bounded=1&q=${encodeURIComponent(expanded)}`;
  const results = await fetchJsonWithTimeout(url).catch(() => []);
  const seenLabels = new Set();
  const mapped = [];
  for (const item of results) {
    if (!isWithinAllowedCity(item.lat, item.lon)) continue;
    const label = shortenAddressLabel(item);
    const dedupeKey = label.toLowerCase();
    if (seenLabels.has(dedupeKey)) continue;
    seenLabels.add(dedupeKey);
    mapped.push({
      label,
      lat: roundCoord(item.lat),
      lng: roundCoord(item.lon),
      bbox: item.boundingbox || null,
      source: 'nominatim'
    });
  }
  return mapped;
}

async function reverseGeocodeCoords(lat, lng) {
  if (!isValidLatLng(lat, lng)) return null;
  if (!isWithinAllowedCity(lat, lng)) return null;
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&zoom=18&addressdetails=1&accept-language=pt-BR`;
  const data = await fetchJsonWithTimeout(url).catch(() => null);
  if (!data) return null;
  return {
    label: shortenAddressLabel(data),
    lat: roundCoord(data.lat ?? lat),
    lng: roundCoord(data.lon ?? lng),
    source: 'nominatim-reverse'
  };
}

async function calculateRoute(origin, destination) {
  assertCoordsWithinAllowedCity(origin, destination);
  const straightLineKm = haversineDistanceKm(origin, destination);
  if (!isValidLatLng(origin?.lat, origin?.lng) || !isValidLatLng(destination?.lat, destination?.lng)) {
    return {
      distanceKm: 0,
      minutes: 0,
      straightLineKm,
      source: 'manual',
      geometry: null,
      fallback: true
    };
  }

  const from = `${Number(origin.lng)},${Number(origin.lat)}`;
  const to = `${Number(destination.lng)},${Number(destination.lat)}`;
  const url = `https://router.project-osrm.org/route/v1/driving/${from};${to}?overview=full&geometries=geojson&steps=false`;

  try {
    const data = await fetchJsonWithTimeout(url);
    const route = data.routes && data.routes[0];
    if (!route) throw new Error('Rota não encontrada.');
    const distanceKm = Number((route.distance / 1000).toFixed(2));
    const minutes = Math.max(Math.ceil(route.duration / 60), 3);
    return {
      distanceKm,
      minutes,
      straightLineKm,
      source: 'osrm',
      geometry: route.geometry || null,
      fallback: false
    };
  } catch {
    const distanceKm = Number(Math.max(straightLineKm * 1.35, 0.5).toFixed(2));
    return {
      distanceKm,
      minutes: estimateMinutesByDistance(distanceKm),
      straightLineKm,
      source: 'haversine-fallback',
      geometry: {
        type: 'LineString',
        coordinates: [[Number(origin.lng), Number(origin.lat)], [Number(destination.lng), Number(destination.lat)]]
      },
      fallback: true
    };
  }
}

function coordsFromBody(body) {
  const origin = isValidLatLng(body.originLat, body.originLng)
    ? { lat: Number(body.originLat), lng: Number(body.originLng) }
    : null;
  const destination = isValidLatLng(body.destinationLat, body.destinationLng)
    ? { lat: Number(body.destinationLat), lng: Number(body.destinationLng) }
    : null;
  return { origin, destination };
}

module.exports = {
  isValidLatLng,
  haversineDistanceKm,
  isWithinAllowedCity,
  assertCoordsWithinAllowedCity,
  geocodeAddress,
  reverseGeocodeCoords,
  calculateRoute,
  coordsFromBody
};
