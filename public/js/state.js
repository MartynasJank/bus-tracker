export const state = {
  screen:           null,
  prevScreen:       null,
  userLat:          null,
  userLng:          null,
  planMapMode:      false,
  mapTracking:      null,
  planFetchedAt:    0,
  planDest:         null,
  routeColors:      {},

  // Stops screen
  groups:           [],
  filteredGroups:   [],
  allGroups:        [],
  selectedGroup:    null,
  selectedStop:     null,
  favorites:        [],

  // Directions screen
  directions:       [],
  selectedDirection: null,
  destResults:      [],

  // Arrivals screen
  arrivals:         [],
  gpsVehicles:      [],
  activeRoutes:     new Set(),
  arrivalsFetchedAt: 0,

  // Timers
  refreshTimer:     null,
  tickTimer:        null,
  planTickTimer:    null,
};
