const { dbGet } = require('../db/pg');

function rowToRating(row) {
  if (!row) return null;
  return {
    id: row.id,
    rideId: row.ride_id,
    passengerId: row.passenger_id,
    driverId: row.driver_id,
    rating: row.rating,
    comment: row.comment || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function getRideRating(rideId) {
  return rowToRating(await dbGet('SELECT * FROM ride_ratings WHERE ride_id = ?', [rideId]));
}

async function getDriverRatingSummary(driverId) {
  const row = await dbGet('SELECT COUNT(*) AS count, COALESCE(AVG(rating), 0) AS average FROM ride_ratings WHERE driver_id = ?', [driverId]);
  return {
    reviewsCount: Number(row.count || 0),
    averageRating: Number(Number(row.average || 0).toFixed(2))
  };
}

module.exports = {
  getRideRating,
  getDriverRatingSummary
};
