function getEventAnnouncementTarget(farmEvent) {
  return farmEvent.thread || farmEvent.channel || null;
}

module.exports = { getEventAnnouncementTarget };
