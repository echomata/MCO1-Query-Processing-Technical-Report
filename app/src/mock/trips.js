// Not actual data
const zones = [
  ['Midtown Center', 'Manhattan', 670000, 2370],
  ['Upper East Side South', 'Manhattan', 480000, 2190],
  ['Penn Station / Madison Sq West', 'Manhattan', 410000, 2510],
  ['SoHo', 'Manhattan', 220000, 2440],
  ['JFK Airport', 'Queens', 320000, 6480],
  ['LaGuardia Airport', 'Queens', 260000, 4960],
  ['Williamsburg', 'Brooklyn', 110000, 2870],
  ['Downtown Brooklyn', 'Brooklyn', 85000, 3010],
  ['Mott Haven', 'Bronx', 28000, 2570],
  ['St. George', 'Staten Island', 7000, 3290],
];
const seasonality = [0.87, 0.85, 1.02, 1.01, 1.12, 1.08, 0.96, 0.91, 1.06, 1.13, 1.04, 1.16];
const paymentShares = [['card', 0.79], ['cash', 0.18], ['other', 0.03]];

export const mockTrips = zones.flatMap(([zone, borough, baseTrips, fareCents], zoneIndex) =>
  seasonality.flatMap((factor, monthIndex) =>
    paymentShares.map(([paymentType, share]) => {
      const trips = Math.round(baseTrips * factor * share);
      const averageFareCents = fareCents + monthIndex * 9;
      return {
        year: 2025, month: monthIndex + 1, zone, borough, paymentType, trips,
        fareCents: trips * averageFareCents,
        revenueCents: trips * (averageFareCents + (paymentType === 'card' ? 540 : 290)),
        distanceTotal: trips * (zoneIndex === 4 ? 17.4 : zoneIndex === 5 ? 10.1 : 2.7 + zoneIndex * 0.28),
        durationTotal: trips * (18 + zoneIndex * 2.3 + monthIndex * 0.1),
      };
    }),
  ),
);