// Serialization helpers shared by the REST API and the websocket hub.

export function publicUser(store, userId) {
  const u = store.getUser(userId);
  if (!u) return null;
  const rating = store.ratingSummary(userId);
  const driver = store.getDriverProfile(userId);
  return {
    id: u.id,
    name: u.name,
    phone: u.phone,
    createdAt: u.createdAt,
    avatar: u.avatar || null,
    about: u.about || null,
    city: u.city || null,
    points: u.points || 0,
    email: u.email || null,
    places: u.places || null,
    rating: rating.avg,
    ratingCount: rating.count,
    ridesCount: store.countFinishedRides(userId),
    isDriver: !!driver,
    car: driver
      ? { make: driver.carMake, model: driver.carModel, color: driver.carColor, plate: driver.plate }
      : null,
  };
}

// The other party of a ride, as seen by `forUserId`. Includes the phone
// number - counterparts are only exposed after a match, when both sides
// need to be able to contact each other. Email and saved places stay private.
export function rideCounterpart(store, ride, forUserId) {
  if (!ride) return null;
  const otherId = ride.riderId === forUserId ? ride.driverId : ride.riderId;
  if (!otherId) return null;
  const u = publicUser(store, otherId);
  if (u) {
    delete u.email;
    delete u.places;
  }
  return u;
}

// Public directory profile: no contact data at all.
export function directoryUser(store, userId) {
  const u = publicUser(store, userId);
  if (!u) return null;
  const { phone, email, places, ...rest } = u;
  return rest;
}
