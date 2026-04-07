// Color mapping — four-level system: green > gray > orange > red

const RED_TRIGGERS = new Set(['M3', 'F', 'R3']);
const ORANGE_TRIGGERS = new Set(['R2', 'S3', 'M2']);
const GRAY_TRIGGERS = new Set(['U', 'C']);

function getColorLevel(tags) {
  if (tags.length === 0) return 'none';
  const tagSet = new Set(tags);
  if ([...tagSet].some(t => RED_TRIGGERS.has(t))) return 'red';
  if ([...tagSet].some(t => ORANGE_TRIGGERS.has(t))) return 'orange';
  if ([...tagSet].some(t => GRAY_TRIGGERS.has(t))) return 'gray';
  return 'green';
}
