const { dbGet, dbRun } = require('../db/pg');
const { FIXED_FARE_BRL, defaultTariffRules } = require('../config');
const { audit } = require('./audit');
const { nowIso } = require('../utils/validation');

async function getTariffRules() {
  const row = await dbGet('SELECT * FROM tariff_rules WHERE id = 1');
  return {
    base: row.base,
    perKm: row.per_km,
    perMin: row.per_min,
    min: row.min,
    driverSharePercent: row.driver_share_percent,
    city: row.city
  };
}

async function updateTariffRules(next) {
  await dbRun(`
    UPDATE tariff_rules
    SET base = ?, per_km = ?, per_min = ?, min = ?, driver_share_percent = ?, city = ?, updated_at = ?
    WHERE id = 1
  `, [next.base, next.perKm, next.perMin, next.min, next.driverSharePercent, next.city || defaultTariffRules.city, nowIso()]);
  await audit(null, 'update_tariff', 'tariff_rules', '1', next);
}

function calculateFare(distanceKm, minutes, rules = defaultTariffRules) {
  return FIXED_FARE_BRL;
}

module.exports = {
  getTariffRules,
  updateTariffRules,
  calculateFare
};
