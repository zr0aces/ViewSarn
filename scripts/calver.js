// Single definition of the CalVer format. Every other module imports it —
// a copy of this regex elsewhere is a copy that drifts.
const path = require('path');

const CALVER_REGEX = /^(?<year>2\d{3})\.(?<month>[1-9]|1[0-2])\.(?<minor>\d+)$/;

const ROOT_DIR = path.resolve(__dirname, '..');
const VERSION_FILE = path.join(ROOT_DIR, 'VERSION');

function parseCalver(value) {
  const match = String(value).trim().match(CALVER_REGEX);
  if (!match) return null;
  return {
    year: Number(match.groups.year),
    month: Number(match.groups.month),
    minor: Number(match.groups.minor)
  };
}

function formatCalver({ year, month, minor }) {
  return `${year}.${month}.${minor}`;
}

// Ordering is by (year, month, minor), which is what lets release refuse to
// move the version backwards.
function compareCalver(a, b) {
  return (a.year - b.year) || (a.month - b.month) || (a.minor - b.minor);
}

module.exports = { CALVER_REGEX, ROOT_DIR, VERSION_FILE, parseCalver, formatCalver, compareCalver };
